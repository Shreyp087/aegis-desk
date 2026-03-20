import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <Link
        href="/"
        className="absolute left-6 top-6 flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest opacity-40 transition-opacity duration-150 hover:opacity-70"
      >
        <span aria-hidden="true">←</span>
        <span>Aegis Desk</span>
      </Link>
      {children}
    </div>
  );
}
