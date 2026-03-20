import { redirect } from "next/navigation";

import DesktopShell from "@/components/DesktopShell";
import InboxScannerWorkspace from "@/components/inbox/InboxScannerWorkspace";
import { getServerSession } from "@/lib/auth/session";

export default async function InboxPage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  return (
    <DesktopShell
      chrome={{
        sectionLabel: "INBOX",
        currentLabel: "Inbox Scanner",
        breadcrumb: ["Aegis Desk", "Inbox Scanner"],
        status: { label: "Idle", state: "idle" },
        items: [
          { href: "#scanner-controls", label: "Scan Controls", description: "Source, Gmail, and consensus controls." },
          { href: "#inbox-queue", label: "Inbox Queue", description: "Prioritized email list and filters." },
          { href: "#email-detail", label: "Email Detail", description: "Selected message content and evidence." },
          { href: "#triage-actions", label: "Triage Actions", description: "Escalation, review, and follow-through." },
        ],
      }}
    >
      <InboxScannerWorkspace />
    </DesktopShell>
  );
}
