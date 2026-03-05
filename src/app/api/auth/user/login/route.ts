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
  try {
    const parsed = LoginSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid login payload", detail: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const repo = getAuthAccountRepository();
    const user = await repo.findByEmail("user", email);
    if (!user || user.role !== "user") {
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!validPassword) {
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    await repo.touchLastLogin("user", user.id);

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
    return NextResponse.json({ ok: false, error: "User login failed", detail }, { status: 500 });
  }
}
