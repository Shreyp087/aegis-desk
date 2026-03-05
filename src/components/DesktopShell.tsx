"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  description?: string;
  exact?: boolean;
};

const PRIMARY_NAV: NavItem[] = [
  { href: "/workspace", label: "Home" },
  { href: "/agent", label: "Agent Desk" },
  { href: "/inbox-scanner", label: "Inbox Scanner" },
];

const OPERATIONS_NAV: NavItem[] = [
  { href: "/tickets", label: "Tickets", description: "Track and resolve escalations." },
  { href: "/queueguard", label: "QueueGuard", description: "Run queue risk simulation." },
  { href: "/tickets/user", label: "User Dashboard", description: "View tickets assigned to you." },
  { href: "/tickets/admin", label: "Admin Desk", description: "Admin triage and assignment." },
];

const ACCESS_NAV: NavItem[] = [
  { href: "/login", label: "Login Home", description: "Choose user or admin login.", exact: true },
  { href: "/login/user", label: "User Login", description: "Sign in as user.", exact: true },
  { href: "/login/admin", label: "Admin Login", description: "Sign in as admin.", exact: true },
  { href: "/login/user/signup", label: "User Sign Up", description: "Create a user account.", exact: true },
];

function matchesPath(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavChip({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = matchesPath(pathname, item);

  return (
    <Link
      href={item.href}
      className={`no-underline px-3 py-2 rounded-xl text-xs sm:text-sm font-medium border ${
        active ? "nav-chip-active" : "nav-chip"
      }`}
      aria-current={active ? "page" : undefined}
    >
      {item.label}
    </Link>
  );
}

function NavMenu({
  label,
  items,
  pathname,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
}) {
  const active = items.some((item) => matchesPath(pathname, item));

  return (
    <details className="relative nav-menu">
      <summary
        className={`nav-menu-summary no-underline px-3 py-2 rounded-xl text-xs sm:text-sm font-medium border ${
          active ? "nav-chip-active" : "nav-chip"
        }`}
      >
        {label}
      </summary>
      <div className="nav-menu-panel absolute left-0 top-[calc(100%+8px)] z-20 min-w-[260px] p-2">
        <div className="surface-card p-2 flex flex-col gap-1">
          {items.map((item) => {
            const menuItemActive = matchesPath(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-menu-link no-underline ${menuItemActive ? "nav-menu-link-active" : ""}`}
                aria-current={menuItemActive ? "page" : undefined}
              >
                <span className="nav-menu-link-label">{item.label}</span>
                {item.description ? <span className="nav-menu-link-meta">{item.description}</span> : null}
              </Link>
            );
          })}
        </div>
      </div>
    </details>
  );
}

export default function DesktopShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="relative min-h-screen px-2 py-3 sm:px-3 md:px-6 md:py-7 text-[color:var(--text)]">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <div className="futuristic-shell mx-auto max-w-[1600px] p-3 sm:p-4 md:p-6">
        <div className="ambient-orb orb-cyan h-24 w-24 -top-7 -left-7" />
        <div className="ambient-orb orb-lime h-20 w-20 top-16 right-16" />

        <div className="mb-4 md:mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-11 w-11 rounded-2xl border border-[rgba(93,144,198,0.38)] bg-[rgba(12,20,34,0.65)] flex items-center justify-center halo-focus">
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" className="text-[var(--accent-cyan)]">
                  <path
                    d="M12 2L3 7v6c0 5.1 3.5 9.8 9 11 5.5-1.2 9-5.9 9-11V7l-9-5z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M8.5 12.5l2.2 2.2L15.8 9.6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-xl sm:text-2xl font-semibold heading-spectrum tracking-tight">Aegis Desk</div>
                <div className="text-xs text-[var(--muted)]">Interactive inbox intelligence dashboard</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs justify-start sm:justify-end">
              <span className="status-pill">Local-first</span>
              <span className="status-pill">Auditable</span>
              <span className="status-pill">First-time friendly</span>
            </div>
          </div>

          <div className="mt-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
            <nav className="flex flex-wrap items-center gap-2" aria-label="Global navigation">
              <span className="nav-group-label">Core Workspaces</span>
              {PRIMARY_NAV.map((item) => (
                <NavChip key={item.href} item={item} pathname={pathname} />
              ))}

              <NavMenu label="Operations" items={OPERATIONS_NAV} pathname={pathname} />
              <NavMenu label="Access" items={ACCESS_NAV} pathname={pathname} />
            </nav>

            <div className="text-xs text-[var(--muted)] subtle-pill px-3 py-2 rounded-full">
              Quick start: Inbox Scanner -&gt; Agent Desk -&gt; Tickets
            </div>
          </div>
        </div>

        <main id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
