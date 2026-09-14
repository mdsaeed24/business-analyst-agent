import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client";
import { HttpError, authenticate, requireMembership, requireSameOrigin } from "../auth/service";
import { fingerprint } from "../investigations/analyze";
import { voiceConfig, type VoiceConfig } from "./config";
import { narrationText, TRANSCRIPT_VERSION } from "./transcript";
import { AUDIO_FORMAT, synthesize, validateMp3 } from "./provider";
import { audioResponse } from "./http";
const metadata = { id: true, status: true, transcript: true, voiceId: true, model: true, createdAt: true, completedAt: true, attempts: true, errorCode: true } as const;

export async function generateNarration(db: PrismaClient, userId: string, organizationId: string, explanationId: string, config: VoiceConfig, generate = synthesize) {
  const requestId = randomUUID();
  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"voice:" + organizationId}))::text`;
    const member = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!member || member.role === "VIEWER") throw new HttpError(403, "Analyst, admin or owner access is required to generate voice");
    const explanation = await tx.explanation.findFirst({ where: { id: explanationId, organizationId }, include: { investigation: { include: { evidenceItems: true } } } });
    if (!explanation) throw new HttpError(404, "Explanation not found");
    let transcript: string;
    try { transcript = narrationText(explanation, explanation.investigation); } catch { throw new HttpError(409, "A completed explanation with valid evidence is required for voice playback"); }
    const inputHash = fingerprint({ transcript, version: TRANSCRIPT_VERSION, voiceId: config.voiceId ?? null, model: config.model, format: AUDIO_FORMAT, stability: 0.5, similarityBoost: 0.75 });
    const identity = { organizationId, explanationId, inputHash };
    const existing = await tx.audioNarration.findUnique({ where: { organizationId_explanationId_inputHash: identity }, select: { ...metadata, startedAt: true } });
    if (existing?.status === "COMPLETED") return { row: existing, reused: true };
    if (!config.enabled || !config.apiKey || !config.voiceId) throw new HttpError(503, "ElevenLabs is disabled or its API key and voice ID are missing");
    const now = new Date();
    if (existing?.status === "RUNNING" && existing.startedAt.getTime() > now.getTime() - 180000) throw new HttpError(409, "Voice generation is already running; reopen the report shortly");
    if (existing && (existing.attempts >= 3 || existing.startedAt.getTime() > now.getTime() - 60000)) throw new HttpError(429, existing.attempts >= 3 ? "Voice attempt limit reached for these inputs" : "Wait one minute before retrying voice generation");
    if (!existing && await tx.audioNarration.count({ where: { organizationId, createdAt: { gte: new Date(now.getTime() - 3600000) } } }) >= 10) throw new HttpError(429, "Organization voice limit reached; try later");
    const data = { status: "RUNNING" as const, requestId, startedAt: now, completedAt: null, errorCode: null, requestedByMembershipId: member.id };
    const row = existing ? await tx.audioNarration.update({ where: { id: existing.id }, data: { ...data, attempts: { increment: 1 } }, select: metadata }) : await tx.audioNarration.create({ data: { ...identity, ...data, transcript, transcriptVersion: TRANSCRIPT_VERSION, voiceId: config.voiceId, model: config.model }, select: metadata });
    return { row, reused: false };
  }, { timeout: 30000 });
  if (claim.reused) return { ...claim.row, reused: true };
  try {
    const audio = validateMp3(await generate(config, claim.row.transcript));
    const row = await db.$transaction(async (tx) => {
      const member = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
      if (!member || member.role === "VIEWER") throw new HttpError(403, "Organization access changed; audio was not saved");
      const update = await tx.audioNarration.updateMany({ where: { id: claim.row.id, organizationId, requestId, status: "RUNNING" }, data: { audio: new Uint8Array(audio), status: "COMPLETED", completedAt: new Date() } });
      if (update.count !== 1) throw new HttpError(409, "Voice request superseded; reopen the report");
      return tx.audioNarration.findUniqueOrThrow({ where: { id: claim.row.id }, select: metadata });
    });
    return { ...row, reused: false };
  } catch (error) {
    await db.audioNarration.updateMany({ where: { id: claim.row.id, organizationId, requestId, status: "RUNNING" }, data: { status: "FAILED", errorCode: error instanceof HttpError ? `HTTP_${error.status}` : "GENERATION_FAILED" } });
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Voice generation failed; the text remains available");
  }
}
async function access(db: PrismaClient, request: Request, explanationId: string) {
  const userId = await authenticate(db, request), organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(organizationId) || explanationId.length > 200) throw new HttpError(400, "Valid organization and explanation identifiers are required");
  await requireMembership(db, userId, organizationId);
  return { userId, organizationId };
}
export async function postNarration(db: PrismaClient, request: Request, explanationId: string) {
  requireSameOrigin(request);
  const { userId, organizationId } = await access(db, request, explanationId);
  return generateNarration(db, userId, organizationId, explanationId, voiceConfig(process.env));
}
export async function readNarration(db: PrismaClient, request: Request, explanationId: string) {
  const { organizationId } = await access(db, request, explanationId);
  const explanation = await db.explanation.findFirst({ where: { id: explanationId, organizationId }, include: { investigation: { include: { evidenceItems: true } } } });
  if (!explanation) throw new HttpError(404, "Explanation not found");
  let transcript: string;
  try { transcript = narrationText(explanation, explanation.investigation); } catch { throw new HttpError(409, "A completed explanation with valid evidence is required"); }
  const config = voiceConfig(process.env);
  const narration = await db.audioNarration.findFirst({ where: { explanationId, organizationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: metadata });
  return { enabled: config.enabled, transcript, narration };
}
export async function readAudio(db: PrismaClient, request: Request, explanationId: string, audioId: string) {
  const { organizationId } = await access(db, request, explanationId);
  const row = await db.audioNarration.findFirst({ where: { id: audioId, explanationId, organizationId, status: "COMPLETED" }, select: { audio: true } });
  if (!row?.audio) throw new HttpError(404, "Audio not found");
  return audioResponse(row.audio, request.headers.get("range"));
}
