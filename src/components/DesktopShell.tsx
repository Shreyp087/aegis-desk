export type DesktopShellItem = {
  href: string;
  label: string;
  description?: string;
  active?: boolean;
};

export type DesktopShellChrome = {
  sectionLabel?: string;
  items?: DesktopShellItem[];
  breadcrumb?: string[];
  currentLabel?: string;
  status?: {
    label: string;
    state: "idle" | "active" | "error";
  };
};

export default function DesktopShell({
  children,
}: {
  children: React.ReactNode;
  chrome?: DesktopShellChrome;
}) {
  return (
    <main id="main-content" className="min-h-screen pt-16">
      {children}
    </main>
  );
}
