import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE_NAME = "aegis_auth_token";
const PUBLIC_ROUTES = [
  "/",
  "/workspace",
  "/sign-in",
  "/sign-up",
];
const AUTH_ROUTES = ["/sign-in", "/sign-up"];
const PROTECTED_ROUTES = ["/admin", "/agent", "/inbox", "/inbox-scanner", "/profile", "/queueguard", "/tickets"];
const ADMIN_ONLY_PREFIXES = ["/admin", "/queueguard", "/tickets/admin"];

type SessionRole = "admin" | "user" | null;

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.includes(pathname);
}

function decodeRole(token: string | undefined): SessionRole {
  if (!token) return null;

  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = JSON.parse(atob(`${normalized}${padding}`)) as {
      exp?: number;
      role?: string;
    };

    if (typeof decoded.exp === "number" && decoded.exp * 1000 <= Date.now()) {
      return null;
    }

    if (decoded.role === "admin" || decoded.role === "user") {
      return decoded.role;
    }

    return null;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const role = decodeRole(token);
  const hasSession = Boolean(role);

  const isProtected = PROTECTED_ROUTES.some((prefix) => matchesRoute(pathname, prefix));
  const isAdminOnly = ADMIN_ONLY_PREFIXES.some((prefix) => matchesRoute(pathname, prefix));
  const isAuthRoute = AUTH_ROUTES.some((route) => matchesRoute(pathname, route));

  if (!hasSession && isProtected && !isPublicRoute(pathname)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  if (hasSession && isAuthRoute) {
    return NextResponse.redirect(new URL(role === "admin" ? "/admin" : "/inbox", request.url));
  }

  if (hasSession && role !== "admin" && isAdminOnly) {
    return NextResponse.redirect(new URL("/inbox", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
