import { getDb } from "@/server/db/client";
import { readinessResponse } from "@/server/health/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return readinessResponse(() => getDb().$queryRaw`SELECT 1`);
}
