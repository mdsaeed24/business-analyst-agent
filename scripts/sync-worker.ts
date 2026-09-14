import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createIngestionClient } from "./ingestion-runtime";
import { runDueSyncs, runSync } from "../src/lib/sync/service";
import { SyncError } from "../src/lib/sync/errors";
async function main() {
  const { values } = parseArgs({ options: { once: { type: "boolean", default: false }, connection: { type: "string" }, full: { type: "boolean", default: false } } });
  const db = createIngestionClient();
  const stop = new AbortController(); const shutdown = () => stop.abort();
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  try {
    if (process.env.LIVE_SYNC_ENABLED !== "true") throw new SyncError("LIVE_SYNC_DISABLED");
    if (values.connection) { const result = await runSync(db, values.connection, { full: values.full }); console.log(JSON.stringify(result)); if (result.status !== "COMPLETED") process.exitCode = 1; return; }
    do {
      const results = await runDueSyncs(db); if (results.length || values.once) console.log(JSON.stringify(results));
      if (values.once && results.some((r) => r.status === "FAILED" || r.status === "PARTIAL")) process.exitCode = 1;
      if (values.once || stop.signal.aborted) break;
      await delay(15000, undefined, { signal: stop.signal }).catch(() => {});
    } while (!stop.signal.aborted);
  } finally { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); await db.$disconnect(); }
}
main().catch((error) => { console.error("Sync worker failed:", error instanceof SyncError ? error.code : "DATABASE_OR_CONFIGURATION_ERROR"); process.exitCode = 1; });
