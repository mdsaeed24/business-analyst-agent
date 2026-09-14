import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
export const requestSchema = z.strictObject({
  organizationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/),
  from: z.iso.date(), to: z.iso.date(),
  version: z.literal("1.0").default("1.0"),
}).refine((r) => r.from < r.to, "from must precede exclusive to");
export type MetricRequest = z.input<typeof requestSchema>;
export async function periodBounds(tx: Prisma.TransactionClient, from: string, to: string, timezone: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new Error("Invalid metric definition timezone"); }
  // Epoch milliseconds avoid adapter timestamptz decoding that can discard the
  // server's non-UTC offset. Calendar interpretation still happens in PostgreSQL.
  const [raw] = await tx.$queryRaw<{ startMs: number; endMs: number }[]>`
    SELECT (EXTRACT(EPOCH FROM (${from}::date::timestamp AT TIME ZONE ${timezone})) * 1000)::double precision AS "startMs",
           (EXTRACT(EPOCH FROM (${to}::date::timestamp AT TIME ZONE ${timezone})) * 1000)::double precision AS "endMs"`;
  if (!raw || !Number.isFinite(raw.startMs) || !Number.isFinite(raw.endMs) || raw.startMs >= raw.endMs) throw new Error("Invalid timezone period boundaries");
  return { start: new Date(raw.startMs), end: new Date(raw.endMs) };
}
