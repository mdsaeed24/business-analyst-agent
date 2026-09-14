import { describe, expect, it, vi } from "vitest";
import { providerHttp } from "../src/lib/sync/http";
describe("live connector HTTP boundary", () => {
  it("retries transient read failures and caps backoff", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("private provider body", { status: 429, headers: { "retry-after": "999" } })).mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    const wait = vi.fn(async () => {});
    expect(await providerHttp(fetcher, wait)(new URL("https://example.com/records"), { Authorization: "test-only" })).toEqual({ data: [] });
    expect(wait).toHaveBeenCalledWith(5000);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  });
  it("does not retry access denial or reveal provider content", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private credential", { status: 401 }));
    await expect(providerHttp(fetcher)(new URL("https://example.com"), {})).rejects.toMatchObject({ code: "PROVIDER_ACCESS_DENIED", message: "PROVIDER_ACCESS_DENIED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds retries and rejects malformed responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret"));
    await expect(providerHttp(fetcher, async () => {})(new URL("https://example.com"), {})).rejects.toMatchObject({ code: "PROVIDER_UNREACHABLE" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(providerHttp(vi.fn<typeof fetch>().mockResolvedValue(new Response("invalid JSON")))(new URL("https://example.com"), {})).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
});
