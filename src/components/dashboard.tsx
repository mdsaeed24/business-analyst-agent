"use client";
import Connections from "./connections";
import Investigations from "./investigations";
import { MetricCard, ComparisonChart, sections, type Metric, type Section } from "./dashboard/metrics";
import { useEffect, useRef, useState, type FormEvent } from "react";
type Organization = { id: string; name: string; role: string; isDemo: boolean; timezone: string };
type Evidence = { inputHash: string; engineVersion: string; calculationDetails: { formula?: string; timezone?: string; numerator?: string; denominator?: string; sourceCount?: number; limitations?: string[]; sources?: Record<string, unknown>[] } | null };
export default function Dashboard() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [booting, setBooting] = useState(true);
  const [organizationId, setOrganizationId] = useState("");
  const [from, setFrom] = useState("2026-08-01"), [to, setTo] = useState("2026-09-01");
  const [compare, setCompare] = useState(true), [compareFrom, setCompareFrom] = useState("2026-07-01"), [compareTo, setCompareTo] = useState("2026-08-01");
  const [metrics, setMetrics] = useState<Metric[]>([]), [evidence, setEvidence] = useState<Evidence | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const [section, setSection] = useState<Section>("Overview");
  const organization = organizations.find((o) => o.id === organizationId);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const evidenceRef = useRef<HTMLElement>(null);
  async function api(path: string, options?: RequestInit) {
    const response = await fetch(path, { ...options, cache: "no-store" });
    const data = await response.json();
    if (response.status === 401) { generation.current++; setSignedIn(false); setOrganizations([]); setOrganizationId(""); setMetrics([]); setEvidence(null); }
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }
  async function session() {
    const list: Organization[] = await api("/api/organizations");
    setOrganizations(list); setOrganizationId(list[0]?.id ?? ""); setSignedIn(true);
  }
  useEffect(() => { session().catch((e: Error) => { if (!e.message.includes("Sign in") && !e.message.includes("Session expired")) setError(e.message); }).finally(() => setBooting(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    generation.current++; setMetrics([]); setEvidence(null);
    if (signedIn && organizationId) void load();
    return () => { generation.current++; };
  }, [signedIn, organizationId, from, to, compare, compareFrom, compareTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (evidence) evidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [evidence]);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) }); await session(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function load(event?: FormEvent) {
    event?.preventDefault(); const current = ++generation.current;
    setLoadingMetrics(true); setError(""); setEvidence(null); setMetrics([]);
    const query = new URLSearchParams({ organizationId, from, to, ...(compare ? { compareFrom, compareTo } : {}) });
    try { const data = await api(`/api/metrics?${query}`); if (generation.current === current) setMetrics(data.metrics); }
    catch (e) { if (generation.current === current) setError((e as Error).message); } finally { if (generation.current === current) setLoadingMetrics(false); }
  }
  async function showEvidence(metric: Metric) {
    const current = ++generation.current; setError(""); setEvidence(null); setSelectedName(metric.name);
    try { const data = await api(`/api/metrics/${metric.id}/evidence?${new URLSearchParams({ organizationId })}`); if (generation.current === current) setEvidence(data); }
    catch (e) { if (generation.current === current) setError((e as Error).message); }
  }
  async function signOut() {
    setBusy(true); setError("");
    try { await api("/api/auth/logout", { method: "POST" }); generation.current++; setSignedIn(false); setOrganizations([]); setMetrics([]); setEvidence(null); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const visibleMetrics = metrics.filter((m) => (sections[section] as readonly string[]).includes(m.key));
  const currentLabel = `${from} → ${to}`;
  const previousLabel = `${compareFrom} → ${compareTo}`;
  const chartKeys = section === "Sales" ? ["pipeline_created", "win_rate", "new_customers"] : section === "Operations" ? ["support_volume", "avg_first_response", "web_conversion_rate"] : ["revenue_collected", "mrr", "new_customers"];
  if (booting) return <main><p role="status">Loading your workspace…</p></main>;
  return <div className={signedIn ? "app-shell" : "auth-shell"}>
    {signedIn && <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark" aria-hidden="true">b.</span><span>Business Analyst<span className="brand-caption">YOUR ANALYTICS WORKSPACE</span></span></a>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Dashboard sections">{(Object.keys(sections) as Section[]).map((name, i) => <button key={name} className={`nav-item ${section === name ? "active" : ""}`} aria-pressed={section === name} onClick={() => { setSection(name); document.getElementById("overview")?.scrollIntoView({ block: "start" }); }}><span aria-hidden="true">{["▦", "↗", "▤", "◷"][i]}</span>{name}</button>)}<a className="nav-item" href="#investigations"><span aria-hidden="true">◎</span>Investigations</a></nav>
      <div className="sidebar-note"><span className="status-dot" /> Evidence-backed insights<p>From source records to a clearer business story.</p></div>
      <button className="secondary sign-out" onClick={signOut} disabled={busy}>Sign out</button>
    </aside>}
    <main id="overview">
    <header className="page-header"><div><p className="eyebrow">{signedIn ? `${organization?.name ?? "Workspace"} / Analytics` : "Business Analyst Agent"}</p><h1>{signedIn ? `${section === "Overview" ? "Business" : section} overview` : "Your next insight starts here."}</h1><p className="page-subtitle">{signedIn ? "Understand the numbers. Explore the evidence. Know what to ask next." : "Sign in to explore your business, one clear insight at a time."}</p></div>{signedIn && <span className="workspace-badge">{organization?.role.toLowerCase()} workspace</span>}</header>
    {error && <p role="alert" className="error">{error}</p>}
    {!signedIn ? <form className="panel login" onSubmit={signIn}><h2>Welcome back</h2><p className="muted">Access the organizations and reports shared with you.</p><label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} /></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label><button disabled={busy}>{busy ? "Signing in…" : "Sign in to workspace"}</button><p className="muted">Ask your workspace administrator for an account.</p></form> : <>
      {!organizations.length ? <section className="panel"><h2>No organizations assigned</h2><p>Ask your administrator to grant access to an organization.</p></section> : <>
        {organization?.isDemo && <div className="demo-banner"><span className="demo-pill">DEMO DATA</span><p>A realistic business, powered by synthetic data. Explore freely—these are not real customer records.</p><a href="#investigations">Explore an investigation <span aria-hidden="true">↗</span></a></div>}
        <form className="panel filters" onSubmit={load}>
          <label>Organization<select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>{organizations.map((o) => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
          <label>Start date<input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>End date (exclusive)<input type="date" required value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />Compare periods</label>
          <button className="secondary" disabled={loadingMetrics}>{loadingMetrics ? "Loading…" : "Refresh results"}</button>
          {compare && <div className="comparison-filters"><span className="muted">Compare against</span><label>Comparison start<input type="date" required value={compareFrom} onChange={(e) => setCompareFrom(e.target.value)} /></label><label>Comparison end (exclusive)<input type="date" required value={compareTo} onChange={(e) => setCompareTo(e.target.value)} /></label><span className="muted">Dates follow {organization?.timezone}. End dates are excluded.</span></div>}
        </form>
        <div className="section-heading"><div><p className="eyebrow">THE BIG PICTURE</p><h2>{section === "Overview" ? "Performance at a glance" : `${section} performance`}</h2></div><span className="muted">Saved calculations · {from} to {to} (exclusive)</span></div>
        {loadingMetrics ? <div className="cards" role="status" aria-label="Loading metrics">{[1, 2, 3, 4].map((n) => <div className="panel skeleton" key={n}><span /><span /><span /></div>)}</div> : <section className="cards" aria-label="Business metrics">{visibleMetrics.map((m) => <MetricCard key={m.key} metric={m} onEvidence={showEvidence} />)}</section>}
        {!loadingMetrics && !metrics.length && <div className="panel empty-state"><h3>No results to display</h3><p>Choose a valid period and refresh results. The demo uses saved July and August 2026 calculations.</p></div>}
        {!loadingMetrics && metrics.length > 0 && compare && <><div className="section-heading"><div><p className="eyebrow">SIDE BY SIDE</p><h2>{section === "Sales" ? "Sales & acquisition" : section === "Operations" ? "Customer experience" : "Revenue & customer growth"}</h2></div><div className="chart-legend"><span><i className="previous" />Comparison</span><span><i className="current" />Selected period</span></div></div><section className="chart-grid" aria-label="Period comparison charts">{chartKeys.map((key) => <ComparisonChart key={key} metric={metrics.find((m) => m.key === key)} currentLabel={currentLabel} previousLabel={previousLabel} />)}</section></>}
        {!compare && <p className="muted">Enable Compare periods to see side-by-side charts.</p>}
        <section className="insight-guide" aria-label="Demo walkthrough"><div><span className="guide-icon" aria-hidden="true">✧</span><p className="eyebrow">GO BEYOND THE NUMBERS</p><h2>Turn a change into a conversation.</h2><p>Compare the results, inspect the source evidence, then open an investigation for an AI explanation you can read or listen to.</p><a className="guide-link" href="#investigations">Explore business investigations →</a></div><ol><li><span>01</span><div><strong>Spot the change</strong><p>Compare revenue, pipeline, or customer metrics.</p></div></li><li><span>02</span><div><strong>Check the evidence</strong><p>Every saved calculation has a source trail.</p></div></li><li><span>03</span><div><strong>Hear the business story</strong><p>Open a report’s explanation and voice player.</p></div></li></ol></section>
        <div id="investigations"><Investigations key={`${organizationId}:${from}:${to}:${compareFrom}:${compareTo}`} organizationId={organizationId} role={organization?.role ?? "VIEWER"} from={from} to={to} compareFrom={compareFrom} compareTo={compareTo} api={api} /></div>
        {!organization?.isDemo && <Connections key={organizationId} organizationId={organizationId} role={organization?.role ?? "VIEWER"} api={api} />}
        {evidence && <section ref={evidenceRef} className="panel evidence" aria-label="Calculation evidence"><header><h2>{selectedName}: evidence</h2><button className="secondary" onClick={() => { generation.current++; setEvidence(null); }}>Close evidence</button></header>{evidence.calculationDetails ? <><p>{evidence.calculationDetails.formula}</p><p>{evidence.calculationDetails.sourceCount} source records · {evidence.calculationDetails.timezone}</p><p>Numerator: {evidence.calculationDetails.numerator} · Denominator: {evidence.calculationDetails.denominator}</p>{evidence.calculationDetails.limitations?.map((s) => <p key={s} className="muted">{s}</p>)}<details><summary>Source records and calculation details</summary><pre>{JSON.stringify(evidence.calculationDetails, null, 2)}</pre></details></> : <p>No evidence snapshot is available for this saved result.</p>}<p className="muted fingerprint">Calculation version {evidence.engineVersion} · Input fingerprint {evidence.inputHash}</p></section>}
      </>}
    </>}
    <footer className="dashboard-footer">Business Analyst Agent <span>Deterministic metrics · Traceable evidence · AI-assisted interpretation</span></footer>
  </main></div>;
}
