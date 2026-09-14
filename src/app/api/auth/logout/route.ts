import { getDb } from "@/server/db/client";
import { logout, sessionCookie } from "@/lib/auth/service";
import { handle, json } from "@/lib/analytics/http";
export async function POST(request: Request) {
  return handle(async () => {
    await logout(getDb(), request);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  });
}
