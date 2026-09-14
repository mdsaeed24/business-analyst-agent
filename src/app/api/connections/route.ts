import { getDb } from "@/server/db/client";
import { handle, json } from "@/lib/analytics/http";
import { listConnections } from "@/lib/sync/api";
export async function GET(request: Request) { return handle(async () => json(await listConnections(getDb(), request))); }
