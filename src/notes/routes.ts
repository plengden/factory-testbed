import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SQLOutputValue } from "node:sqlite";
import { requireUser } from "../auth/routes.ts";
import type { Db } from "../db.ts";
import { removeAttachmentFiles } from "../uploads/store.ts";

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const noteSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
} as const;

const idParams = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", format: "uuid" } },
} as const;

const title = { type: "string", minLength: 1, maxLength: 200 } as const;
const body = { type: "string", maxLength: 10_000 } as const;

function toNote(row: Record<string, SQLOutputValue>): Note {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** The note, only if it belongs to userId. Other users' notes look exactly like missing ones. */
export function findOwnedNote(db: Db, noteId: string, userId: string): Note | null {
  const row = db.prepare("SELECT * FROM notes WHERE id = ? AND owner_id = ?").get(noteId, userId);
  return row ? toNote(row) : null;
}

export async function noteRoutes(app: FastifyInstance, opts: { db: Db; uploadDir: string }) {
  const { db, uploadDir } = opts;
  app.addHook("preHandler", requireUser(db));

  app.get("/notes", { schema: { response: { 200: { type: "array", items: noteSchema } } } }, async (request) => {
    return db.prepare("SELECT * FROM notes WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100")
      .all(request.userId).map(toNote);
  });

  app.post<{ Body: { title: string; body?: string } }>(
    "/notes",
    {
      schema: {
        body: { type: "object", required: ["title"], additionalProperties: false, properties: { title, body } },
        response: { 201: noteSchema },
      },
    },
    async (request, reply) => {
      const now = new Date().toISOString();
      const id = randomUUID();
      db.prepare("INSERT INTO notes (id, owner_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, request.userId, request.body.title, request.body.body ?? "", now, now);
      return reply.code(201).send(findOwnedNote(db, id, request.userId!));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/notes/:id",
    { schema: { params: idParams, response: { 200: noteSchema } } },
    async (request, reply) => {
      const note = findOwnedNote(db, request.params.id, request.userId!);
      return note ?? reply.code(404).send({ error: "not_found" });
    },
  );

  app.patch<{ Params: { id: string }; Body: { title?: string; body?: string } }>(
    "/notes/:id",
    {
      schema: {
        params: idParams,
        body: { type: "object", minProperties: 1, additionalProperties: false, properties: { title, body } },
        response: { 200: noteSchema },
      },
    },
    async (request, reply) => {
      const note = findOwnedNote(db, request.params.id, request.userId!);
      if (!note) return reply.code(404).send({ error: "not_found" });
      db.prepare("UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
        .run(request.body.title ?? note.title, request.body.body ?? note.body, new Date().toISOString(), note.id, request.userId);
      return findOwnedNote(db, note.id, request.userId!);
    },
  );

  app.delete<{ Params: { id: string } }>("/notes/:id", { schema: { params: idParams } }, async (request, reply) => {
    const note = findOwnedNote(db, request.params.id, request.userId!);
    if (!note) return reply.code(404).send({ error: "not_found" });
    const files = db.prepare("SELECT id FROM attachments WHERE note_id = ?").all(note.id).map((r) => String(r.id));
    db.prepare("DELETE FROM notes WHERE id = ? AND owner_id = ?").run(note.id, request.userId);
    await removeAttachmentFiles(uploadDir, files);
    return reply.code(204).send();
  });
}
