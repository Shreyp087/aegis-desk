import DesktopShell from "@/components/DesktopShell";
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function TicketsPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login/user");
  }
  if (session.role === "admin") {
    redirect("/tickets/admin");
  }
  if (session.role === "user") {
    redirect("/tickets/user");
  }

  return (
    <DesktopShell>
      <div className="surface-card p-4 text-sm text-slate-200">Redirecting to dashboard...</div>
    </DesktopShell>
  );
}
