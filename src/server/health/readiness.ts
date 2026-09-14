export async function readinessResponse(checkDatabase: () => Promise<unknown>) {
  try {
    await checkDatabase();
    return Response.json({ status: "ready" }, {
      status: 200, headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Do not expose database addresses, credentials, or driver errors.
    return Response.json({ status: "not_ready" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
