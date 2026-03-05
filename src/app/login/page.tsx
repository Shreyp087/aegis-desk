import Link from "next/link";
import { redirect } from "next/navigation";

import DesktopShell from "@/components/DesktopShell";
import { getServerSession } from "@/lib/auth/session";
import {
  getAuthDbProvider,
  getLocalAuthDbPathForDisplay,
  getLocalAuthSeedPreview,
} from "@/lib/auth/repository";

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export default async function LoginLandingPage() {
  const session = await getServerSession();
  if (session?.role === "admin") redirect("/tickets/admin");
  if (session?.role === "user") redirect("/tickets/user");

  const provider = getAuthDbProvider();
  const mongoAutoSeed = parseBooleanEnv(
    process.env.AUTH_MONGO_AUTO_SEED,
    process.env.NODE_ENV !== "production"
  );
  const showSeedHint =
    process.env.NODE_ENV !== "production" &&
    (provider === "local" || (provider === "mongo" && mongoAutoSeed));
  const localSeed = showSeedHint ? getLocalAuthSeedPreview() : null;

  return (
    <DesktopShell>
      <div className="max-w-5xl mx-auto grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
        <section className="surface-card p-5 md:p-6">
          <div className="text-sm uppercase tracking-[0.18em] text-[var(--muted)] mb-2">Login First</div>
          <h1 className="text-2xl md:text-3xl font-semibold heading-spectrum leading-tight">
            Start at login, then move into the workspace
          </h1>
          <p className="mt-3 text-sm md:text-base text-[var(--muted)] leading-relaxed">
            Choose a role to sign in. After login you can access tickets, inbox scanning, and the agent workspace from
            the navigation bar.
          </p>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="glass-panel p-4 flex flex-col gap-2">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">User</div>
              <div className="text-lg font-semibold text-slate-100">User Login</div>
              <div className="text-sm text-[var(--muted)]">
                Access the user ticket dashboard and personal ticket status views.
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                <Link href="/login/user" className="primary-cta px-3 py-2 rounded-lg text-sm font-semibold no-underline inline-flex w-fit">
                  Sign in as User
                </Link>
                <Link href="/login/user/signup" className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold no-underline inline-flex w-fit">
                  Sign up
                </Link>
              </div>
            </div>

            <Link href="/login/admin" className="glass-panel p-4 no-underline flex flex-col gap-2">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Admin</div>
              <div className="text-lg font-semibold text-slate-100">Admin Login</div>
              <div className="text-sm text-[var(--muted)]">
                Access the admin desk for ticket triage, assignment, and resolution workflows.
              </div>
              <span className="primary-cta mt-1 px-3 py-2 rounded-lg text-sm font-semibold inline-flex w-fit">
                Sign in as Admin
              </span>
            </Link>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href="/workspace" className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold no-underline">
              Open Workspace Launcher
            </Link>
            <Link href="/agent" className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold no-underline">
              Agent Desk
            </Link>
            <Link
              href="/inbox-scanner"
              className="secondary-ghost px-3 py-2 rounded-lg text-sm font-semibold no-underline"
            >
              Inbox Scanner
            </Link>
          </div>
        </section>

        <section className="surface-card p-5 md:p-6 flex flex-col gap-4">
          <div>
            <div className="text-lg font-semibold text-slate-100">Auth Data Source</div>
            <div className="text-sm text-[var(--muted)]">
              Auth auto-uses MongoDB when `MONGODB_URI` is configured; otherwise it falls back to the local file DB.
            </div>
          </div>

          <div className="surface-subcard p-3">
            <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted)] mb-1">Current Provider</div>
            <div className="text-sm font-semibold text-slate-100">{provider === "local" ? "Local file DB" : "MongoDB"}</div>
          </div>

          {showSeedHint && localSeed ? (
            <div className="surface-subcard p-3">
              <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted)] mb-2">Demo Credentials</div>
              <div className="text-xs text-slate-300 leading-relaxed">
                {provider === "local"
                  ? `The local auth DB is auto-seeded on first login attempt and stored at \`${getLocalAuthDbPathForDisplay()}\`.`
                  : "Mongo auth auto-seed is enabled for development; demo user/admin credentials are available below."}
              </div>
              <div className="mt-3 text-xs text-slate-200">
                User: {localSeed.user.email} / {localSeed.user.password}
              </div>
              <div className="mt-1 text-xs text-slate-200">
                Admin: {localSeed.admin.email} / {localSeed.admin.password}
              </div>
            </div>
          ) : null}

          <div className="surface-subcard p-3">
            <div className="text-xs uppercase tracking-[0.12em] text-[var(--muted)] mb-2">Migration Path</div>
            <div className="text-xs text-slate-300 leading-relaxed">
              Auth routes now use a repository interface, so you can later switch the provider to MongoDB or another DB
              by keeping the same `findByEmail`, `findById`, and `touchLastLogin` contract.
            </div>
          </div>
        </section>
      </div>
    </DesktopShell>
  );
}
