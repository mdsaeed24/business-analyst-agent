"use client";
import Explanation from "./explanation";
import { useEffect, useState } from "react";
import type { Finding } from "@/lib/investigations/analyze";
type Item = { id: string; question: string; summary: string | null; status: string; createdAt: string; findings?: Finding[] | null; evidenceItems?: { id: string; title: string; details: unknown }[]; reused?: boolean };
type Props = { organizationId: string; role: string; from: string; to: string; compareFrom: string; compareTo: string; api: (path: string, options?: RequestInit) => Promise<unknown> };
export default function Investigations({ organizationId, role, from, to, compareFrom, compareTo, api }: Props) {
  const [history, setHistory] = useState<Item[]>([]), [selected, setSelected] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const query = new URLSearchParams({ organizationId });
  useEffect(() => {
    let active = true;
    api(`/api/investigations?${query}`).then((data) => { if (active) setHistory(data as Item[]); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [organizationId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run() {
    setBusy(true); setError(""); setNotice(""); setSelected(null);
    try {
      const item = await api("/api/investigations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, from, to, compareFrom, compareTo }) }) as Item;
      setSelected(item); setNotice(item.reused ? "Opened the saved investigation for these unchanged inputs." : "Investigation saved with an evidence snapshot.");
      setHistory(await api(`/api/investigations?${query}`) as Item[]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true); setError(""); setNotice("");
    try { setSelected(await api(`/api/investigations/${id}?${query}`) as Item); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel investigations" aria-label="Business investigations">
    <header><h2>Business investigations</h2><button disabled={busy || role === "VIEWER"} onClick={run}>{busy ? "Working…" : "Investigate changes"}</button></header>
    <p>Compare {from} to {to} against {compareFrom} to {compareTo} (end dates exclusive).</p>
    <p className="muted">Uses saved calculations, explicit change rules, and source evidence. Findings show observed changes, not proven causes. Set comparison dates using Compare periods above.</p>
    {role === "VIEWER" && <p className="muted">You can read saved investigations. An analyst, admin, or owner can create one.</p>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {selected && <div className="investigation-result">
      <h3>{selected.question}</h3><p>{selected.summary}</p>
      <div className="cards">{selected.findings?.map((finding) => <article className={`panel finding ${finding.significant ? "flagged" : ""}`} key={finding.key}>
        <h3>{finding.name}</h3><p className="eyebrow">{finding.state.replaceAll("_", " ").toLowerCase()}</p>
        <p>{finding.statement}</p><p><strong>Follow-up:</strong> {finding.nextStep}</p>
        <details><summary>Rule and evidence breakdown</summary><p>Threshold: {finding.rule.threshold} {finding.rule.basis}; at least {finding.rule.minimumSourceRecords} records in each period.</p>
          {finding.breakdown && <><p>{finding.breakdown.explanation}</p><div className="table-scroll"><table><thead><tr><th>{finding.breakdown.dimension}</th><th>Contribution to change</th></tr></thead><tbody>{finding.breakdown.top.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.delta}</td></tr>)}<tr><td>Remaining contributions</td><td>{finding.breakdown.remainingDelta}</td></tr></tbody></table></div></>}
          {finding.limitations.map((line) => <p className="muted" key={line}>{line}</p>)}
        </details>
      </article>)}</div>
      <Explanation key={selected.id} organizationId={organizationId} investigationId={selected.id} role={role} api={api} />
      {selected.evidenceItems ? <details><summary>Original saved metric snapshots</summary><pre>{JSON.stringify(selected.evidenceItems, null, 2)}</pre></details> : <button className="secondary" disabled={busy} onClick={() => open(selected.id)}>Open saved evidence snapshots</button>}
    </div>}
    <h3>Saved investigations</h3><p className="muted">Showing the latest 20 investigations for this organization.</p>
    {!history.length && <p>No saved investigations yet.</p>}
    <ul className="history">{history.map((item) => <li key={item.id}><button className="secondary" disabled={busy} onClick={() => open(item.id)}>{item.question}</button><span className="muted">{new Date(item.createdAt).toLocaleString()} · {item.status.toLowerCase()}</span></li>)}</ul>
  </section>;
}
