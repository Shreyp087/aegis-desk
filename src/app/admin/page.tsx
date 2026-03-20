import fs from "fs/promises";
import path from "path";

import Link from "next/link";
import { redirect } from "next/navigation";

import { MetricCard, StatusBadge } from "@/components/ui/AegisPrimitives";
import {
  LOCAL_AUTH_DB_RELATIVE_PATH,
  getAuthDbProvider,
  getLocalAuthDbPathForDisplay,
} from "@/lib/auth/repository";
import { getServerSession } from "@/lib/auth/session";
import { connectMongo } from "@/lib/db/mongoose";
import { AdminModel } from "@/lib/models/Admin";
import { UserModel } from "@/lib/models/User";

type AccountSummary = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  lastLogin: string | null;
};

type LocalAuthState = {
  accounts?: Array<{
    id?: string;
    name?: string;
    email?: string;
    role?: "admin" | "user";
    createdAt?: string;
    lastLogin?: string | null;
  }>;
};

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v3a2 2 0 0 0 0 4v2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-2a2 2 0 0 0 0-4v-3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M12 3.75 18.75 6v5.06c0 4.1-2.8 7.88-6.75 9.19-3.95-1.31-6.75-5.09-6.75-9.19V6L12 3.75Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M4.5 6.75h15l-1.5 10.5h-4.5l-1.5-2.25h-2l-1.5 2.25H6L4.5 6.75Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M16.5 19.5v-1.2a3.3 3.3 0 0 0-3.3-3.3H8.8a3.3 3.3 0 0 0-3.3 3.3v1.2M11 11.25A2.75 2.75 0 1 0 11 5.75a2.75 2.75 0 0 0 0 5.5Zm7 8.25v-1a2.8 2.8 0 0 0-2.8-2.8h-.7M15.5 6.25a2.5 2.5 0 0 1 0 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AdminCapabilityCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href}>
      <div className="group rounded-2xl border border-foreground/8 bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-lg">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/5 text-foreground/40 transition-colors duration-200 group-hover:text-foreground/70">
          {icon}
        </div>
        <h3 className="mb-1 text-sm font-medium">{title}</h3>
        <p className="text-xs font-light leading-relaxed text-foreground/50">{description}</p>
      </div>
    </Link>
  );
}

function formatDate(value: string | null, fallback = "Never") {
  if (!value) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function loadMongoAccounts(): Promise<AccountSummary[]> {
  await connectMongo();

  const [admins, users] = await Promise.all([
    AdminModel.find({})
      .select("_id name email role createdAt lastLogin")
      .sort({ createdAt: -1 })
      .lean<
        Array<{
          _id: { toString(): string };
          name: string;
          email: string;
          role: "admin";
          createdAt?: Date;
          lastLogin?: Date | null;
        }>
      >(),
    UserModel.find({})
      .select("_id name email role createdAt lastLogin")
      .sort({ createdAt: -1 })
      .lean<
        Array<{
          _id: { toString(): string };
          name: string;
          email: string;
          role: "user";
          createdAt?: Date;
          lastLogin?: Date | null;
        }>
      >(),
  ]);

  return [...admins, ...users]
    .map((account) => ({
      id: account._id.toString(),
      name: account.name,
      email: account.email,
      role: account.role,
      createdAt: (account.createdAt || new Date(0)).toISOString(),
      lastLogin: account.lastLogin ? new Date(account.lastLogin).toISOString() : null,
    }))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

async function loadLocalAccounts(): Promise<AccountSummary[]> {
  const target = path.join(process.cwd(), LOCAL_AUTH_DB_RELATIVE_PATH);

  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as LocalAuthState;
    const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];

    return accounts
      .filter(
        (account): account is Required<Pick<AccountSummary, "id" | "name" | "email" | "role" | "createdAt">> & {
          lastLogin: string | null;
        } =>
          Boolean(account) &&
          typeof account.id === "string" &&
          typeof account.name === "string" &&
          typeof account.email === "string" &&
          (account.role === "admin" || account.role === "user") &&
          typeof account.createdAt === "string" &&
          (typeof account.lastLogin === "string" || account.lastLogin === null)
      )
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  } catch {
    return [];
  }
}

