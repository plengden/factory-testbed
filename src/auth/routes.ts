import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db.ts";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./passwords.ts";
import { createSession, revokeSession, userIdForToken } from "./sessions.ts";

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
  }
}

interface Credentials {
  email: string;
  password: string;
}

const credentialsSchema = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", format: "email", maxLength: 254 },
    // The upper bound caps scrypt work per request.
    password: { type: "string", minLength: 12, maxLength: 256 },
  },
} as const;

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

/** preHandler for protected routes: resolves the bearer token to request.userId or answers 401. */
export function requireUser(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    const userId = token ? userIdForToken(db, token) : null;
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    request.userId = userId;
  };
}

export async function authRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  app.post<{ Body: Credentials }>("/auth/register", { schema: { body: credentialsSchema } }, async (request, reply) => {
    const { email, password } = request.body;
    const existing = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
    if (existing) return reply.code(409).send({ error: "registration_failed" });
    const id = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, email, await hashPassword(password), new Date().toISOString());
    return reply.code(201).send({ id, email });
  });

  app.post<{ Body: Credentials }>(
    "/auth/login",
    {
      schema: {
        body: credentialsSchema,
        // The serializer emits only these fields, whatever the handler returns.
        response: {
          200: { type: "object", properties: { token: { type: "string" }, expiresAt: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const user = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email);
      const ok = await verifyPassword(password, user ? String(user.password_hash) : DUMMY_HASH);
      if (!user || !ok) return reply.code(401).send({ error: "invalid_credentials" });
      return createSession(db, String(user.id));
    },
  );

  app.post("/auth/logout", { preHandler: requireUser(db) }, async (request, reply) => {
    const token = bearerToken(request);
    if (token) revokeSession(db, token);
    return reply.code(204).send();
  });
}
