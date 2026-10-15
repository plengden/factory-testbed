import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/routes.ts";
import type { Db } from "../db.ts";
import { findOwnedNote } from "../notes/routes.ts";
import { ALLOWED_CONTENT_TYPES, detectContentType, extensionFor } from "./filetype.ts";
import { readAttachment, writeAttachment } from "./store.ts";

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

const uuid = { type: "string", format: "uuid" } as const;

export async function uploadRoutes(app: FastifyInstance, opts: { db: Db; uploadDir: string }) {
  const { db, uploadDir } = opts;
  app.addHook("preHandler", requireUser(db));

  app.post<{ Params: { id: string } }>(
    "/notes/:id/attachments",
    { schema: { params: { type: "object", required: ["id"], additionalProperties: false, properties: { id: uuid } } } },
    async (request, reply) => {
      const note = findOwnedNote(db, request.params.id, request.userId!);
      if (!note) return reply.code(404).send({ error: "not_found" });
      if (!request.isMultipart()) return reply.code(415).send({ error: "unsupported_media_type" });

      // Size and part limits are enforced by the multipart parser (blocks memory exhaustion).
      const file = await request.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0, parts: 1 } });
      if (!file) return reply.code(400).send({ error: "file_required" });
      let bytes: Buffer;
      try {
        bytes = await file.toBuffer();
      } catch (err) {
        if (err instanceof app.multipartErrors.RequestFileTooLargeError) {
          return reply.code(413).send({ error: "file_too_large" });
        }
        throw err;
      }

      const contentType = detectContentType(bytes, file.filename);
      if (!contentType) return reply.code(415).send({ error: "unsupported_media_type" });

      const id = randomUUID();
      await writeAttachment(uploadDir, id, bytes);
      db.prepare("INSERT INTO attachments (id, note_id, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, note.id, contentType, bytes.length, new Date().toISOString());
      return reply.code(201).send({ id, contentType, sizeBytes: bytes.length });
    },
  );

  app.get<{ Params: { id: string; attachmentId: string } }>(
    "/notes/:id/attachments/:attachmentId",
    {
      schema: {
        params: {
          type: "object",
          required: ["id", "attachmentId"],
          additionalProperties: false,
          properties: { id: uuid, attachmentId: uuid },
        },
      },
    },
    async (request, reply) => {
      const note = findOwnedNote(db, request.params.id, request.userId!);
      const row = note
        ? db.prepare("SELECT id, content_type FROM attachments WHERE id = ? AND note_id = ?").get(request.params.attachmentId, note.id)
        : undefined;
      const contentType = row ? String(row.content_type) : "";
      if (!row || !ALLOWED_CONTENT_TYPES.has(contentType)) return reply.code(404).send({ error: "not_found" });
      const id = String(row.id);
      return reply
        .header("content-type", contentType)
        // Always a download, never rendered inline (blocks stored XSS via uploaded files).
        .header("content-disposition", `attachment; filename="${id}${extensionFor(contentType)}"`)
        .send(await readAttachment(uploadDir, id));
    },
  );
}
