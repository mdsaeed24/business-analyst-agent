import { resetSynthetic } from "../src/lib/ingestion/prisma-store";
import { createIngestionClient, failure } from "./ingestion-runtime";

async function main() {
  const db = createIngestionClient();
  try {
    await resetSynthetic(db);
    console.log("Removed only rows marked business-analyst-synthetic-v1. Non-synthetic rows are protected by restrictive foreign keys.");
  } finally { await db.$disconnect(); }
}
main().catch(failure);
