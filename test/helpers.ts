import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";

export const PASSWORD = "correct horse battery staple";

export async function makeApp() {
  const uploadDir = mkdtempSync(join(tmpdir(), "testbed-uploads-"));
  const config = { ...loadConfig({}), uploadDir, release: "test-release", environment: "test" };
  const db = openDatabase(":memory:");
  const app = await buildApp({ config, db });
  return {
    app,
    db,
    uploadDir,
    async close() {
      await app.close();
      db.close();
      rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

/** Registers and logs in a user; returns the Authorization header for their session. */
export async function signIn(app: FastifyInstance, email: string): Promise<{ authorization: string }> {
  await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: PASSWORD } });
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD } });
  return { authorization: `Bearer ${res.json().token}` };
}
