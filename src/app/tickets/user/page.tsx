import DesktopShell from "@/components/DesktopShell";
import { UserTicketDashboard } from "@/components/tickets/UserTicketDashboard";
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function UserTicketsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login/user");
  if (session.role !== "user") {
    redirect("/tickets/admin");
  }

  return (
    <DesktopShell>
      <UserTicketDashboard />
    </DesktopShell>
  );
}
