import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv } from "@/server/config";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const env = getServerEnv();
    const adapter = new PrismaPg({
      connectionString: env.DATABASE_URL,
      options: "-c timezone=UTC",
      max: 10,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      query_timeout: 3000,
      statement_timeout: 3000,
    }, { schema: new URL(env.DATABASE_URL).searchParams.get("schema") ?? "public" });
    globalForPrisma.prisma = new PrismaClient({ adapter });
  }
  return globalForPrisma.prisma;
}
