import DesktopShell from "@/components/DesktopShell";
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function TicketsPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (session.role === "admin") redirect("/tickets/admin");
  if (session.role === "user") redirect("/tickets/user");

  return (
    <DesktopShell>
      <div className="rounded-xl border border-aegis-border bg-aegis-surface p-4 text-sm text-aegis-muted">Redirecting to dashboard...</div>
    </DesktopShell>
  );
}
