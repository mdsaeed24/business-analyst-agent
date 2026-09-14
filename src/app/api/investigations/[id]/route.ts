import { getDb } from "@/server/db/client";
import { handle, json } from "@/lib/analytics/http";
import { getInvestigation } from "@/lib/investigations/service";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handle(async () => json(await getInvestigation(getDb(), request, (await context.params).id))); }
