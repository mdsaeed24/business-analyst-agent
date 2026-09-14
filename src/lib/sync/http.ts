import { SyncError } from "./errors";
export type FetchJson = (url: URL, headers: Record<string, string>) => Promise<unknown>;
// Connectors construct URLs from fixed provider origins and validated IDs.
// This helper never follows provider redirects or logs response bodies.
export function providerHttp(fetcher: typeof fetch = fetch, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): FetchJson {
  return async (url, headers) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try { response = await fetcher(url, { headers, redirect: "error", signal: AbortSignal.timeout(20000) }); }
      catch { if (attempt < 2) { await wait(250 * 2 ** attempt); continue; } throw new SyncError("PROVIDER_UNREACHABLE", true); }
      if (!response.ok) {
        await response.body?.cancel();
        const transient = response.status === 429 || response.status >= 500;
        if (transient && attempt < 2) {
          const delay = Number(response.headers.get("retry-after"));
          await wait(Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1000, 5000) : 250 * 2 ** attempt);
          continue;
        }
        throw new SyncError(response.status === 401 || response.status === 403 ? "PROVIDER_ACCESS_DENIED" : transient ? "PROVIDER_BUSY" : "PROVIDER_REQUEST_REJECTED", transient);
      }
      const reader = response.body?.getReader(); if (!reader) throw new SyncError("INVALID_PROVIDER_RESPONSE");
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new SyncError("PROVIDER_RESPONSE_TOO_LARGE"); }
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (error) { if (error instanceof SyncError) throw error; throw new SyncError("INVALID_PROVIDER_RESPONSE"); }
    }
    throw new SyncError("PROVIDER_UNREACHABLE", true);
  };
}
