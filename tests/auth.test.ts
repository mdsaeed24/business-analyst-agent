import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { HttpError, requireSameOrigin, tokenFrom, sessionCookie, digest } from "../src/lib/auth/service";
import { handle, json } from "../src/lib/analytics/http";
describe("authentication primitives", () => {
  it("salts password hashes and rejects wrong passwords and missing hashes", async () => {
    const password = randomBytes(24).toString("hex");
    const a = await hashPassword(password), b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(a).not.toContain(password);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword("incorrect", a)).toBe(false);
    expect(await verifyPassword(password, null)).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow();
  }, 15000);
  it("rejects cross-origin and missing-origin mutations", () => {
    for (const origin of [undefined, "https://attacker.example"]) expect(() => requireSameOrigin(new Request("http://localhost/api/auth/login", { headers: origin ? { origin } : {} }))).toThrow();
    expect(() => requireSameOrigin(new Request("http://localhost/api/auth/login", { headers: { origin: "http://localhost" } }))).not.toThrow();
    expect(() => requireSameOrigin(new Request("http://localhost:3104/api/auth/login", { headers: { host: "127.0.0.1:3104", origin: "http://127.0.0.1:3104" } }))).not.toThrow();
    expect(() => requireSameOrigin(new Request("http://localhost:3104/api/auth/login", { headers: { host: "127.0.0.1:3104", origin: "http://evil.example" } }))).toThrow();
  });
  it("accepts only complete random tokens and sets restrictive cookies", () => {
    const token = randomBytes(32).toString("hex");
    expect(tokenFrom(new Request("http://localhost", { headers: { cookie: `other=a; ba_session=${token}` } }))).toBe(token);
    expect(tokenFrom(new Request("http://localhost", { headers: { cookie: "ba_session=forged" } }))).toBeNull();
    expect(digest(token)).not.toBe(token);
    expect(sessionCookie(token, 100)).toContain("HttpOnly; SameSite=Strict; Max-Age=100");
    vi.stubEnv("NODE_ENV", "production");
    try { expect(sessionCookie(token, 100)).toContain("; Secure"); } finally { vi.unstubAllEnvs(); }
  });
  it("returns uncached safe errors without exposing database messages", async () => {
    const known = await handle(async () => { throw new HttpError(403, "Organization access denied"); });
    expect(known.status).toBe(403);
    expect(known.headers.get("cache-control")).toBe("no-store");
    const unknown = await handle(async () => { throw new Error("secret database credentials"); });
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: "Unable to complete request" });
    expect(json({ ok: true }).headers.get("cache-control")).toBe("no-store");
  });
});
