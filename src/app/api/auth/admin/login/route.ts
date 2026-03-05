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
    const admin = await repo.findByEmail("admin", email);
    if (!admin || admin.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    const validPassword = await verifyPassword(parsed.data.password, admin.passwordHash);
    if (!validPassword) {
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    await repo.touchLastLogin("admin", admin.id);

    const token = signAuthToken({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: "admin",
    });

    const response = NextResponse.json(
      {
        ok: true,
        role: "admin",
        redirectTo: "/tickets/admin",
        profile: { id: admin.id, name: admin.name, email: admin.email },
      },
      { status: 200 }
    );
    return attachAuthCookie(response, token);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: "Admin login failed", detail }, { status: 500 });
  }
}
