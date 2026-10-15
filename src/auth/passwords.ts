import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Returns "scrypt$<salt>$<key>" (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltText, keyText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, "base64url");
  const actual = await derive(password, Buffer.from(saltText, "base64url"));
  // Constant-time comparison: blocks timing attacks on the stored hash.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Hash of a random password, so an unknown email costs the same scrypt work as a wrong password
// (blocks account enumeration by response time).
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("base64url"));
