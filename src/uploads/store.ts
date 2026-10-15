import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Resolves an attachment id to its file, refusing anything that could leave uploadDir (path traversal). */
export function attachmentPath(uploadDir: string, id: string): string {
  if (!ID_FORMAT.test(id)) throw new Error("invalid attachment id");
  const root = resolve(uploadDir);
  const path = resolve(root, id);
  if (!path.startsWith(root + sep)) throw new Error("attachment path escapes the upload directory");
  return path;
}

export async function writeAttachment(uploadDir: string, id: string, bytes: Buffer): Promise<void> {
  // "wx": never overwrite an existing file; 0600: readable by the service user only.
  await writeFile(attachmentPath(uploadDir, id), bytes, { flag: "wx", mode: 0o600 });
}

export function readAttachment(uploadDir: string, id: string): Promise<Buffer> {
  return readFile(attachmentPath(uploadDir, id));
}

export async function removeAttachmentFiles(uploadDir: string, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => rm(attachmentPath(uploadDir, id), { force: true })));
}
