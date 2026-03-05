import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import type { AuthSession, AuthTokenPayload } from "./types";

export const AUTH_COOKIE_NAME = "aegis_auth_token";

function getJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      return "aegis-dev-insecure-secret-change-me";
    }
    throw new Error("AUTH_JWT_SECRET is not configured");
  }
  return secret;
}

function getJwtExpiry(): SignOptions["expiresIn"] {
  return (process.env.AUTH_JWT_EXPIRES_IN || "7d") as SignOptions["expiresIn"];
}

export function signAuthToken(session: AuthSession): string {
  const payload: AuthTokenPayload = {
    sub: session.id,
    email: session.email,
    name: session.name,
    role: session.role,
  };
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: getJwtExpiry(),
    issuer: "aegis-desk",
    audience: "aegis-desk-web",
  });
}

export function verifyAuthToken(token: string): AuthSession | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      issuer: "aegis-desk",
      audience: "aegis-desk-web",
    });
    if (!decoded || typeof decoded !== "object") return null;
    const payload = decoded as Partial<AuthTokenPayload>;
    if (!payload.sub || !payload.email || !payload.name || !payload.role) return null;
    if (payload.role !== "user" && payload.role !== "admin") return null;
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    return null;
  }
}
