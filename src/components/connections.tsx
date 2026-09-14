"use client";
import { useEffect, useState } from "react";
type Connection = { id: string; name: string; status: string; externalAccountId: string; liveMode: boolean; syncEnabled: boolean; syncIntervalMinutes: number; nextSyncAt: string | null; lastSyncedAt: string | null; syncRequestedAt: string | null; activeRunId: string | null; workerEnabled: boolean; counts: { customers: number; subscriptions: number; payments: number }; syncRuns: { id: string; status: string; fullSync: boolean; startedAt: string; errorCode: string | null; report: unknown }[] };
export default function Connections({ organizationId, role, api }: { organizationId: string; role: string; api: (path: string, options?: RequestInit) => Promise<unknown> }) {
  const [rows, setRows] = useState<Connection[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const query = new URLSearchParams({ organizationId }).toString(), manage = ["OWNER", "ADMIN"].includes(role);
  useEffect(() => {
    let active = true;
    api(`/api/connections?${query}`).then((v) => { if (active) setRows(v as Connection[]); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  async function refresh() { setBusy(true); setError(""); try { setRows(await api(`/api/connections?${query}`) as Connection[]); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function action(id: string, action: string) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await api(`/api/connections/${id}?${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }) as { message: string }; setNotice(result.message); setRows(await api(`/api/connections?${query}`) as Connection[]); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Live data connections">
    <header><h2>Live data connections</h2><button className="secondary" onClick={refresh} disabled={busy}>Refresh sync status</button></header>
    {!rows.length && <p>No live Stripe connection in this organization. An administrator can set one up in a separate workspace using the Stripe setup command documented in Phase 8.</p>}
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {rows.map((row) => <article key={row.id}>
      <h3>{row.name} · {row.liveMode ? "Live mode" : "Test mode"}</h3>
      <p>{row.externalAccountId} · {row.status.toLowerCase()}{row.activeRunId ? " · sync running" : row.syncRequestedAt ? " · sync queued" : ""}</p>
      <p>Customers: {row.counts.customers} · Subscriptions: {row.counts.subscriptions} · Payments: {row.counts.payments}</p>
      <p>Last successful sync: {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString() : "Not yet synced"}. Schedule: {row.syncEnabled ? `every ${row.syncIntervalMinutes} minutes` : "off"}.</p>
      {!row.workerEnabled && <p>Live synchronization is disabled on the server.</p>}
      <p className="muted">Scheduled and queued syncs require the sync worker to be running. Imports update source records; saved metrics and explanations are not automatically recalculated. Live subscription MRR needs a separate billing metric definition.</p>
      {manage && <div className="sync-actions"><button disabled={busy} onClick={() => action(row.id, "sync")}>Sync now</button><button className="secondary" disabled={busy} onClick={() => action(row.id, "full-sync")}>Queue full refresh</button><button className="secondary" disabled={busy} onClick={() => action(row.id, row.syncEnabled ? "disable-schedule" : "enable-schedule")}>{row.syncEnabled ? "Disable schedule" : "Enable schedule"}</button></div>}
      <details><summary>Recent sync runs</summary>{!row.syncRuns.length && <p>No sync runs yet.</p>}{row.syncRuns.map((run) => <div key={run.id}><p>{new Date(run.startedAt).toLocaleString()} · {run.fullSync ? "Full" : "Incremental"} · {run.status.toLowerCase()} {run.errorCode}</p><pre className="sync-report">{JSON.stringify(run.report, null, 2)}</pre></div>)}</details>
    </article>)}
  </section>;
}
