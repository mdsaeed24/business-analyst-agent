import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { validateServerEnv } from "../src/server/config/env";

export function createIngestionClient() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  const env = validateServerEnv(process.env);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, options: "-c timezone=UTC", max: 2, connectionTimeoutMillis: 5000 }, { schema: new URL(env.DATABASE_URL).searchParams.get("schema") ?? "public" }) });
}
export function failure(error: unknown) {
  // Do not print raw driver messages, connection strings, or record contents.
  console.error("Synthetic command failed:", (error as { code?: string }).code ?? "configuration/connection/runtime error", "Check database configuration, migrations, and development mode.");
  process.exitCode = 1;
}
