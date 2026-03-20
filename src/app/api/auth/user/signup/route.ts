import { NextResponse } from "next/server";
import { z } from "zod";

import { signAuthToken } from "@/lib/auth/jwt";
import {
  AuthEmailExistsError,
  getAuthAccountRepository,
} from "@/lib/auth/repository";
import { attachAuthCookie } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";

const SignupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(180),
  password: z.string().min(8).max(120),
});

export async function POST(req: Request) {
  let step = "parse-request";
  let emailForLog: string | null = null;
  let repoProvider: string | null = null;

  try {
    const parsed = SignupSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid signup payload",
          detail: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    step = "normalize-input";
    const email = parsed.data.email.trim().toLowerCase();
    const name = parsed.data.name.trim();
    emailForLog = email;

    step = "select-repository";
    const repo = getAuthAccountRepository();
    repoProvider = repo.provider;

    step = "check-existing-accounts";
    const [existingUser, existingAdmin] = await Promise.all([
      repo.findByEmail("user", email),
      repo.findByEmail("admin", email),
    ]);
    if (existingUser || existingAdmin) {
      return NextResponse.json(
        { ok: false, error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    step = "hash-password";
    const passwordHash = await hashPassword(parsed.data.password);

    step = "create-user";
    const created = await repo.createUser({
      name,
      email,
      passwordHash,
    });

    step = "touch-last-login";
    await repo.touchLastLogin("user", created.id);

    step = "sign-auth-token";
    const token = signAuthToken({
      id: created.id,
      email: created.email,
      name: created.name,
      role: "user",
    });

    const response = NextResponse.json(
      {
        ok: true,
        role: "user",
        redirectTo: "/tickets/user",
        profile: {
          id: created.id,
          name: created.name,
          email: created.email,
        },
      },
      { status: 201 }
    );

    return attachAuthCookie(response, token);
  } catch (error) {
    if (error instanceof AuthEmailExistsError) {
      return NextResponse.json(
        { ok: false, error: "An account with this email already exists" },
        { status: 409 }
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[auth:user-signup] failed", {
      step,
      provider: repoProvider,
      email: emailForLog,
      nodeEnv: process.env.NODE_ENV || "unknown",
      hasMongoUri: Boolean(process.env.MONGODB_URI),
      hasJwtSecret: Boolean(process.env.AUTH_JWT_SECRET),
      mongoDbName: process.env.MONGODB_DB || "aegis_desk",
      detail,
    });
    return NextResponse.json(
      { ok: false, error: "User signup failed", detail: `${step}: ${detail}` },
      { status: 500 }
    );
  }
}
