import { HttpError } from "../auth/service";
export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...extra } });
}
export async function handle(action: () => Promise<Response>) {
  try { return await action(); } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: "Unable to complete request" }, 500);
  }
}
