import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Match Next.js precedence; injected deployment variables always win.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation/build do not need a live database. Migration commands require this.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
