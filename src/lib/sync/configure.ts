import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { SyncError } from "./errors";
export const configureSchema = z.strictObject({
  organizationId: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/), name: z.string().trim().min(1).max(100), ownerEmail: z.email().transform((s) => s.toLowerCase()),
  timezone: z.string().refine((s) => { try { new Intl.DateTimeFormat("en", { timeZone: s }); return true; } catch { return false; } }).default("UTC"),
  accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), mode: z.enum(["test", "live"]), secretReference: z.string().regex(/^STRIPE_[A-Z0-9_]*KEY$/).default("STRIPE_SECRET_KEY"), intervalMinutes: z.number().int().min(5).max(1440).default(60),
});
// Trusted local operator CLI only. The web API cannot bind arbitrary environment
// secrets or provision accounts/organizations on behalf of a browser caller.
export async function configureStripe(db: PrismaClient, raw: unknown) {
  const input = configureSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"stripe-config:" + input.organizationId}))::text`;
    const user = await tx.user.findUnique({ where: { email: input.ownerEmail } });
    if (!user) throw new SyncError("EXISTING_OWNER_ACCOUNT_REQUIRED");
    let org = await tx.organization.findUnique({ where: { id: input.organizationId } });
    if (org?.syntheticDataset) throw new SyncError("USE_A_SEPARATE_LIVE_ORGANIZATION");
    if (org) {
      const member = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } } });
      if (!member || member.role !== "OWNER") throw new SyncError("ORGANIZATION_OWNER_REQUIRED");
      if (org.timezone !== input.timezone) throw new SyncError("ORGANIZATION_TIMEZONE_MISMATCH");
    } else org = await tx.organization.create({ data: { id: input.organizationId, slug: input.organizationId.replaceAll("_", "-"), name: input.name, timezone: input.timezone, currency: "USD", memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const existing = await tx.connection.findFirst({ where: { organizationId: org.id, provider: "STRIPE", secretReference: { not: null } } });
    if (existing && (existing.externalAccountId !== input.accountId || existing.liveMode !== (input.mode === "live"))) throw new SyncError("ACCOUNT_BINDING_IMMUTABLE_USE_NEW_ORGANIZATION");
    if (!existing) {
      const count = await tx.stripeCustomer.count({ where: { organizationId: org.id } }) + await tx.stripeSubscription.count({ where: { organizationId: org.id } }) + await tx.stripePayment.count({ where: { organizationId: org.id } });
      if (count) throw new SyncError("EMPTY_STRIPE_SOURCE_TABLES_REQUIRED");
    }
    const data = { secretReference: input.secretReference, syncIntervalMinutes: input.intervalMinutes };
    return existing ? tx.connection.update({ where: { id: existing.id }, data }) : tx.connection.create({ data: { ...data, organizationId: org.id, provider: "STRIPE", name: input.name, externalAccountId: input.accountId, liveMode: input.mode === "live" } });
  });
}
