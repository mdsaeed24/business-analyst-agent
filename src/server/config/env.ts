import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ["postgresql:", "postgres:"].includes(url.protocol) &&
      Boolean(url.hostname) && url.pathname.length > 1;
  }),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export function validateServerEnv(input: Record<string, string | undefined>) {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Report variable names only: validation input may contain credentials.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid server environment: ${fields.join(", ")}`);
  }
  return result.data;
}
