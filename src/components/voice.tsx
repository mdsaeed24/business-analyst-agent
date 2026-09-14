"use client";
import { useEffect, useRef, useState } from "react";
type Narration = { id: string; status: string; transcript: string; model: string; voiceId: string; attempts: number };
type View = { enabled: boolean; transcript: string; narration: Narration | null };
export default function Voice({ organizationId, explanationId, role, api }: { organizationId: string; explanationId: string; role: string; api: (path: string, options?: RequestInit) => Promise<unknown> }) {
  const [view, setView] = useState<View | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const base = `/api/explanations/${explanationId}/voice`, query = new URLSearchParams({ organizationId }).toString();
  useEffect(() => {
    let active = true;
    api(`${base}?${query}`).then((v) => { if (active) setView(v as View); }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [base, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const audioId = view?.narration?.status === "COMPLETED" ? view.narration.id : null;
  useEffect(() => {
    const player = audio.current;
    return () => { if (player) { player.pause(); player.removeAttribute("src"); player.load(); } };
  }, [audioId]);
  async function generate() {
    setBusy(true); setError("");
    try { const narration = await api(`${base}?${query}`, { method: "POST" }) as Narration; setView((v) => v ? { ...v, narration } : v); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="voice" aria-label="Voice playback">
    <h4>Listen to this explanation</h4>
    <p className="muted">Generating sends the narration text below to ElevenLabs to create an AI voice. It includes the saved interpretation and verified metric statements. Raw source records are not sent.</p>
    {!view && !error && <p role="status">Loading voice options…</p>}
    {view && !view.enabled && <p>New voice generation is disabled. Ask your administrator to configure ElevenLabs.</p>}
    {view && role === "VIEWER" && <p className="muted">You can listen to saved audio. An analyst, admin, or owner can generate it.</p>}
    {view?.enabled && role !== "VIEWER" && <button onClick={generate} disabled={busy}>{busy ? "Preparing AI briefing…" : "Prepare AI Briefing"}</button>}
    {view?.narration?.status === "RUNNING" && <p role="status">Voice generation is running. Reopen this investigation shortly. A stalled request can be retried after three minutes.</p>}
    {view?.narration?.status === "FAILED" && <p>The previous voice attempt failed. The explanation text is still available.</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {audioId && <div>
      <audio key={audioId} ref={audio} controls preload="none" src={`${base}/${audioId}?${query}`} aria-label="Saved explanation narration" onError={() => setError("Audio could not be played. Check your session and reopen the report.")} />
      <button className="secondary" onClick={() => { if (audio.current) { audio.current.pause(); audio.current.currentTime = 0; } }}>Stop audio</button>
    </div>}
    {view && <details><summary>Narration text</summary><p style={{ whiteSpace: "pre-wrap" }}>{audioId ? view.narration!.transcript : view.transcript}</p></details>}
  </section>;
}
