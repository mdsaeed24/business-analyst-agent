import { z } from "zod";

export const text = z.string().trim().min(1).max(1000);
export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/);
export const date = z.iso.date().transform((value) => new Date(`${value}T00:00:00Z`));
export const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
export const nullable = <T extends z.ZodType>(schema: T) => z.union([z.literal("").transform(() => null), schema]);
export const integer = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(2147483647));
// Keep decimal inputs as strings: Prisma writes exact PostgreSQL NUMERIC values.
export const money = z.string().regex(/^\d{1,18}(\.\d{1,2})?$/);
export const rate = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/);
export const boolean = z.enum(["true", "false"]).transform((value) => value === "true");
export const currency = z.string().regex(/^[A-Z]{3}$/);
export const timezone = text.refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Invalid IANA timezone");
export const lineage = {
  organization_id: identifier,
  source_record_id: identifier,
  source_updated_at: timestamp,
  ingested_at: timestamp,
  normalized_at: timestamp,
};
