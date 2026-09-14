import { Prisma } from "../../generated/prisma/client";
import { metricCatalog, type MetricKey } from "./catalog";

// Do not change Prisma's global decimal configuration.
const Decimal = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
export type Term = { numerator: string; denominator: string };
export function subtract(a: string, b: string) { return new Decimal(a).minus(b).toFixed(); }
export function calculate(key: MetricKey, terms: Term[]) {
  let numerator = new Decimal(0), denominator = new Decimal(0);
  for (const term of terms) {
    const n = new Decimal(term.numerator), d = new Decimal(term.denominator);
    if (!n.isFinite() || !d.isFinite() || n.isNegative() || d.isNegative()) throw new Error("Invalid metric contribution");
    numerator = numerator.plus(n); denominator = denominator.plus(d);
  }
  const mode = metricCatalog[key].mode;
  const value = mode === "sum" ? numerator : denominator.isZero() ? null : numerator.div(denominator).mul(mode === "percent" ? 100 : 1);
  // MetricValue NUMERIC(24,8) permits at most 16 integer digits.
  const rounded = value?.toDecimalPlaces(8);
  if (rounded && rounded.abs().gte("10000000000000000")) throw new Error("Metric result exceeds database precision");
  return { value: rounded?.toFixed(8) ?? null, status: value === null ? "NO_DATA" as const : "COMPUTED" as const, numerator: numerator.toFixed(), denominator: denominator.toFixed(), sourceCount: terms.length };
}
