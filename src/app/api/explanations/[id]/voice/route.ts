import { getDb } from "@/server/db/client";
import { handle, json } from "@/lib/analytics/http";
import { postNarration, readNarration } from "@/lib/voice/service";
export const runtime = "nodejs";
export const maxDuration = 90;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return handle(async () => json(await readNarration(getDb(), request, (await context.params).id))); }
export async function POST(request: Request, context: Context) { return handle(async () => { const row = await postNarration(getDb(), request, (await context.params).id); return json(row, row.reused ? 200 : 201); }); }
