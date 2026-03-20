import DesktopShell from "@/components/DesktopShell";
import { TicketAdminDesk } from "@/components/tickets/TicketAdminDesk";
import { getServerSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export default async function TicketAdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (session.role !== "admin") {
    redirect("/inbox");
  }

  return (
    <DesktopShell>
      <TicketAdminDesk />
    </DesktopShell>
  );
}
