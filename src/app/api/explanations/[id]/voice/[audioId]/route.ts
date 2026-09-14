import { getDb } from "@/server/db/client";
import { handle } from "@/lib/analytics/http";
import { readAudio } from "@/lib/voice/service";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; audioId: string }> }) { return handle(async () => { const { id, audioId } = await context.params; return readAudio(getDb(), request, id, audioId); }); }
