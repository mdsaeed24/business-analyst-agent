import { getDb } from "@/server/db/client";
import { handle, json } from "@/lib/analytics/http";
import { connectionAction } from "@/lib/sync/api";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return handle(async () => json(await connectionAction(getDb(), request, (await context.params).id), 202)); }
