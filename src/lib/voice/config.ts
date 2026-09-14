import { z } from "zod";
import { HttpError } from "../auth/service";
const schema = z.object({
  ELEVENLABS_ENABLED: z.enum(["true", "false"]).default("false"),
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_VOICE_ID: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  ELEVENLABS_MODEL: z.literal("eleven_flash_v2_5").default("eleven_flash_v2_5"),
});
export function voiceConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse({ ...env, ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY?.trim() || undefined, ELEVENLABS_VOICE_ID: env.ELEVENLABS_VOICE_ID?.trim() || undefined });
  if (!parsed.success) throw new HttpError(503, "Invalid ElevenLabs server configuration");
  const c = parsed.data;
  return { enabled: c.ELEVENLABS_ENABLED === "true" && Boolean(c.ELEVENLABS_API_KEY && c.ELEVENLABS_VOICE_ID), apiKey: c.ELEVENLABS_API_KEY, voiceId: c.ELEVENLABS_VOICE_ID, model: c.ELEVENLABS_MODEL };
}
export type VoiceConfig = ReturnType<typeof voiceConfig>;
