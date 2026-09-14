import { HttpError } from "../auth/service";
import type { VoiceConfig } from "./config";
import { MAX_TEXT_LENGTH } from "./transcript";
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
export const AUDIO_FORMAT = "mp3_44100_128";
export function validateMp3(bytes: Uint8Array) {
  const header = bytes.length >= 3 && ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
  if (!header || bytes.length < 128 || bytes.length > MAX_AUDIO_BYTES) throw new Error("Invalid MP3 payload");
  return bytes;
}
export async function synthesize(config: VoiceConfig, text: string, fetcher: typeof fetch = fetch) {
  if (!config.enabled || !config.apiKey || !config.voiceId) throw new HttpError(503, "ElevenLabs voice generation is not configured");
  if (!text.trim() || text.length > MAX_TEXT_LENGTH) throw new HttpError(413, "Narration text exceeds the supported limit");
  try {
    const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=${AUDIO_FORMAT}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
      headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: config.model, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status === 429 ? 429 : 502, response.status === 429 ? "ElevenLabs is rate limited; try later" : "ElevenLabs request failed; check credentials, voice access and provider availability");
    }
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("audio/mpeg")) { await response.body?.cancel(); throw new Error("Unexpected content type"); }
    const reader = response.body?.getReader(); if (!reader) throw new Error("Empty audio");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) { await reader.cancel(); throw new Error("Audio too large"); }
      chunks.push(value);
    }
    return validateMp3(Buffer.concat(chunks));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (["TimeoutError", "AbortError"].includes((error as Error).name)) throw new HttpError(504, "ElevenLabs timed out; try later");
    throw new HttpError(502, "ElevenLabs returned unavailable or invalid audio; the text remains available");
  }
}
