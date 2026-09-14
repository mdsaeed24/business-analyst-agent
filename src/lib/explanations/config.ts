import { z } from "zod";
import { HttpError } from "../auth/service";
const configSchema = z.object({
  DEEPSEEK_ENABLED: z.enum(["true", "false"]).default("false"),
  DEEPSEEK_API_KEY: z.string().trim().min(1).optional(),
  DEEPSEEK_MODEL: z.enum(["deepseek-flash", "deepseek-v4-pro"]).default("deepseek-flash"),
});
export function explanationConfig(env: Record<string, string | undefined>) {
  const parsed = configSchema.safeParse({ ...env, DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY?.trim() || undefined });
  if (!parsed.success) throw new HttpError(503, "Invalid DeepSeek server configuration");
  const c = parsed.data;
  return { enabled: c.DEEPSEEK_ENABLED === "true" && Boolean(c.DEEPSEEK_API_KEY), apiKey: c.DEEPSEEK_API_KEY, model: c.DEEPSEEK_MODEL };
}
export type ExplanationConfig = ReturnType<typeof explanationConfig>;
