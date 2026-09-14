export type Metric = { key: string; name: string; unit: string; currency?: string | null; id?: string | null; value: string | null; status: string; computedAt?: string | null; comparison: { value: string | null; delta: string | null; deltaUnit: string; relativePercent: string | null } | null };
export function format(value: string | null, unit: string, currency?: string | null) {
  if (value === null) return "—";
  const text = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, ...(unit === "currency" ? { style: "currency", currency: currency ?? "USD" } : {}) }).format(Number(value));
  return `${text}${unit === "percent" ? "%" : unit === "duration" ? " min" : ""}`;
}
export const sections = {
  Overview: ["revenue_collected", "mrr", "new_customers", "win_rate"],
  Sales: ["pipeline_created", "win_rate", "new_customers", "web_conversion_rate"],
  Billing: ["revenue_collected", "mrr", "new_customers"],
  Operations: ["support_volume", "avg_first_response", "web_conversion_rate"],
} as const;
export type Section = keyof typeof sections;
const descriptions: Record<string, string> = {
  revenue_collected: "Successful payments, less refunds",
  mrr: "Recurring revenue at period end",
  new_customers: "Customers added during the period",
  pipeline_created: "Value of deals created, across all stages",
  win_rate: "Won deals as a share of closed deals",
  web_conversion_rate: "Conversions as a share of web sessions",
  support_volume: "Support tickets opened during the period",
  avg_first_response: "Average time to first support response",
};
export function MetricCard({ metric: m, onEvidence }: { metric: Metric; onEvidence: (metric: Metric) => void }) {
  const delta = m.comparison?.delta;
  // Direction is descriptive, not a claim that every increase is beneficial.
  const change = delta === null || delta === undefined ? null : Number(delta);
  const relative = m.comparison?.relativePercent;
  return <article className="panel metric-card">
    <div className="metric-label"><h3>{m.name.replaceAll("_", " ")}</h3><span aria-hidden="true" className="metric-symbol">{m.unit === "currency" ? "$" : m.unit === "percent" ? "%" : m.unit === "duration" ? "◷" : "#"}</span></div>
    <p className="value">{format(m.value, m.unit, m.currency)}</p>
    <p className="metric-description">{descriptions[m.key]}</p>
    {m.status !== "COMPUTED" ? <p className="muted">{m.status === "NO_DATA" ? "Not enough source data." : "No saved calculation for this period."}</p> : m.comparison && <p className="comparison"><span className="change-badge">{change === null ? "Comparison unavailable" : `${change > 0 ? "↑ +" : change < 0 ? "↓ " : "→ "}${m.unit === "percent" ? `${format(delta!, "count")} pp` : relative !== null && relative !== undefined ? `${format(relative, "count")}%` : format(delta!, m.unit, m.currency)}`}</span>{change !== null && <span> vs comparison</span>}</p>}
    {m.id && <button className="text-button" onClick={() => onEvidence(m)}>View calculation <span aria-hidden="true">↗</span></button>}
  </article>;
}
export function ComparisonChart({ metric, currentLabel, previousLabel }: { metric?: Metric; currentLabel: string; previousLabel: string }) {
  if (!metric) return null;
  const values = [{ label: previousLabel, value: metric.comparison?.value ?? null, tone: "previous" }, { label: currentLabel, value: metric.value, tone: "current" }];
  const max = Math.max(1, ...values.map((v) => Math.abs(Number(v.value ?? 0))));
  return <article className="panel chart-panel">
    <p className="eyebrow">Period comparison</p><h3>{metric.name.replaceAll("_", " ")}</h3>
    <div className="bar-chart" role="img" aria-label={`${metric.name}: ${values.map((v) => `${v.label}: ${format(v.value, metric.unit, metric.currency)}`).join("; ")}`}>
      {values.map((v) => <div className="chart-column" key={v.tone}>
        <span className="chart-number">{format(v.value, metric.unit, metric.currency)}</span>
        <div className="bar-track"><div className={`chart-bar ${v.tone}`} style={{ height: v.value === null ? 0 : `${Math.abs(Number(v.value)) / max * 100}%` }} /></div>
        <span className="chart-label">{v.label}</span>
      </div>)}
    </div>
    <p className="muted chart-footnote">{values.some((v) => v.value === null) ? "A saved value is unavailable for one or both periods." : "Saved period totals. Bar height shows magnitude; labels retain the sign."}</p>
  </article>;
}
