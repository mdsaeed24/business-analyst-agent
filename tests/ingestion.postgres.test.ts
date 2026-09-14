import { generateNarration, readNarration, readAudio } from "../src/lib/voice/service";
import { explainInvestigation, readExplanation } from "../src/lib/explanations/service";
import { validateExplanation } from "../src/lib/explanations/grounding";
import { HttpError } from "../src/lib/auth/service";
import { runInvestigation, getInvestigation } from "../src/lib/investigations/service";
import { hashPassword } from "../src/lib/auth/password";
import { login, logout, authenticate, digest } from "../src/lib/auth/service";
import { organizations, metrics, evidence } from "../src/lib/analytics/service";
import { computeMetrics } from "../src/lib/metrics/service";
import { periodBounds } from "../src/lib/metrics/period";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client";
import { catalog } from "../src/lib/ingestion/catalog";
import { ingestSynthetic } from "../src/lib/ingestion/pipeline";
import { prismaStore, resetSynthetic, withSyntheticTransaction } from "../src/lib/ingestion/prisma-store";

// Opt-in integration tests use a fresh random schema, never existing application
// tables. Cleanup drops only that schema, even when assertions fail.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("PostgreSQL synthetic ingestion", () => {
  const schema = `phase2_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Client;
  let db: PrismaClient;
  beforeAll(async () => {
    admin = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    const migrations = (await readdir(resolve("prisma/migrations"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const migration of migrations) {
      const sql = await readFile(resolve("prisma/migrations", migration.name, "migration.sql"), "utf8");
      await admin.query(sql.replace('CREATE SCHEMA IF NOT EXISTS "public";', ""));
    }
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c timezone=UTC" }, { schema }) });
  }, 30000);
  afterAll(async () => {
    if (db) await db.$disconnect();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("imports the entire dataset twice without duplicate rows or changed IDs", async () => {
    const run = () => withSyntheticTransaction(db, (tx) => ingestSynthetic(prismaStore(tx), resolve("data/synthetic")));
    const first = await run();
    expect(first.issues).toEqual([]);
    expect(first.ok).toBe(true);
    const firstCompany = await db.cRMCompany.findFirstOrThrow();
    const firstTicket = await db.supportTicket.findFirstOrThrow({ where: { ticketId: "tkt_000001" } });
    expect(firstTicket.createdAt.toISOString()).toBe("2025-01-01T08:02:00.000Z");
    const second = await run();
    expect(second.ok).toBe(true);
    expect(second.tables).toEqual(first.tables);
    expect(second.tables.reduce((sum, table) => sum + table.databaseRows, 0)).toBe(20636);
    expect(await db.cRMCompany.findUniqueOrThrow({ where: { id: firstCompany.id } })).toEqual(firstCompany);
    expect(await db.metricDefinition.count()).toBe(8);
  }, 180000);

  it("computes all eight August metrics against independent decimal/CSV expectations and persists repeatably", async () => {
    const input = { organizationId: "org_northstar_001", from: "2026-08-01", to: "2026-09-01" };
    const first = await computeMetrics(db, { organizationId: input.organizationId, from: input.from, to: input.to });
    expect(Object.fromEntries(first.results.map((r) => [r.key, r.value]))).toEqual({ revenue_collected: "594411.43000000", mrr: "609558.00000000", new_customers: "12.00000000", pipeline_created: "169985.31000000", win_rate: "48.48484848", web_conversion_rate: "2.97830680", support_volume: "207.00000000", avg_first_response: "36.35748792" });
    expect(await computeMetrics(db, input)).toEqual(first);
    expect(await db.metricValue.count()).toBe(8);
    const stored = await db.metricValue.findUniqueOrThrow({ where: { id: first.results[0].id } });
    expect(stored.calculationDetails).toMatchObject({ key: "revenue_collected", timezone: "America/New_York", numerator: "594411.43", sourceCount: first.results[0].sourceCount });
    expect(first.results.every((r) => r.periodStart === "2026-08-01T04:00:00.000Z" && r.periodEnd === "2026-09-01T04:00:00.000Z")).toBe(true);
  });

  it("handles daylight-saving boundaries, empty periods and atomic failure", async () => {
    const bounds = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Kolkata'");
      return periodBounds(tx, "2026-03-08", "2026-03-09", "America/New_York");
    });
    expect(bounds.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(23 * 3600000);
    const autumn = await db.$transaction((tx) => periodBounds(tx, "2026-11-01", "2026-11-02", "America/New_York"));
    expect(autumn.end.getTime() - autumn.start.getTime()).toBe(25 * 3600000);
    const empty = await computeMetrics(db, { organizationId: "org_northstar_001", from: "2020-01-01", to: "2020-02-01" });
    expect(empty.results.filter((r) => r.status === "NO_DATA").map((r) => r.key)).toEqual(["win_rate", "web_conversion_rate", "avg_first_response"]);
    expect(empty.results.find((r) => r.key === "mrr")?.value).toBe("0.00000000");
    const definition = await db.metricDefinition.findFirstOrThrow({ where: { key: "avg_first_response" } });
    await db.metricDefinition.update({ where: { id: definition.id }, data: { unit: "count" } });
    await expect(computeMetrics(db, { organizationId: "org_northstar_001", from: "2026-07-01", to: "2026-08-01" })).rejects.toThrow("Incompatible");
    expect(await db.metricValue.count()).toBe(16);
    await db.metricDefinition.update({ where: { id: definition.id }, data: { unit: definition.unit } });
  });

  it("includes start boundaries, excludes end boundaries, filters failed payments and reconstructs historical MRR", async () => {
    const input = { organizationId: "org_northstar_001", from: "2026-08-01", to: "2026-09-01" };
    const { id: _paymentId, ...payment } = await db.stripePayment.findFirstOrThrow();
    const paymentIds: string[] = [];
    for (const [suffix, paymentDate, status] of [["start", "2026-08-01", "succeeded"], ["end", "2026-09-01", "succeeded"], ["failed", "2026-08-01", "failed"]] as const) {
      const id = `boundary_payment_${suffix}`; paymentIds.push(id);
      await db.stripePayment.create({ data: { ...payment, paymentId: id, sourceRecordId: id, paymentDate: new Date(paymentDate), status, amountUsd: "100", refundAmountUsd: "25" } });
    }
    const { id: _subscriptionId, billingComponents: _billingComponents, ...subscription } = await db.stripeSubscription.findFirstOrThrow();
    const subscriptionIds: string[] = [];
    for (const [suffix, startDate, cancelDate] of [["cancel_start", "2026-01-01", "2026-08-01"], ["cancel_end", "2026-01-01", "2026-09-01"], ["start_end", "2026-09-01", null]] as const) {
      const id = `boundary_subscription_${suffix}`; subscriptionIds.push(id);
      await db.stripeSubscription.create({ data: { ...subscription, subscriptionId: id, sourceRecordId: id, startDate: new Date(startDate), cancelDate: cancelDate ? new Date(cancelDate) : null, status: cancelDate ? "canceled" : "active", monthlyRecurringRevenueUsd: "123" } });
    }
    const { id: _ticketId, ...ticket } = await db.supportTicket.findFirstOrThrow();
    const ticketIds: string[] = [];
    for (const [index, createdAt] of ["2026-08-01T03:59:59Z", "2026-08-01T04:00:00Z", "2026-09-01T03:59:59Z", "2026-09-01T04:00:00Z"].entries()) {
      const id = `boundary_ticket_${index}`; ticketIds.push(id);
      await db.supportTicket.create({ data: { ...ticket, ticketId: id, sourceRecordId: id, createdAt: new Date(createdAt) } });
    }
    const result = await computeMetrics(db, { organizationId: input.organizationId, from: input.from, to: input.to });
    const values = Object.fromEntries(result.results.map((r) => [r.key, r.value]));
    expect(values.revenue_collected).toBe("594486.43000000");
    expect(values.mrr).toBe("609681.00000000");
    expect(values.support_volume).toBe("209.00000000");
    for (const [key, idField, expected] of [["revenue_collected", "paymentId", "boundary_payment_start"], ["mrr", "subscriptionId", "boundary_subscription_cancel_end"], ["support_volume", "ticketId", "boundary_ticket_1,boundary_ticket_2"]]) {
      const metric = await db.metricValue.findUniqueOrThrow({ where: { id: result.results.find((r) => r.key === key)!.id } });
      const details = metric.calculationDetails as { sources: Record<string, string>[] };
      expect(details.sources.map((source) => source[idField]).filter((id) => id?.startsWith("boundary_")).sort()).toEqual(expected.split(","));
    }
    await db.stripePayment.deleteMany({ where: { organizationId: input.organizationId, paymentId: { in: paymentIds } } });
    await db.stripeSubscription.deleteMany({ where: { organizationId: input.organizationId, subscriptionId: { in: subscriptionIds } } });
    await db.supportTicket.deleteMany({ where: { organizationId: input.organizationId, ticketId: { in: ticketIds } } });
    const restored = await computeMetrics(db, { organizationId: input.organizationId, from: input.from, to: input.to });
    expect(restored.results.find((r) => r.key === "revenue_collected")?.value).toBe("594411.43000000");
    expect(restored.results.find((r) => r.key === "revenue_collected")?.inputHash).not.toBe(result.results.find((r) => r.key === "revenue_collected")?.inputHash);
  });

  it("scopes metric reads and writes to the requested tenant", async () => {
    const org = await db.organization.create({ data: { id: "metric_other", slug: "metric-other", name: "Metric tenant" } });
    const definitions = await db.metricDefinition.findMany({ where: { organizationId: "org_northstar_001" } });
    for (const { id: _id, ...data } of definitions) await db.metricDefinition.create({ data: { ...data, organizationId: org.id, syntheticDataset: null } });
    const report = await computeMetrics(db, { organizationId: org.id, from: "2026-08-01", to: "2026-09-01" });
    expect(report.results.every((r) => r.sourceCount === 0)).toBe(true);
    expect(await db.metricValue.count({ where: { organizationId: "org_northstar_001" } })).toBe(16);
    await db.metricValue.deleteMany({ where: { organizationId: org.id } });
    await db.metricDefinition.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
    await expect(computeMetrics(db, { organizationId: org.id, from: "2026-08-01", to: "2026-09-01" })).rejects.toThrow();
  });

  it("authenticates sessions, enforces tenant access, protects evidence and handles empty comparisons", async () => {
    const email = `test-${randomUUID()}@example.com`, password = randomUUID() + randomUUID();
    const user = await db.user.create({ data: { email, passwordHash: await hashPassword(password), memberships: { create: { organizationId: "org_northstar_001", role: "VIEWER" } } } });
    const loginRequest = (secret = password) => new Request("http://localhost/api/auth/login", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ email, password: secret }) });
    await expect(login(db, loginRequest("wrong-password"))).rejects.toMatchObject({ status: 401 });
    const token = await login(db, loginRequest());
    expect((await db.session.findFirstOrThrow({ where: { userId: user.id } })).tokenHash).toBe(digest(token));
    const request = (path: string) => new Request(`http://localhost${path}`, { headers: { cookie: `ba_session=${token}` } });
    expect(await authenticate(db, request("/"))).toBe(user.id);
    expect((await organizations(db, request("/api/organizations"))).map((o) => o.id)).toEqual(["org_northstar_001"]);
    const demoWorkspace = (await organizations(db, request("/api/organizations")))[0];
    expect(demoWorkspace.isDemo).toBe(true);
    expect(demoWorkspace).not.toHaveProperty("syntheticDataset");
    await expect(organizations(db, new Request("http://localhost/api/organizations"))).rejects.toMatchObject({ status: 401 });
    const query = "/api/metrics?organizationId=org_northstar_001&from=2026-08-01&to=2026-09-01";
    const result = await metrics(db, request(query + "&compareFrom=2020-01-01&compareTo=2020-02-01"));
    expect(result.metrics).toHaveLength(8);
    const revenue = result.metrics.find((m) => m.key === "revenue_collected")!;
    expect(revenue.value).toBe("594411.43");
    expect(revenue.comparison).toMatchObject({ value: "0", delta: "594411.43", relativePercent: null });
    const revenueDefinition = await db.metricDefinition.findFirstOrThrow({ where: { organizationId: "org_northstar_001", key: "revenue_collected" } });
    const baseline = await db.metricValue.findFirstOrThrow({ where: { metricDefinitionId: revenueDefinition.id, periodStart: new Date("2020-01-01T05:00:00Z") } });
    await db.metricValue.update({ where: { id: baseline.id }, data: { value: "1000000" } });
    const decreased = await metrics(db, request(query + "&compareFrom=2020-01-01&compareTo=2020-02-01"));
    expect(decreased.metrics.find((m) => m.key === "revenue_collected")?.comparison).toMatchObject({ delta: "-405588.57", relativePercent: "-40.55885700" });
    await db.metricValue.update({ where: { id: baseline.id }, data: { value: "0" } });
    const missing = await metrics(db, request(query.replace("2026-08-01", "2021-08-01").replace("2026-09-01", "2021-09-01")));
    expect(missing.metrics.every((m) => m.status === "NOT_COMPUTED" && m.value === null)).toBe(true);
    await expect(metrics(db, request(query.replace("org_northstar_001", "unassigned")))).rejects.toMatchObject({ status: 403 });
    const metricId = (revenue as { id: string }).id;
    expect((await evidence(db, request("/api/metrics/x/evidence?organizationId=org_northstar_001"), metricId)).calculationDetails).toBeTruthy();
    await expect(evidence(db, request("/api/metrics/x/evidence?organizationId=unassigned"), metricId)).rejects.toMatchObject({ status: 403 });
    const other = await db.organization.create({ data: { id: "auth_other", name: "Other", slug: "auth-other", memberships: { create: { userId: user.id, role: "VIEWER" } } } });
    await expect(evidence(db, request("/api/metrics/x/evidence?organizationId=auth_other"), metricId)).rejects.toMatchObject({ status: 404 });
    await db.membership.deleteMany({ where: { userId: user.id, organizationId: "org_northstar_001" } });
    await expect(metrics(db, request(query))).rejects.toMatchObject({ status: 403 });
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    await expect(authenticate(db, request("/"))).rejects.toMatchObject({ status: 401 });
    await db.loginThrottle.update({ where: { key: digest(email) }, data: { attempts: 10 } });
    await expect(login(db, loginRequest())).rejects.toMatchObject({ status: 429 });
    await db.loginThrottle.update({ where: { key: digest(email) }, data: { windowStart: new Date(Date.now() - 16 * 60000) } });
    const nextToken = await login(db, loginRequest());
    await logout(db, new Request("http://localhost/api/auth/logout", { method: "POST", headers: { origin: "http://localhost", cookie: `ba_session=${nextToken}` } }));
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    await db.membership.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.organization.delete({ where: { id: other.id } });
  }, 30000);

  it("saves investigations idempotently with immutable evidence and tenant/role protection", async () => {
    const input = { organizationId: "org_northstar_001", from: "2026-08-01", to: "2026-09-01", compareFrom: "2026-07-01", compareTo: "2026-08-01" };
    await computeMetrics(db, { organizationId: input.organizationId, from: input.compareFrom, to: input.compareTo });
    const user = await db.user.create({ data: { email: `investigation-${randomUUID()}@example.com`, memberships: { create: { organizationId: input.organizationId, role: "ANALYST" } } } });
    const [first, second] = await Promise.all([runInvestigation(db, user.id, input), runInvestigation(db, user.id, input)]);
    expect(first.id).toBe(second.id);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);
    expect(await db.investigation.count()).toBe(1);
    expect((first.findings as { key: string; significant: boolean }[]).filter((f) => f.significant).map((f) => f.key)).toEqual(["pipeline_created", "win_rate", "support_volume"]);
    const evidenceRows = await db.evidenceItem.findMany({ where: { investigationId: first.id }, orderBy: { title: "asc" } });
    expect(evidenceRows).toHaveLength(8);
    const token = randomBytes(32).toString("hex");
    await db.session.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
    const req = (org: string) => new Request(`http://localhost/api/investigations/${first.id}?organizationId=${org}`, { headers: { cookie: `ba_session=${token}` } });
    expect((await getInvestigation(db, req(input.organizationId), first.id)).evidenceItems).toHaveLength(8);
    await expect(runInvestigation(db, user.id, { ...input, organizationId: "unassigned" })).rejects.toMatchObject({ status: 403 });
    await expect(getInvestigation(db, req("unassigned"), first.id)).rejects.toMatchObject({ status: 403 });
    const other = await db.organization.create({ data: { name: "Investigation other", slug: "investigation-other", memberships: { create: { userId: user.id, role: "VIEWER" } } } });
    await expect(getInvestigation(db, req(other.id), first.id)).rejects.toMatchObject({ status: 404 });
    const aiConfig = { enabled: true, apiKey: "fake-test-key", model: "deepseek-flash" as const };
    const generate = vi.fn(async (_config, grounding) => validateExplanation({ insights: [{ reference: "M1", explanation: "Revenue increased, but the supplied evidence does not establish a cause.", suggestedCheck: "Review the underlying payment and refund records." }] }, grounding));
    await expect(explainInvestigation(db, user.id, input.organizationId, first.id, { ...aiConfig, enabled: false }, generate)).rejects.toMatchObject({ status: 503 });
    const results = await Promise.allSettled([explainInvestigation(db, user.id, input.organizationId, first.id, aiConfig, generate), explainInvestigation(db, user.id, input.organizationId, first.id, aiConfig, generate)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results) if (r.status === "rejected") expect(r.reason.status).toBe(409);
    expect(generate).toHaveBeenCalledTimes(1);
    const cached = await explainInvestigation(db, user.id, input.organizationId, first.id, aiConfig, generate);
    expect(cached.reused).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await db.explanation.count()).toBe(1);
    expect((await readExplanation(db, req(input.organizationId), first.id)).explanation?.status).toBe("COMPLETED");
    await expect(readExplanation(db, req(other.id), first.id)).rejects.toMatchObject({ status: 404 });
    await expect(explainInvestigation(db, user.id, "unassigned", first.id, aiConfig, generate)).rejects.toMatchObject({ status: 403 });
    const voiceConfig = { enabled: true, apiKey: "test-key", voiceId: "stockVoice", model: "eleven_flash_v2_5" as const };
    const speech = vi.fn(async () => { const bytes = new Uint8Array(256); bytes.set([0x49, 0x44, 0x33]); return bytes; });
    await expect(generateNarration(db, user.id, input.organizationId, cached.id, { ...voiceConfig, enabled: false }, speech)).rejects.toMatchObject({ status: 503 });
    const voiceRuns = await Promise.allSettled([generateNarration(db, user.id, input.organizationId, cached.id, voiceConfig, speech), generateNarration(db, user.id, input.organizationId, cached.id, voiceConfig, speech)]);
    expect(voiceRuns.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of voiceRuns) if (r.status === "rejected") expect(r.reason.status).toBe(409);
    const spoken = await generateNarration(db, user.id, input.organizationId, cached.id, voiceConfig, speech);
    expect(spoken.reused).toBe(true); expect(speech).toHaveBeenCalledTimes(1);
    expect(spoken).not.toHaveProperty("audio");
    expect((await readNarration(db, req(input.organizationId), cached.id)).narration?.id).toBe(spoken.id);
    const audio = await readAudio(db, req(input.organizationId), cached.id, spoken.id);
    expect(audio.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await audio.arrayBuffer()).byteLength).toBe(256);
    await expect(readAudio(db, req(other.id), cached.id, spoken.id)).rejects.toMatchObject({ status: 404 });
    await expect(readAudio(db, req("unassigned"), cached.id, spoken.id)).rejects.toMatchObject({ status: 403 });
    await expect(readAudio(db, req(input.organizationId), "wrong-explanation", spoken.id)).rejects.toMatchObject({ status: 404 });
    const speechFailure = vi.fn(async () => { throw new HttpError(502, "Provider unavailable"); });
    const differentVoice = { ...voiceConfig, voiceId: "differentVoice" };
    await expect(generateNarration(db, user.id, input.organizationId, cached.id, differentVoice, speechFailure)).rejects.toMatchObject({ status: 502 });
    await expect(generateNarration(db, user.id, input.organizationId, cached.id, differentVoice, speechFailure)).rejects.toMatchObject({ status: 429 });
    expect(speechFailure).toHaveBeenCalledTimes(1);
    await db.audioNarration.updateMany({ where: { status: "FAILED" }, data: { startedAt: new Date(Date.now() - 181000) } });
    expect((await generateNarration(db, user.id, input.organizationId, cached.id, differentVoice, speech)).status).toBe("COMPLETED");
    const fail = vi.fn(async () => { throw new HttpError(502, "Provider unavailable"); });
    const alternate = { ...aiConfig, model: "deepseek-v4-pro" as const };
    await expect(explainInvestigation(db, user.id, input.organizationId, first.id, alternate, fail)).rejects.toMatchObject({ status: 502 });
    await expect(explainInvestigation(db, user.id, input.organizationId, first.id, alternate, fail)).rejects.toMatchObject({ status: 429 });
    expect(fail).toHaveBeenCalledTimes(1);
    await db.explanation.updateMany({ where: { status: "FAILED" }, data: { startedAt: new Date(Date.now() - 121000) } });
    expect((await explainInvestigation(db, user.id, input.organizationId, first.id, alternate, generate)).status).toBe("COMPLETED");
    const payment = await db.stripePayment.findFirstOrThrow({ where: { paymentDate: { gte: new Date(input.from), lt: new Date(input.to) }, status: "succeeded" } });
    await db.stripePayment.update({ where: { id: payment.id }, data: { amountUsd: payment.amountUsd!.plus(100) } });
    await computeMetrics(db, { organizationId: input.organizationId, from: input.from, to: input.to });
    const changed = await runInvestigation(db, user.id, input);
    expect(changed.id).not.toBe(first.id);
    expect(await db.evidenceItem.findMany({ where: { investigationId: first.id }, orderBy: { title: "asc" } })).toEqual(evidenceRows);
    await db.stripePayment.update({ where: { id: payment.id }, data: { amountUsd: payment.amountUsd } });
    await computeMetrics(db, { organizationId: input.organizationId, from: input.from, to: input.to });
    expect((await runInvestigation(db, user.id, input)).id).toBe(first.id);
    await db.membership.updateMany({ where: { userId: user.id }, data: { role: "VIEWER" } });
    await expect(runInvestigation(db, user.id, input)).rejects.toMatchObject({ status: 403 });
    expect((await getInvestigation(db, req(input.organizationId), first.id)).id).toBe(first.id);
    await expect(explainInvestigation(db, user.id, input.organizationId, first.id, aiConfig, generate)).rejects.toMatchObject({ status: 403 });
    expect((await readExplanation(db, req(input.organizationId), first.id)).explanation?.status).toBe("COMPLETED");
    await expect(generateNarration(db, user.id, input.organizationId, cached.id, voiceConfig, speech)).rejects.toMatchObject({ status: 403 });
    expect((await readAudio(db, req(input.organizationId), cached.id, spoken.id)).status).toBe(200);
    await db.audioNarration.deleteMany({ where: { explanationId: cached.id } });
    await db.explanation.deleteMany({ where: { investigationId: first.id } });
    await db.evidenceItem.deleteMany({ where: { investigationId: { in: [first.id, changed.id] } } });
    await db.investigation.deleteMany({ where: { id: { in: [first.id, changed.id] } } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.membership.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.organization.delete({ where: { id: other.id } });
  }, 60000);

  it("enforces tenant foreign keys while allowing identical source IDs in different tenants", async () => {
    const original = await db.cRMCompany.findFirstOrThrow();
    await db.organization.create({ data: { id: "phase2_other", name: "Other tenant", slug: "phase2-other" } });
    const { id: _id, ...company } = original;
    await db.cRMCompany.create({ data: { ...company, organizationId: "phase2_other", syntheticDataset: null } });
    const contact = await db.cRMContact.findFirstOrThrow();
    const { id: _contactId, ...contactData } = contact;
    await expect(db.cRMContact.create({ data: { ...contactData, organizationId: "phase2_other", companyId: "only-in-other-tenant", syntheticDataset: null } })).rejects.toMatchObject({ code: "P2003" });
    // A real parent exists, but exclusively in the original tenant.
    await db.cRMCompany.create({ data: { ...company, sourceRecordId: "exclusive", companyId: "only-in-other-tenant" } });
    await expect(db.cRMContact.create({ data: { ...contactData, organizationId: "phase2_other", companyId: "only-in-other-tenant", syntheticDataset: null } })).rejects.toMatchObject({ code: "P2003" });
    await db.cRMContact.create({ data: { ...contactData, organizationId: "phase2_other", companyId: original.companyId, syntheticDataset: null } });
    expect(await db.cRMCompany.count({ where: { organizationId: "phase2_other" } })).toBe(1);
    expect(await db.cRMCompany.count({ where: { organizationId: original.organizationId } })).toBe(301);
  });

  it("enforces payment customer/subscription consistency in PostgreSQL", async () => {
    const payment = await db.stripePayment.findFirstOrThrow();
    const other = await db.stripeCustomer.findFirstOrThrow({ where: { customerId: { not: payment.customerId! } } });
    const { id: _id, ...data } = payment;
    await expect(db.stripePayment.create({ data: { ...data, customerId: other.customerId, paymentId: "invalid-payment", sourceRecordId: "invalid-payment" } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("recovers database conflicts with savepoints and protects unmarked records", async () => {
    const original = await db.cRMCompany.findFirstOrThrow({ where: { syntheticDataset: { not: null } } });
    const { id: _id, ...data } = original;
    await withSyntheticTransaction(db, async (tx) => {
      const store = prismaStore(tx);
      await expect(store.upsert(catalog[1], { ...data, sourceRecordId: "conflicting-source" })).rejects.toThrow("Database constraint rejected");
      await expect(store.upsert(catalog[1], { ...data, organizationId: "phase2_other" })).rejects.toThrow("Refusing to overwrite");
      await store.upsert(catalog[1], { ...data, companyName: "Updated deterministically" });
    });
    expect((await db.cRMCompany.findUniqueOrThrow({ where: { id: original.id } })).companyName).toBe("Updated deterministically");
  });

  it("refuses production reset and rolls back reset if non-synthetic rows depend on synthetic records", async () => {
    await expect(resetSynthetic(db, "production")).rejects.toThrow("refusing");
    const definition = await db.metricDefinition.findFirstOrThrow();
    const value = await db.metricValue.create({ data: { organizationId: definition.organizationId, metricDefinitionId: definition.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-02-01"), value: "1" } });
    await expect(resetSynthetic(db, "test")).rejects.toMatchObject({ code: "P2003" });
    expect(await db.supportTicket.count()).toBe(2341);
    expect(await db.metricDefinition.count()).toBe(8);
    await db.metricValue.delete({ where: { id: value.id } });
    const contact = await db.cRMContact.findFirstOrThrow({ where: { organizationId: definition.organizationId } });
    const { id: _id, ...contactData } = contact;
    const unmarked = await db.cRMContact.create({ data: { ...contactData, contactId: "protected-contact", sourceRecordId: "protected-contact", syntheticDataset: null } });
    // This fails late in the reset, after attempted deletion of billing/support rows.
    await expect(resetSynthetic(db, "test")).rejects.toMatchObject({ code: "P2003" });
    expect(await db.stripePayment.count()).toBe(4914);
    expect(await db.supportTicket.count()).toBe(2341);
    await db.cRMContact.delete({ where: { id: unmarked.id } });
    await resetSynthetic(db, "test");
    expect(await db.stripePayment.count()).toBe(0);
    expect(await db.metricDefinition.count()).toBe(0);
    expect(await db.organization.count()).toBe(1);
    expect(await db.cRMCompany.count()).toBe(1);
    expect(await db.cRMContact.count()).toBe(1);
  });
});
