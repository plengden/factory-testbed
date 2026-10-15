import multipart from "@fastify/multipart";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import { authRoutes } from "./auth/routes.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { noteRoutes } from "./notes/routes.ts";
import { MAX_ATTACHMENT_BYTES, uploadRoutes } from "./uploads/routes.ts";

export interface AppOptions {
  config: Config;
  db: Db;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp({ config, db, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    // JSON bodies are small; attachments go through multipart with their own cap.
    bodyLimit: 64 * 1024,
    // Reject unknown fields instead of silently dropping them (Fastify's default), and never coerce types.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  if (Sentry.getClient()) Sentry.setupFastifyErrorHandler(app);

  await app.register(multipart, {
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0, parts: 1 },
  });

  app.decorateRequest("userId", null);

  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cache-control", "no-store");
  });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    // Clients get a generic message; details stay in the server log.
    if (error.validation) return reply.code(400).send({ error: "invalid_request" });
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) request.log.error({ err: error }, "unhandled error");
    return reply.code(status).send({ error: status === 500 ? "internal_error" : "request_error" });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "not_found" }));

  app.get("/healthz", async () => {
    db.prepare("SELECT 1").get();
    return { status: "ok", release: config.release, environment: config.environment };
  });

  await app.register(authRoutes, { db });
  await app.register(noteRoutes, { db, uploadDir: config.uploadDir });
  await app.register(uploadRoutes, { db, uploadDir: config.uploadDir });

  return app;
}
