import { describe, expect, it } from "vitest";
import { validateServerEnv } from "../src/server/config/env";
import { readinessResponse } from "../src/server/health/readiness";
import { GET } from "../src/app/api/health/live/route";

describe("server environment", () => {
  it("accepts PostgreSQL and defaults the runtime mode", () => {
    expect(validateServerEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5432/analyst" }).NODE_ENV).toBe("development");
  });
  it.each([undefined, "", "https://example.com/db", "postgresql://localhost"]) (
    "rejects missing or invalid database configuration: %s", (DATABASE_URL) => {
      expect(() => validateServerEnv({ DATABASE_URL })).toThrow("DATABASE_URL");
    },
  );
  it("does not expose input secrets in errors", () => {
    expect(() => validateServerEnv({ DATABASE_URL: "https://user:secret@example.com/db" })).toThrow(/^Invalid server environment: DATABASE_URL$/);
  });
});

describe("health probes", () => {
  it("reports liveness without requiring database configuration", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "alive" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("waits for database verification before reporting readiness", async () => {
    let checked = false;
    const response = await readinessResponse(async () => { checked = true; });
    expect(checked).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });
  it("returns a sanitized 503 on database failure", async () => {
    const response = await readinessResponse(async () => { throw new Error("secret database URL"); });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
