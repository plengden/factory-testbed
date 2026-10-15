import { extname } from "node:path";

interface Kind {
  contentType: string;
  extensions: string[];
  magic: number[];
}

// Allowlist. A file is accepted only if its first bytes AND its extension agree on one of these.
const KINDS: Kind[] = [
  { contentType: "image/png", extensions: [".png"], magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: "image/jpeg", extensions: [".jpg", ".jpeg"], magic: [0xff, 0xd8, 0xff] },
  { contentType: "application/pdf", extensions: [".pdf"], magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

export const ALLOWED_CONTENT_TYPES = new Set(KINDS.map((k) => k.contentType));

/** The content type when bytes and filename extension agree on an allowed kind, else null. */
export function detectContentType(bytes: Buffer, filename: string): string | null {
  const kind = KINDS.find((k) => k.magic.every((b, i) => bytes[i] === b));
  if (!kind) return null;
  return kind.extensions.includes(extname(filename).toLowerCase()) ? kind.contentType : null;
}

export function extensionFor(contentType: string): string {
  return KINDS.find((k) => k.contentType === contentType)?.extensions[0] ?? "";
}
