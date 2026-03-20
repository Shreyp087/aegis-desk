"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import PanelFrame from "@/components/PanelFrame";
import { AegisButton, MetricCard, StatusBadge } from "@/components/ui/AegisPrimitives";
import { useAuth } from "@/context/AuthContext";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatTimestamp(value: string | null) {
  if (!value) return "Just started";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSessionAge(value: string | null) {
  if (!value) return "Now";

  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff) || diff < 60_000) return "Now";

  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours >= 24) return `${Math.floor(hours / 24)}d`;
  if (hours > 0) return `${hours}h`;

  const minutes = Math.floor(diff / (1000 * 60));
  return `${Math.max(minutes, 1)}m`;
}

function pathLabel(path: string | null) {
  if (!path) return "Not set yet";

  const labels: Record<string, string> = {
    "/": "Launcher",
    "/admin": "Admin Desk",
    "/agent": "Agent Desk",
    "/inbox": "Inbox Scanner",
    "/profile": "Profile",
    "/queueguard": "QueueGuard",
    "/sign-in": "Sign In",
    "/sign-up": "Sign Up",
    "/tickets": "Tickets",
    "/tickets/admin": "Ticket Admin Desk",
    "/tickets/user": "My Tickets",
    "/workspace": "Workspace",
  };

  return labels[path] || path.replace(/^\//, "").replace(/\//g, " / ") || "Root";
}

function IdentityRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 rounded-2xl border border-foreground/8 bg-background/70 p-4">
      <p className="text-xs font-mono uppercase tracking-widest text-foreground/40">{label}</p>
      <p className={cn("text-sm font-light leading-relaxed text-foreground/75", mono && "font-mono text-xs tracking-wide")}>
        {value}
      </p>
    </div>
  );
}

function RoutePill({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-full border border-foreground/10 bg-background px-3 py-1.5 text-sm font-light text-foreground/70 transition-all duration-150 hover:-translate-y-0.5 hover:border-foreground/20 hover:text-foreground"
    >
      {pathLabel(href)}
    </Link>
  );
}

export default function ProfileWorkspace() {
  const router = useRouter();
  const { user, role, loading, sessionMemory, signOut } = useAuth();
  const [pendingAction, setPendingAction] = useState<"signout" | "switch" | null>(null);

  const userInitial = useMemo(() => {
    if (!user) return "A";
    return user.name.trim().charAt(0).toUpperCase() || user.email.trim().charAt(0).toUpperCase() || "A";
  }, [user]);

  const workspaceLinks = useMemo(
    () =>
      role === "admin"
        ? [
            { href: "/admin", label: "Admin Desk" },
            { href: "/inbox", label: "Inbox Scanner" },
            { href: "/agent", label: "Agent Desk" },
            { href: "/tickets/admin", label: "Ticket Admin Desk" },
            { href: "/queueguard", label: "QueueGuard" },
          ]
        : [
            { href: "/inbox", label: "Inbox Scanner" },
            { href: "/agent", label: "Agent Desk" },
            { href: "/tickets/user", label: "My Tickets" },
          ],
    [role]
  );

  if (loading || !user) {
    return (
      <main className="min-h-screen pt-16">
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
        </div>
      </main>
    );
  }

  const handleSignOut = async () => {
    setPendingAction("signout");
    await signOut();
    router.replace("/");
    router.refresh();
  };

  const handleSwitchAccount = async () => {
    setPendingAction("switch");
    await signOut();
    router.replace("/sign-in");
    router.refresh();
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <section className="rounded-3xl border border-foreground/8 bg-surface/90 px-6 py-6 shadow-sm md:px-8 md:py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border border-foreground/10 bg-foreground/5 text-2xl font-mono text-foreground/75">
              {userInitial}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-mono uppercase tracking-[0.2em] text-foreground/40">User Profile</p>
              <h1 className="mt-3 text-3xl font-light tracking-tight text-foreground md:text-5xl">
                {user.name}
              </h1>
              <p className="mt-3 max-w-2xl text-base font-light leading-relaxed text-foreground/60">
                {user.email}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={role === "admin" ? "caution" : "info"}>{role}</StatusBadge>
            <StatusBadge tone="muted">Session only memory</StatusBadge>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Role" value={role === "admin" ? "Admin" : "User"} sub="Current access tier." tone={role === "admin" ? "caution" : "info"} />
        <MetricCard label="Session Age" value={formatSessionAge(sessionMemory.signedInAt)} sub="Elapsed time for this browser session." />
        <MetricCard label="Current View" value={pathLabel(sessionMemory.currentPath)} sub="The latest route saved to session memory." />
        <MetricCard label="Remembered Routes" value={sessionMemory.recentPaths.length} sub="Recent destinations stored for this session." />
      </section>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <PanelFrame
          title="Identity"
          subtitle="Signed-in account details and controls"
          status={<StatusBadge tone={role === "admin" ? "caution" : "info"}>{role}</StatusBadge>}
        >
          <div className="grid gap-4">
            <IdentityRow label="Name" value={user.name} />
            <IdentityRow label="Email" value={user.email} />
            <IdentityRow label="Role" value={role === "admin" ? "Administrator" : "Standard operator"} />
            <IdentityRow label="User ID" value={user.id} mono />

            <div className="flex flex-wrap gap-2 pt-2">
              <AegisButton variant="secondary" onClick={() => void handleSignOut()} disabled={pendingAction !== null}>
                {pendingAction === "signout" ? "Signing out" : "Sign out"}
              </AegisButton>
              <AegisButton variant="primary" onClick={() => void handleSwitchAccount()} disabled={pendingAction !== null}>
                {pendingAction === "switch" ? "Switching" : "Switch account"}
              </AegisButton>
            </div>
          </div>
        </PanelFrame>

        <PanelFrame
          title="In-Session Memory"
          subtitle="What this browser session currently remembers"
          status={<StatusBadge tone="muted">Auto-updated</StatusBadge>}
        >
          <div className="grid gap-4">
            <IdentityRow label="Signed In At" value={formatTimestamp(sessionMemory.signedInAt)} />
            <IdentityRow label="Last Active" value={formatTimestamp(sessionMemory.lastActiveAt)} />
            <IdentityRow label="Current Path" value={sessionMemory.currentPath || "Will appear after navigation"} mono />

            <div className="grid gap-2 rounded-2xl border border-foreground/8 bg-background/70 p-4">
              <p className="text-xs font-mono uppercase tracking-widest text-foreground/40">Recent Routes</p>
              {sessionMemory.recentPaths.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {sessionMemory.recentPaths.map((href) => (
                    <RoutePill key={href} href={href} />
                  ))}
                </div>
              ) : (
                <p className="text-sm font-light leading-relaxed text-foreground/60">
                  This session will start remembering your route history as you move through the workspace.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-foreground/8 bg-foreground/[0.03] p-4 text-sm font-light leading-relaxed text-foreground/60">
              This memory is scoped to the current signed-in browser session. Signing out or switching accounts clears
              it, and a fresh session starts on the next login.
            </div>
          </div>
        </PanelFrame>
      </div>

      <PanelFrame title="Workspace Shortcuts" subtitle="Jump back into the areas available to this account">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspaceLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border border-foreground/8 bg-background/70 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-surface"
            >
              <p className="text-xs font-mono uppercase tracking-widest text-foreground/40">Open</p>
              <p className="mt-2 text-base font-medium tracking-tight text-foreground">{item.label}</p>
              <p className="mt-2 text-sm font-light leading-relaxed text-foreground/60">{item.href}</p>
            </Link>
          ))}
        </div>
      </PanelFrame>
    </div>
  );
}
