import { redirect } from "next/navigation";

import DesktopShell from "@/components/DesktopShell";
import ProfileWorkspace from "@/components/profile/ProfileWorkspace";
import { getServerSession } from "@/lib/auth/session";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) redirect("/sign-in");

  return (
    <DesktopShell>
      <ProfileWorkspace />
    </DesktopShell>
  );
}
