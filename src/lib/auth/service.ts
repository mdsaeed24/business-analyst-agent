import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { verifyPassword } from "./password";
export const COOKIE = "ba_session";
export const SESSION_SECONDS = 8 * 60 * 60;
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const loginSchema = z.strictObject({ email: z.email().max(254).transform((s) => s.toLowerCase()), password: z.string().min(1).max(128) });
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function tokenFrom(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export async function authenticate(db: PrismaClient, request: Request) {
  const token = tokenFrom(request);
  if (!token) throw new HttpError(401, "Sign in to continue");
  const session = await db.session.findUnique({ where: { tokenHash: digest(token) } });
  if (!session || session.expiresAt <= new Date()) throw new HttpError(401, "Session expired; sign in again");
  return session.userId;
}
export async function requireMembership(db: PrismaClient, userId: string, organizationId: string) {
  const membership = await db.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
  if (!membership) throw new HttpError(403, "Organization access denied");
  return membership;
}
export function requireSameOrigin(request: Request) {
  // Next may normalize request.url to its bind hostname. Browser Origin must
  // match the actual incoming Host, which browsers do not let scripts override.
  const expected = new URL(request.url);
  expected.host = request.headers.get("host") ?? expected.host;
  if (request.headers.get("origin") !== expected.origin) throw new HttpError(403, "Invalid request origin");
}
export async function login(db: PrismaClient, request: Request) {
  requireSameOrigin(request);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new HttpError(413, "Request too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body required");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new HttpError(413, "Request too large"); }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let input: z.output<typeof loginSchema>;
  try { input = loginSchema.parse(JSON.parse(raw)); } catch { throw new HttpError(400, "Enter a valid email and password"); }
  const now = new Date();
  const key = digest(input.email);
  const attempts = await db.$transaction(async (tx) => {
    // Atomic counter/window across application processes; no IP proxy trust needed.
    await tx.loginThrottle.upsert({ where: { key }, create: { key, attempts: 0, windowStart: now }, update: {} });
    await tx.loginThrottle.updateMany({ where: { key, windowStart: { lte: new Date(now.getTime() - 15 * 60000) } }, data: { attempts: 0, windowStart: now } });
    return (await tx.loginThrottle.update({ where: { key }, data: { attempts: { increment: 1 } } })).attempts;
  });
  if (attempts > 10) throw new HttpError(429, "Too many attempts; try again in 15 minutes");
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!await verifyPassword(input.password, user?.passwordHash ?? null) || !user) throw new HttpError(401, "Invalid email or password");
  const token = randomBytes(32).toString("hex");
  await db.$transaction(async (tx) => {
    const previous = tokenFrom(request);
    if (previous) await tx.session.deleteMany({ where: { tokenHash: digest(previous) } });
    await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: now } } });
    await tx.session.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000) } });
  });
  return token;
}
export function sessionCookie(token: string, seconds: number) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function logout(db: PrismaClient, request: Request) {
  requireSameOrigin(request);
  const token = tokenFrom(request);
  if (token) await db.session.deleteMany({ where: { tokenHash: digest(token) } });
}
