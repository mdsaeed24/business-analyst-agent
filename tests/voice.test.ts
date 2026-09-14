import { describe, expect, it, vi } from "vitest";
import { voiceConfig } from "../src/lib/voice/config";
import { narrationText, MAX_TEXT_LENGTH } from "../src/lib/voice/transcript";
import { synthesize, MAX_AUDIO_BYTES } from "../src/lib/voice/provider";
import { audioResponse } from "../src/lib/voice/http";
const voice = { enabled: true, apiKey: "test-only-key", voiceId: "stockVoice", model: "eleven_flash_v2_5" as const };
const mp3 = () => { const bytes = new Uint8Array(256); bytes.set([0x49, 0x44, 0x33]); return bytes; };
function fixture() {
  const from = "2026-08-01", to = "2026-09-01";
  const snapshot = { key: "revenue_collected", definitionVersion: "1.0", engineVersion: "1.0.0", from, toExclusive: to, timezone: "UTC", unit: "currency", currency: "USD", sourceCount: 1, numerator: "100", denominator: "1", limitations: [], sources: [{ organizationId: "org", sourceRecordId: "private-record", numerator: "100", denominator: "1", email: "private@example.com" }] };
  const saved = { id: "private-metric", value: "100", status: "COMPUTED", inputHash: "hash", snapshot };
  const investigation = { organizationId: "org", engineVersion: "1.0.0", status: "COMPLETED", parameters: { organizationId: "org", from, to, compareFrom: "2026-07-01", compareTo: from }, evidenceItems: [{ id: "private-evidence", organizationId: "org", title: "revenue_collected", details: { investigationVersion: "1.0.0", current: saved, baseline: { ...saved, snapshot: { ...snapshot, from: "2026-07-01", toExclusive: from } } } }] };
  const explanation = { organizationId: "org", status: "COMPLETED", content: { insights: [{ reference: "M1", explanation: "Revenue was unchanged for the observed periods.", suggestedCheck: "Review the records before drawing conclusions.", verifiedStatement: "FORGED NUMBER 99999", evidenceId: "fake", key: "fake" }] } };
  return { investigation, explanation };
}
describe("ElevenLabs narration", () => {
  it("requires explicit enablement, key and a safe voice identifier", () => {
    expect(voiceConfig({}).enabled).toBe(false);
    expect(voiceConfig({ ELEVENLABS_ENABLED: "true", ELEVENLABS_API_KEY: "test" }).enabled).toBe(false);
    expect(voiceConfig({ ELEVENLABS_ENABLED: "true", ELEVENLABS_API_KEY: "test", ELEVENLABS_VOICE_ID: "voice-id" }).enabled).toBe(true);
    expect(() => voiceConfig({ ELEVENLABS_VOICE_ID: "../../secret" })).toThrow(/^Invalid ElevenLabs server configuration$/);
  });
  it("rebuilds verified facts and omits identifiers and raw records", () => {
    const f = fixture(), text = narrationText(f.explanation, f.investigation);
    expect(text).toContain("AI-generated voice");
    expect(text).toContain("current 100");
    expect(text).toContain("Suggested check:");
    for (const hidden of ["private@", "private-record", "private-evidence", "FORGED", "99999"]) expect(text).not.toContain(hidden);
    expect(narrationText(f.explanation, f.investigation)).toBe(text);
  });
  it("rejects incomplete, corrupt and cross-tenant explanations", () => {
    const f = fixture();
    expect(() => narrationText({ ...f.explanation, status: "FAILED" }, f.investigation)).toThrow();
    expect(() => narrationText({ ...f.explanation, organizationId: "other" }, f.investigation)).toThrow();
    f.explanation.content.insights[0].reference = "M8";
    expect(() => narrationText(f.explanation, f.investigation)).toThrow();
  });
  it("requests bounded MP3 speech with server-only authentication", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(mp3(), { headers: { "Content-Type": "audio/mpeg" } }));
    expect((await synthesize(voice, "Saved narration.", fetcher)).length).toBe(256);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/stockVoice?output_format=mp3_44100_128");
    expect(options?.redirect).toBe("error");
    expect(JSON.parse(options!.body as string)).toMatchObject({ text: "Saved narration.", model_id: "eleven_flash_v2_5" });
    expect(options?.headers).toMatchObject({ "xi-api-key": "test-only-key" });
  });
  it("refuses disabled configuration and oversized text without HTTP", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(synthesize({ ...voice, enabled: false }, "Saved text", fetcher)).rejects.toMatchObject({ status: 503 });
    await expect(synthesize(voice, "x".repeat(MAX_TEXT_LENGTH + 1), fetcher)).rejects.toMatchObject({ status: 413 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects wrong types, empty, malformed and oversized audio", async () => {
    for (const response of [new Response("secret", { headers: { "Content-Type": "application/json" } }), new Response(new Uint8Array(), { headers: { "Content-Type": "audio/mpeg" } }), new Response("x".repeat(256), { headers: { "Content-Type": "audio/mpeg" } }), new Response(new Uint8Array(MAX_AUDIO_BYTES + 1), { headers: { "Content-Type": "audio/mpeg" } })]) {
      await expect(synthesize(voice, "Saved text", vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toMatchObject({ status: 502, message: "ElevenLabs returned unavailable or invalid audio; the text remains available" });
    }
  });
  it("sanitizes failures and timeouts without automatically retrying", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret", { status: 429 }));
    await expect(synthesize(voice, "Saved text", fetcher)).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(synthesize(voice, "Saved text", vi.fn<typeof fetch>().mockRejectedValue(new DOMException("secret", "TimeoutError")))).rejects.toMatchObject({ status: 504 });
  });
  it("serves uncached audio and validates ranges for seeking", async () => {
    const bytes = mp3(), full = audioResponse(bytes, null);
    expect(full.status).toBe(200); expect(full.headers.get("Cache-Control")).toBe("private, no-store");
    const partial = audioResponse(bytes, "bytes=0-2");
    expect(partial.status).toBe(206); expect(partial.headers.get("Content-Range")).toBe("bytes 0-2/256");
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(bytes.slice(0, 3));
    expect(audioResponse(bytes, "bytes=-10").headers.get("Content-Length")).toBe("10");
    for (const range of ["bytes=999-", "bytes=9-2", "bytes=0-1,4-5", "bytes=-0", "bytes=-", "bytes=-999999999999999999999999", "invalid"]) expect(audioResponse(bytes, range).status).toBe(416);
  });
});
