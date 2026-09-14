import { getDb } from "@/server/db/client";
import { handle, json } from "@/lib/analytics/http";
import { postExplanation, readExplanation } from "@/lib/explanations/service";
export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handle(async () => json(await readExplanation(getDb(), request, (await context.params).id))); }
export async function POST(request: Request, context: Context) { return handle(async () => { const result = await postExplanation(getDb(), request, (await context.params).id); return json(result, result.reused ? 200 : 201); }); }
