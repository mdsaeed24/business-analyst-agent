import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "../../generated/prisma/client";
import { HttpError, authenticate, requireMembership, requireSameOrigin } from "../auth/service";
import { fingerprint } from "../investigations/analyze";
import { explanationConfig, type ExplanationConfig } from "./config";
import { buildGrounding, PROMPT_VERSION } from "./grounding";
import { generateExplanation } from "./provider";

export async function explainInvestigation(db: PrismaClient, userId: string, organizationId: string, investigationId: string, config: ExplanationConfig, generate = generateExplanation) {
  const requestId = randomUUID();
  const claim = await db.$transaction(async (tx) => {
    // Serialize short claims per tenant; no transaction is held across HTTP.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))::text`;
    const membership = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!membership || membership.role === "VIEWER") throw new HttpError(403, "Analyst, admin or owner access is required");
    const investigation = await tx.investigation.findFirst({ where: { id: investigationId, organizationId }, include: { evidenceItems: true } });
    if (!investigation) throw new HttpError(404, "Investigation not found");
    let grounding;
    try { grounding = buildGrounding(investigation); } catch { throw new HttpError(409, "This investigation has missing or incompatible evidence; create a new investigation"); }
    const inputHash = fingerprint({ model: config.model, promptVersion: PROMPT_VERSION, grounding });
    const identity = { organizationId, investigationId, inputHash };
    const existing = await tx.explanation.findUnique({ where: { organizationId_investigationId_inputHash: identity } });
    if (existing?.status === "COMPLETED") return { row: existing, grounding, reused: true };
    if (!config.enabled || !config.apiKey) throw new HttpError(503, "DeepSeek is disabled or DEEPSEEK_API_KEY is missing; configure the server to enable explanations");
    const now = new Date(), stale = new Date(now.getTime() - 120000);
    if (existing?.status === "RUNNING" && existing.startedAt > stale) throw new HttpError(409, "An explanation is already being generated; reopen the report shortly");
    if (existing && (existing.attempts >= 3 || existing.startedAt.getTime() > now.getTime() - 60000)) throw new HttpError(429, existing.attempts >= 3 ? "Explanation attempt limit reached for these inputs" : "Wait one minute before retrying this explanation");
    if (!existing && await tx.explanation.count({ where: { organizationId, createdAt: { gte: new Date(now.getTime() - 3600000) } } }) >= 20) throw new HttpError(429, "Organization explanation limit reached; try again later");
    const row = existing ? await tx.explanation.update({ where: { id: existing.id }, data: { status: "RUNNING", requestId, startedAt: now, completedAt: null, errorCode: null, attempts: { increment: 1 }, requestedByMembershipId: membership.id } }) : await tx.explanation.create({ data: { ...identity, promptVersion: PROMPT_VERSION, model: config.model, requestId, requestedByMembershipId: membership.id, startedAt: now } });
    return { row, grounding, reused: false };
  }, { timeout: 30000 });
  if (claim.reused) return { ...claim.row, reused: true };
  try {
    const content = await generate(config, claim.grounding);
    const row = await db.$transaction(async (tx) => {
      const member = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
      if (!member || member.role === "VIEWER") throw new HttpError(403, "Organization access changed; explanation was not saved");
      const updated = await tx.explanation.updateMany({ where: { id: claim.row.id, organizationId, requestId, status: "RUNNING" }, data: { content: content as Prisma.InputJsonValue, status: "COMPLETED", completedAt: new Date(), errorCode: null } });
      if (updated.count !== 1) throw new HttpError(409, "This explanation request was superseded; reopen the report");
      return tx.explanation.findUniqueOrThrow({ where: { id: claim.row.id } });
    });
    return { ...row, reused: false };
  } catch (error) {
    await db.explanation.updateMany({ where: { id: claim.row.id, organizationId, requestId, status: "RUNNING" }, data: { status: "FAILED", errorCode: error instanceof HttpError ? `HTTP_${error.status}` : "GENERATION_FAILED" } });
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Explanation generation failed; deterministic findings are still available");
  }
}
async function access(db: PrismaClient, request: Request, investigationId: string) {
  const userId = await authenticate(db, request), organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(organizationId) || investigationId.length > 200) throw new HttpError(400, "Valid organization and investigation identifiers are required");
  await requireMembership(db, userId, organizationId);
  return { userId, organizationId };
}
export async function postExplanation(db: PrismaClient, request: Request, investigationId: string) {
  requireSameOrigin(request);
  const { userId, organizationId } = await access(db, request, investigationId);
  return explainInvestigation(db, userId, organizationId, investigationId, explanationConfig(process.env));
}
export async function readExplanation(db: PrismaClient, request: Request, investigationId: string) {
  const { organizationId } = await access(db, request, investigationId);
  if (!await db.investigation.findFirst({ where: { id: investigationId, organizationId }, select: { id: true } })) throw new HttpError(404, "Investigation not found");
  const config = explanationConfig(process.env);
  const explanation = await db.explanation.findFirst({ where: { organizationId, investigationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, status: true, content: true, model: true, promptVersion: true, createdAt: true, completedAt: true, errorCode: true, attempts: true } });
  return { enabled: config.enabled, model: config.model, explanation };
}
