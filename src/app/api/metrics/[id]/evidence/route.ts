import { getDb } from "@/server/db/client";
import { evidence } from "@/lib/analytics/service";
import { handle, json } from "@/lib/analytics/http";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => json(await evidence(getDb(), request, (await context.params).id)));
}
