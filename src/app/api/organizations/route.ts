import { getDb } from "@/server/db/client";
import { organizations } from "@/lib/analytics/service";
import { handle, json } from "@/lib/analytics/http";
export async function GET(request: Request) { return handle(async () => json(await organizations(getDb(), request))); }
