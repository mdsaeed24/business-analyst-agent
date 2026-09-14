import { getDb } from "@/server/db/client";
import { login, sessionCookie, SESSION_SECONDS } from "@/lib/auth/service";
import { handle, json } from "@/lib/analytics/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handle(async () => json({ ok: true }, 200, { "Set-Cookie": sessionCookie(await login(getDb(), request), SESSION_SECONDS) }));
}
