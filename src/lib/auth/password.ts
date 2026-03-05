import { compare, hash } from "bcryptjs";

const BCRYPT_ROUNDS = Number(process.env.AUTH_BCRYPT_ROUNDS || "12");

export async function hashPassword(raw: string): Promise<string> {
  return hash(raw, BCRYPT_ROUNDS);
}

export async function verifyPassword(raw: string, hash: string): Promise<boolean> {
  return compare(raw, hash);
}
