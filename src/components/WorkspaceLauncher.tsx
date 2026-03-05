"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type WorkspaceLauncherProps = {
  offlinePublicEnabled: boolean;
  offlinePublicState: string;
};

type SecondaryTab = "operations" | "tickets" | "access";

type WorkspaceCard = {
  href: string;
  title: string;
  summary: string;
  cta: string;
  badge?: string;
};

const PRIMARY_WORKSPACES: WorkspaceCard[] = [
  {
    href: "/inbox-scanner",
    title: "Inbox Scanner",
    summary: "Scan incoming email, detect risk, and send important messages directly to Agent Desk.",
    cta: "Start in Inbox Scanner",
    badge: "Recommended Start",
  },
  {
    href: "/agent",
    title: "Agent Desk",
    summary: "Analyze escalated context, run tool-grounded reasoning, and generate trusted response drafts.",
    cta: "Open Agent Desk",
    badge: "Main Agent Workspace",
  },
];

const SECONDARY_TABS: Array<{ id: SecondaryTab; label: string; description: string }> = [
  { id: "operations", label: "Operations", description: "Queue and incident operations." },
  { id: "tickets", label: "Ticket Views", description: "Role-specific dashboards." },
  { id: "access", label: "Access", description: "Login and account setup." },
];

const SECONDARY_FEATURES: Record<SecondaryTab, WorkspaceCard[]> = {
  operations: [
    {
      href: "/tickets",
      title: "Tickets",
      summary: "Track escalations from scanner and agent workflows.",
      cta: "Open Tickets",
    },
    {
      href: "/queueguard",
      title: "QueueGuard",
      summary: "Evaluate queue traffic with adaptive risk controls.",
      cta: "Open QueueGuard",
    },
  ],
  tickets: [
    {
      href: "/tickets/user",
      title: "User Dashboard",
      summary: "View assigned tickets and follow status changes.",
      cta: "Open User Dashboard",
    },
    {
      href: "/tickets/admin",
      title: "Admin Desk",
      summary: "Assign ownership, update status, and resolve tickets.",
      cta: "Open Admin Desk",
    },
  ],
  access: [
    {
      href: "/login",
      title: "Login Home",
      summary: "Choose user or admin sign-in.",
      cta: "Open Login Home",
    },
    {
      href: "/login/user/signup",
      title: "User Sign Up",
      summary: "Create a new user account for ticket workflows.",
      cta: "Open Sign Up",
    },
  ],
};

export default function WorkspaceLauncher({ offlinePublicEnabled, offlinePublicState }: WorkspaceLauncherProps) {
  const [activeTab, setActiveTab] = useState<SecondaryTab>("operations");

  const activeTabLabel = useMemo(
    () => SECONDARY_TABS.find((tab) => tab.id === activeTab)?.label ?? "Operations",
    [activeTab]
  );

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="surface-card p-4 md:p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-sm uppercase tracking-[0.18em] text-[var(--muted)] mb-2">Workspace Home</div>
            <h1 className="text-2xl md:text-3xl font-semibold leading-tight heading-spectrum">
              Start with Agent + Inbox Scanner
            </h1>
            <p className="mt-3 text-sm md:text-base text-[var(--muted)] leading-relaxed">
              This home screen keeps first-time navigation simple: begin in Inbox Scanner, escalate key messages, then
              continue analysis inside Agent Desk.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="subtle-pill px-3 py-2 rounded-full text-[var(--muted)]">
              Offline Mode: {offlinePublicState} ({offlinePublicEnabled ? "active" : "inactive"})
            </span>
            <span className="subtle-pill px-3 py-2 rounded-full text-[var(--muted)]">Primary-first navigation</span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {PRIMARY_WORKSPACES.map((workspace, index) => (
          <div key={workspace.href} className="glass-panel p-4 md:p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-semibold text-slate-100">{workspace.title}</div>
              <span className="meta-pill px-2.5 py-1 rounded-full text-xs">{workspace.badge}</span>
            </div>
            <p className="text-sm text-[var(--muted)] leading-relaxed">{workspace.summary}</p>
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <span className="event-badge px-2 py-1 rounded-full">Step {index + 1}</span>
              <span>{index === 0 ? "Triage incoming risk" : "Analyze and draft response"}</span>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <Link
                href={workspace.href}
                className="primary-cta px-4 py-2 rounded-xl font-semibold text-sm no-underline inline-flex items-center justify-center"
              >
                {workspace.cta}
              </Link>
            </div>
          </div>
        ))}
      </section>

      <section className="surface-card p-4 md:p-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-4">
          <div>
            <div className="text-lg font-semibold text-slate-100">Secondary Features</div>
            <div className="text-sm text-[var(--muted)]">
              Remaining tools are grouped by task to reduce top-level clutter.
            </div>
          </div>
          <div className="subtle-pill px-3 py-2 rounded-full text-xs text-[var(--muted)]">
            Active Group: {activeTabLabel}
          </div>
        </div>

        <div role="tablist" aria-label="Secondary features" className="workspace-tablist mb-4">
          {SECONDARY_TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`workspace-tab-${tab.id}`}
                role="tab"
                aria-selected={selected}
                aria-controls={`workspace-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`workspace-tab ${selected ? "workspace-tab-active" : ""}`}
                title={tab.description}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {SECONDARY_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          const items = SECONDARY_FEATURES[tab.id];

          return (
            <div
              key={tab.id}
              id={`workspace-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`workspace-tab-${tab.id}`}
              hidden={!selected}
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="surface-subcard p-3 no-underline hover:border-cyan-300/45 hover:bg-cyan-400/10"
                >
                  <div className="text-sm font-semibold text-slate-100 mb-1">{item.title}</div>
                  <div className="text-xs text-[var(--muted)] leading-relaxed mb-3">{item.summary}</div>
                  <div className="text-xs font-semibold text-[var(--accent-cyan)]">{item.cta}</div>
                </Link>
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}
