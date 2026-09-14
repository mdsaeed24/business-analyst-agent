import { getDb } from "@/server/db/client";
import { handle, json } from "@/lib/analytics/http";
import { createFromRequest, listInvestigations } from "@/lib/investigations/service";
export async function GET(request: Request) { return handle(async () => json(await listInvestigations(getDb(), request))); }
export async function POST(request: Request) { return handle(async () => { const result = await createFromRequest(getDb(), request); return json(result, result.reused ? 200 : 201); }); }
