import DesktopShell from "@/components/DesktopShell";
import WorkspaceLauncher from "@/components/WorkspaceLauncher";

export default function RootPage() {
  const offlinePublicState = process.env.NEXT_PUBLIC_OFFLINE_MODE_STATE || "disabled";
  const offlinePublicEnabled = process.env.NEXT_PUBLIC_OFFLINE_MODE === "true";

  return (
    <DesktopShell
      chrome={{
        sectionLabel: "MISSION",
        currentLabel: "Workspace Launcher",
        breadcrumb: ["Aegis Desk", "Workspace Launcher"],
        status: {
          label: offlinePublicEnabled ? `Offline ${offlinePublicState}` : "Idle",
          state: offlinePublicEnabled ? "active" : "idle",
        },
        items: [
          { href: "#launch", label: "Mission Brief", description: "Primary operating launch points." },
          { href: "#guide", label: "Field Manual", description: "Operator onboarding and workflow notes." },
          { href: "#secondary", label: "Secondary Access", description: "Grouped routes beyond the primary flow." },
          { href: "#access", label: "Access Notes", description: "Auth and environment summary." },
        ],
      }}
    >
      <WorkspaceLauncher
        offlinePublicEnabled={offlinePublicEnabled}
        offlinePublicState={offlinePublicState}
      />
    </DesktopShell>
  );
}
