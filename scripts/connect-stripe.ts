import { parseArgs } from "node:util";
import { createIngestionClient } from "./ingestion-runtime";
import { configureStripe } from "../src/lib/sync/configure";
async function main() {
  const { values } = parseArgs({ options: { org: { type: "string" }, name: { type: "string", default: "Stripe billing" }, "owner-email": { type: "string" }, account: { type: "string" }, mode: { type: "string" }, timezone: { type: "string", default: "UTC" }, "secret-reference": { type: "string", default: "STRIPE_SECRET_KEY" }, "interval-minutes": { type: "string", default: "60" } } });
  const db = createIngestionClient();
  try { const row = await configureStripe(db, { organizationId: values.org, name: values.name, ownerEmail: values["owner-email"], accountId: values.account, mode: values.mode, timezone: values.timezone, secretReference: values["secret-reference"], intervalMinutes: Number(values["interval-minutes"]) }); console.log(JSON.stringify({ connectionId: row.id, organizationId: row.organizationId, scheduleEnabled: row.syncEnabled })); }
  finally { await db.$disconnect(); }
}
main().catch((error) => { console.error("Stripe setup failed:", typeof error.code === "string" ? error.code : "Check command arguments, existing owner account and database configuration"); process.exitCode = 1; });
