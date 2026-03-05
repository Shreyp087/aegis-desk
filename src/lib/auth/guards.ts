import { NextResponse } from "next/server";
import { getServerSession } from "./session";
import { getAuthAccountRepository } from "./repository";
import type { AuthSession } from "./types";

type GuardFailure = { response: NextResponse };

type AuthGuardSuccess = {
  session: AuthSession;
};

type UserGuardSuccess = {
  session: AuthSession;
  user: {
    id: string;
    name: string;
    email: string;
    role: "user";
  };
};

type AdminGuardSuccess = {
  session: AuthSession;
  admin: {
    id: string;
    name: string;
    email: string;
    role: "admin";
  };
};

function unauthorized(message = "Unauthorized"): GuardFailure {
  return {
    response: NextResponse.json({ ok: false, error: message }, { status: 401 }),
  };
}

function forbidden(message = "Forbidden"): GuardFailure {
  return {
    response: NextResponse.json({ ok: false, error: message }, { status: 403 }),
  };
}

export async function requireAuth(): Promise<AuthGuardSuccess | GuardFailure> {
  const session = await getServerSession();
  if (!session) return unauthorized("Authentication required");
  return { session };
}

export async function requireUser(): Promise<UserGuardSuccess | GuardFailure> {
  const auth = await requireAuth();
  if ("response" in auth) return auth;
  if (auth.session.role !== "user") return forbidden("User role required");

  const repo = getAuthAccountRepository();
  const user = await repo.findById("user", auth.session.id);
  if (!user || user.role !== "user") return unauthorized("User account not found");

  return {
    session: auth.session,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: "user",
    },
  };
}

export async function requireAdmin(): Promise<AdminGuardSuccess | GuardFailure> {
  const auth = await requireAuth();
  if ("response" in auth) return auth;
  if (auth.session.role !== "admin") return forbidden("Admin role required");

  const repo = getAuthAccountRepository();
  const admin = await repo.findById("admin", auth.session.id);
  if (!admin || admin.role !== "admin") return unauthorized("Admin account not found");

  return {
    session: auth.session,
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: "admin",
    },
  };
}
