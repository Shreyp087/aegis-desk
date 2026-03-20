import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/auth/password";
import { signAuthToken } from "@/lib/auth/jwt";
import { attachAuthCookie } from "@/lib/auth/session";
import { getAuthAccountRepository } from "@/lib/auth/repository";

export const runtime = "nodejs";

const LoginSchema = z.object({
  email: z.string().email().max(180),
  password: z.string().min(8).max(120),
});

export async function POST(req: Request) {
  let step = "parse-request";
  let emailForLog: string | null = null;
  let repoProvider: string | null = null;

  try {
    const parsed = LoginSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid login payload", detail: parsed.error.flatten() },
        { status: 400 }
      );
    }

    step = "normalize-input";
    const email = parsed.data.email.trim().toLowerCase();
    emailForLog = email;

    step = "select-repository";
    const repo = getAuthAccountRepository();
    repoProvider = repo.provider;

    step = "find-user";
    const user = await repo.findByEmail("user", email);
    if (!user || user.role !== "user") {
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    step = "verify-password";
    const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!validPassword) {
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    step = "touch-last-login";
    await repo.touchLastLogin("user", user.id);

    step = "sign-auth-token";
    const token = signAuthToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: "user",
    });

    const response = NextResponse.json(
      {
        ok: true,
        role: "user",
        redirectTo: "/tickets/user",
        profile: { id: user.id, name: user.name, email: user.email },
      },
      { status: 200 }
    );
    return attachAuthCookie(response, token);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[auth:user-login] failed", {
      step,
      provider: repoProvider,
      email: emailForLog,
      nodeEnv: process.env.NODE_ENV || "unknown",
      hasMongoUri: Boolean(process.env.MONGODB_URI),
      hasJwtSecret: Boolean(process.env.AUTH_JWT_SECRET),
      mongoDbName: process.env.MONGODB_DB || "aegis_desk",
      detail,
    });
    return NextResponse.json({ ok: false, error: "User login failed", detail: `${step}: ${detail}` }, { status: 500 });
  }
}
