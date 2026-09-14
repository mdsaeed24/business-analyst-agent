import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { z } from "zod";
import { createIngestionClient } from "./ingestion-runtime";
import { hashPassword } from "../src/lib/auth/password";
async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, org: { type: "string" }, role: { type: "string", default: "VIEWER" }, name: { type: "string" } } });
  const input = z.object({ email: z.email().transform((s) => s.toLowerCase()), org: z.string().min(1), role: z.enum(["OWNER", "ADMIN", "ANALYST", "VIEWER"]), name: z.string().optional() }).parse(values);
  if (!process.stdin.isTTY) throw new Error("Run interactively to enter your password securely");
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  let password: string;
  try { process.stdout.write("Password (12–128 characters, hidden): "); password = await prompt.question(""); process.stdout.write("\nConfirm password (hidden): "); if (password !== await prompt.question("")) throw new Error("Passwords do not match"); } finally { prompt.close(); process.stdout.write("\n"); }
  const passwordHash = await hashPassword(password);
  const db = createIngestionClient();
  try {
    await db.$transaction(async (tx) => {
      await tx.organization.findUniqueOrThrow({ where: { id: input.org } });
      if (await tx.user.findUnique({ where: { email: input.email } })) throw new Error("Account already exists; no password or access was changed");
      await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, memberships: { create: { organizationId: input.org, role: input.role } } } });
    });
    console.log("Account created. Sign in through the application.");
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Account creation failed. Verify arguments, a new email, matching 12–128 character passwords, and an existing organization. No credentials are printed."); process.exitCode = 1; });
