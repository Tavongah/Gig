import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { scrypt } from "node:crypto";

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("scrypt:")) {
    return false;
  }
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) {
    return false;
  }
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  const hashBuffer = Buffer.from(hash, "hex");
  if (hashBuffer.length !== derived.length) {
    return false;
  }
  return timingSafeEqual(hashBuffer, derived);
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createResetToken(): string {
  return randomBytes(32).toString("hex");
}
