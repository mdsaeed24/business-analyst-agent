import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { configureStripe } from "../src/lib/sync/configure";
import { runSync, runDueSyncs } from "../src/lib/sync/service";
import { listConnections, connectionAction } from "../src/lib/sync/api";
import { digest } from "../src/lib/auth/service";
import { fakeStripe, event } from "./fixtures/stripe";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("Stripe synchronization in isolated PostgreSQL", () => {
  const schema = `stripe_test_${randomUUID().replaceAll("-", "")}`, email = "stripe-owner@example.com", org = "stripe_test_org";
  const env = { LIVE_SYNC_ENABLED: "true", STRIPE_SECRET_KEY: "rk_test_fixture" };
  const f = fakeStripe(); let admin: Client, db: PrismaClient, connectionId: string, userId: string, token: string;
  const options = () => ({ env, http: f.http });
  const req = (organizationId = org, action?: string) => new Request(`http://localhost/api/connections?organizationId=${organizationId}`, { method: action ? "POST" : "GET", headers: { cookie: `ba_session=${token}`, ...(action ? { origin: "http://localhost" } : {}) }, ...(action ? { body: JSON.stringify({ action }) } : {}) });
  beforeAll(async () => {
    admin = new Client({ connectionString: url }); await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`SET search_path TO "${schema}"`);
    const migrations = (await readdir(resolve("prisma/migrations"), { withFileTypes: true })).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const migration of migrations) await admin.query((await readFile(resolve("prisma/migrations", migration.name, "migration.sql"), "utf8")).replace('CREATE SCHEMA IF NOT EXISTS "public";', ""));
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c timezone=UTC" }, { schema }) });
    const user = await db.user.create({ data: { email } }); userId = user.id;
    token = randomBytes(32).toString("hex"); await db.session.create({ data: { userId, tokenHash: digest(token), expiresAt: new Date(Date.now() + 600000) } });
  }, 30000);
  afterAll(async () => { if (db) await db.$disconnect(); if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); } });
  it("provisions a separate tenant and prevents rebinding or duplicate account ownership", async () => {
    const input = { organizationId: org, name: "Stripe test", ownerEmail: email, accountId: "acct_Test", mode: "test" };
    connectionId = (await configureStripe(db, input)).id;
    expect((await configureStripe(db, input)).id).toBe(connectionId);
    await expect(configureStripe(db, { ...input, accountId: "acct_Different" })).rejects.toThrow("ACCOUNT_BINDING_IMMUTABLE");
    await expect(configureStripe(db, { ...input, organizationId: "duplicate" })).rejects.toMatchObject({ code: "P2002" });
    expect(await db.organization.findUnique({ where: { id: "duplicate" } })).toBeNull();
    await db.organization.create({ data: { id: "synthetic", slug: "synthetic", name: "Demo", syntheticDataset: "demo" } });
    await expect(configureStripe(db, { ...input, organizationId: "synthetic" })).rejects.toThrow("USE_A_SEPARATE_LIVE_ORGANIZATION");
  });
  it("imports full billing sources repeatedly without duplicate or fabricated values", async () => {
    const first = await runSync(db, connectionId, options()); expect(first.status).toBe("COMPLETED");
    expect(await db.stripeCustomer.count()).toBe(2); expect(await db.stripeSubscription.count()).toBe(1); expect(await db.stripePayment.count()).toBe(2);
    const sub = await db.stripeSubscription.findFirstOrThrow(); expect(sub.monthlyRecurringRevenueUsd).toBeNull(); expect(sub.sourceConnectionId).toBe(connectionId);
    const euro = await db.stripePayment.findFirstOrThrow({ where: { currency: "EUR" } }); expect(euro.amountUsd).toBeNull(); expect(euro.customerId).toBeNull();
    const prior = await db.stripePayment.findFirstOrThrow({ where: { paymentId: "ch_A" } });
    const repeated = await runSync(db, connectionId, { ...options(), full: true }); expect(repeated.status).toBe("COMPLETED"); expect(repeated.report.counts.payments.unchanged).toBe(2);
    expect((await db.stripePayment.findUniqueOrThrow({ where: { id: prior.id } })).normalizedAt).toEqual(prior.normalizedAt);
    expect(await db.stripePayment.count()).toBe(2);
  });
  it("updates refunds and cancellations incrementally and keeps deleted customer history", async () => {
    const before = await db.stripeCustomer.findFirstOrThrow({ where: { customerId: "cus_B" } });
    f.state.charges[0].amount_refunded = 500;
    f.state.subscription.status = "canceled"; f.state.subscription.ended_at = 1788220800;
    f.state.customers[1] = { id: "cus_B", object: "customer", deleted: true };
    f.state.events = [event("charge.refunded", "ch_A", 1), event("customer.subscription.deleted", "sub_A", 2), event("customer.deleted", "cus_B", 3)];
    const run = await runSync(db, connectionId, options()); expect(run.status).toBe("COMPLETED");
    expect((await db.stripePayment.findFirstOrThrow({ where: { paymentId: "ch_A" } })).refundAmountUsd?.toString()).toBe("5");
    expect((await db.stripeSubscription.findFirstOrThrow()).status).toBe("canceled");
    const deleted = await db.stripeCustomer.findUniqueOrThrow({ where: { id: before.id } }); expect(deleted.sourceDeletedAt).not.toBeNull(); expect(deleted.customerSince).toEqual(before.customerSince);
    expect(f.state.calls.some((url) => url.includes("created%5Bgte%5D"))).toBe(true);
  });
  it("reports invalid records and leaves the checkpoint unchanged until a clean retry", async () => {
    const previous = (await db.connection.findUniqueOrThrow({ where: { id: connectionId } })).syncWatermark;
    f.state.events = [event("customer.updated", "bad-id")];
    const partial = await runSync(db, connectionId, options()); expect(partial.status).toBe("PARTIAL"); expect(partial.report.issueCount).toBe(1);
    expect(partial.report.issues[0]).toMatchObject({ resource: "events", page: 1, row: 1 });
    expect((await db.connection.findUniqueOrThrow({ where: { id: connectionId } })).syncWatermark).toEqual(previous);
    f.state.events = [];
    expect((await runSync(db, connectionId, options())).status).toBe("COMPLETED");
  });
  it("fails account, mode and event-retention checks without advancing checkpoints", async () => {
    f.state.account = "acct_Wrong"; expect((await runSync(db, connectionId, options())).errorCode).toBe("ACCOUNT_MISMATCH"); f.state.account = "acct_Test";
    expect((await runSync(db, connectionId, { ...options(), env: { ...env, STRIPE_SECRET_KEY: "rk_live_fixture" } })).errorCode).toBe("MODE_MISMATCH");
    await db.connection.update({ where: { id: connectionId }, data: { syncWatermark: new Date(Date.now() - 29 * 86400000) } });
    expect((await runSync(db, connectionId, options())).errorCode).toBe("FULL_SYNC_REQUIRED_EVENT_GAP");
    expect((await runSync(db, connectionId, { ...options(), full: true })).status).toBe("COMPLETED");
  });
  it("queues work, processes schedules and enforces tenant and role isolation", async () => {
    expect((await listConnections(db, req()))[0].counts.payments).toBe(2);
    expect(JSON.stringify(await listConnections(db, req()))).not.toContain("secretReference");
    await connectionAction(db, req(org, "sync"), connectionId);
    expect((await runDueSyncs(db, options()))[0].status).toBe("COMPLETED");
    await connectionAction(db, req(org, "enable-schedule"), connectionId);
    expect((await runDueSyncs(db, options()))[0].status).toBe("COMPLETED");
    await connectionAction(db, req(org, "disable-schedule"), connectionId);
    expect(await runDueSyncs(db, options())).toEqual([]);
    await expect(listConnections(db, req("unassigned"))).rejects.toMatchObject({ status: 403 });
    await db.membership.updateMany({ where: { userId }, data: { role: "VIEWER" } });
    await expect(connectionAction(db, req(org, "sync"), connectionId)).rejects.toMatchObject({ status: 403 });
    expect((await listConnections(db, req()))).toHaveLength(1);
  });
  it("prevents concurrent lease claims and recovers a stale lease", async () => {
    await db.connection.update({ where: { id: connectionId }, data: { activeRunId: "held", leaseUntil: new Date(Date.now() + 300000) } });
    await expect(runSync(db, connectionId, options())).rejects.toThrow("SYNC_ALREADY_RUNNING");
    await db.connection.update({ where: { id: connectionId }, data: { leaseUntil: new Date(0) } });
    expect((await runSync(db, connectionId, options())).status).toBe("COMPLETED");
    expect((await db.connection.findUniqueOrThrow({ where: { id: connectionId } })).activeRunId).toBeNull();
  });
});
