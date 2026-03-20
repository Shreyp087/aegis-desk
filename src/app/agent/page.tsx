import { redirect } from "next/navigation";

import DesktopShell from "@/components/DesktopShell";
import AgentWorkspace from "@/components/agent/AgentWorkspace";
import { getServerSession } from "@/lib/auth/session";

export default async function AgentPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  return (
    <DesktopShell>
      <AgentWorkspace />
    </DesktopShell>
  );
}
