import DesktopShell from "@/components/DesktopShell";
import { UserTicketDashboard } from "@/components/tickets/UserTicketDashboard";
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function UserTicketsPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (session.role !== "user") {
    redirect("/admin");
  }

  return (
    <DesktopShell>
      <UserTicketDashboard />
    </DesktopShell>
  );
}
