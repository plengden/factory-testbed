import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db.ts";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

// Only the SHA-256 of a token is stored, so a leaked database cannot be replayed as sessions.
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(db: Db, userId: string, now = new Date()): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(tokenHash(token), userId, expiresAt, now.toISOString());
  return { token, expiresAt };
}

export function userIdForToken(db: Db, token: string, now = new Date()): string | null {
  if (!TOKEN_FORMAT.test(token)) return null;
  const row = db.prepare("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .get(tokenHash(token), now.toISOString());
  return row ? String(row.user_id) : null;
}

export function revokeSession(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}
