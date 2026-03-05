import DesktopShell from "@/components/DesktopShell";
import WorkspaceLauncher from "@/components/WorkspaceLauncher";

export default function WorkspacePage() {
  const offlinePublicState = process.env.NEXT_PUBLIC_OFFLINE_MODE_STATE || "disabled";
  const offlinePublicEnabled = process.env.NEXT_PUBLIC_OFFLINE_MODE === "true";

  return (
    <DesktopShell>
      <WorkspaceLauncher
        offlinePublicEnabled={offlinePublicEnabled}
        offlinePublicState={offlinePublicState}
      />
    </DesktopShell>
  );
}
