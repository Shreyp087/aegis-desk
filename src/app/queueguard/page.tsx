import { redirect } from "next/navigation";

import DesktopShell from "@/components/DesktopShell";
import { QueueGuardDashboard } from "@/components/queueguard/QueueGuardDashboard";
import { getServerSession } from "@/lib/auth/session";

export default async function QueueGuardPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");
  if (session.role !== "admin") redirect("/inbox");

  return (
    <DesktopShell>
      <QueueGuardDashboard />
    </DesktopShell>
  );
}