async function loadAccounts(): Promise<{ provider: "local" | "mongo"; accounts: AccountSummary[] }> {
  const provider = getAuthDbProvider();
  const accounts = provider === "mongo" ? await loadMongoAccounts() : await loadLocalAccounts();
  return { provider, accounts };
}

export default async function AdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (session.role !== "admin") redirect("/inbox");

  const { provider, accounts } = await loadAccounts();
  const userAccounts = accounts.filter((account) => account.role === "user");
  const adminAccounts = accounts.filter((account) => account.role === "admin");
  const activeAccounts = accounts.filter((account) => account.lastLogin !== null);

  return (
    <main className="min-h-screen pt-16">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <div className="mb-8">
          <p className="mb-1 text-xs font-mono uppercase tracking-widest opacity-40">Administration</p>
          <h1 className="text-2xl font-medium tracking-tight">Admin Desk</h1>
          <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-foreground/60">
            Manage the operator surfaces and review which accounts currently exist in Aegis Desk.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <AdminCapabilityCard
            title="Ticket Admin Desk"
            description="Manage all tickets across all users."
            href="/tickets/admin"
            icon={<TicketIcon />}
          />
          <AdminCapabilityCard
            title="QueueGuard Console"
            description="Monitor queue risk and processing status."
            href="/queueguard"
            icon={<ShieldIcon />}
          />
          <AdminCapabilityCard
            title="Inbox Scanner"
            description="Scan and triage incoming mail."
            href="/inbox"
            icon={<InboxIcon />}
          />
          <AdminCapabilityCard
            title="User Accounts"
            description="Review system users, roles, and recent sign-in activity."
            href="#system-users"
            icon={<UsersIcon />}
          />
        </div>

        <section id="system-users" className="mt-10">
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-1 text-xs font-mono uppercase tracking-widest opacity-40">System Users</p>
              <h2 className="text-2xl font-medium tracking-tight">Accounts using Aegis Desk</h2>
            </div>
            <p className="text-sm font-light text-foreground/55">
              {provider === "mongo"
                ? "Backed by MongoDB auth records."
                : `Backed by local auth file: ${getLocalAuthDbPathForDisplay()}`}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total Accounts" value={accounts.length} sub="All user and admin accounts currently stored." />
            <MetricCard label="Users" value={userAccounts.length} sub="Standard operator accounts." tone="info" />
            <MetricCard label="Admins" value={adminAccounts.length} sub="Administrative access holders." tone="caution" />
            <MetricCard label="Active Accounts" value={activeAccounts.length} sub="Accounts with at least one recorded login." tone="clear" />
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-foreground/8 bg-surface">
            <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-foreground/8 px-4 py-3 text-xs font-mono uppercase tracking-widest text-foreground/40 md:grid">
              <div>Account</div>
              <div>Role</div>
              <div>Created</div>
              <div>Last Login</div>
            </div>

            {accounts.length > 0 ? (
              <div className="divide-y divide-foreground/8">
                {accounts.map((account) => {
                  const isCurrentAccount = account.id === session.id;

                  return (
                    <div
                      key={`${account.role}-${account.id}`}
                      className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{account.name}</p>
                          {isCurrentAccount ? <StatusBadge tone="muted">Current admin</StatusBadge> : null}
                        </div>
                        <p className="mt-1 truncate text-sm font-light text-foreground/60">{account.email}</p>
                      </div>

                      <div>
                        <span className="md:hidden text-xs font-mono uppercase tracking-widest text-foreground/35">Role</span>
                        <div className="mt-1 md:mt-0">
                          <StatusBadge tone={account.role === "admin" ? "caution" : "info"}>{account.role}</StatusBadge>
                        </div>
                      </div>

                      <div className="text-sm font-light text-foreground/60">
                        <span className="md:hidden text-xs font-mono uppercase tracking-widest text-foreground/35">Created</span>
                        <div className="mt-1 md:mt-0">{formatDate(account.createdAt)}</div>
                      </div>

                      <div className="text-sm font-light text-foreground/60">
                        <span className="md:hidden text-xs font-mono uppercase tracking-widest text-foreground/35">Last Login</span>
                        <div className="mt-1 md:mt-0">{formatDate(account.lastLogin, "No login yet")}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-10 text-sm font-light text-foreground/55">
                No accounts were found in the current auth provider.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
