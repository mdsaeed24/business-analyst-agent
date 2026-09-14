"use client";
import Voice from "./voice";
import { useEffect, useState } from "react";
import type { ExplanationContent } from "@/lib/explanations/grounding";
type Saved = { id: string; status: string; model: string; content: ExplanationContent | null; completedAt: string | null; attempts: number };
type View = { enabled: boolean; model: string; explanation: Saved | null };
export default function Explanation({ organizationId, investigationId, role, api }: { organizationId: string; investigationId: string; role: string; api: (path: string, options?: RequestInit) => Promise<unknown> }) {
  const [view, setView] = useState<View | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const path = `/api/investigations/${investigationId}/explanation?${new URLSearchParams({ organizationId })}`;
  useEffect(() => {
    let active = true;
    api(path).then((v) => { if (active) setView(v as View); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  async function generate() {
    setBusy(true); setError("");
    try { const saved = await api(path, { method: "POST" }) as Saved; setView((v) => v ? { ...v, explanation: saved } : v); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="AI explanation">
    <h3>AI explanation · DeepSeek</h3>
    <p className="muted">Generate a qualitative explanation from this investigation’s aggregate metrics. Generating sends those aggregates to DeepSeek. Customer details and raw records stay in this application.</p>
    {!view && !error && <p role="status">Loading explanation…</p>}
    {view && !view.enabled && <p>Generating new AI explanations is disabled. Ask your administrator to enable DeepSeek.</p>}
    {view && role === "VIEWER" && <p className="muted">An analyst, admin, or owner can generate an explanation.</p>}
    {view?.explanation?.status === "RUNNING" && <p role="status">Generation is in progress. Reopen the investigation shortly; a stalled request can be retried after two minutes.</p>}
    {view?.explanation?.status === "FAILED" && <p>The previous attempt failed. Your deterministic findings are still available.</p>}
    {view?.enabled && role !== "VIEWER" && <button onClick={generate} disabled={busy}>{busy ? "Generating…" : view.explanation?.status === "COMPLETED" ? "Load cached explanation" : "Generate AI explanation"}</button>}
    {error && <p role="alert" className="error">{error}</p>}
    {view?.explanation?.status === "COMPLETED" && view.explanation.content && <>
      <p className="muted">AI-generated interpretation may contain errors. Figures below come from deterministic calculations; verify interpretations against the saved evidence. Model: {view.explanation.model}.</p>
      <Voice key={view.explanation.id} organizationId={organizationId} explanationId={view.explanation.id} role={role} api={api} />
      {view.explanation.content.insights.map((item) => <article key={item.reference}>
        <h4>{item.key.replaceAll("_", " ")}</h4><p>{item.explanation}</p><p><strong>Suggested check:</strong> {item.suggestedCheck}</p>
        <details><summary>Verified evidence · {item.reference}</summary><p>{item.verifiedStatement}</p><p className="muted">Saved evidence ID: {item.evidenceId}. The original metric snapshots are available below.</p></details>
      </article>)}
    </>}
  </section>;
}
