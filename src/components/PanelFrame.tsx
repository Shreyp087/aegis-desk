import type { ReactNode } from "react";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export default function PanelFrame({
  title,
  subtitle,
  children,
  className,
  actionButton,
  status,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  actionButton?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-foreground/8 bg-surface shadow-[0_1px_0_rgb(15_15_18/0.02)]">
      <header className="flex min-w-0 shrink-0 flex-col items-start gap-3 border-b border-foreground/6 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 w-full flex-col items-start gap-1 md:flex-row md:items-center md:gap-3">
          <span className="text-xs font-mono uppercase tracking-widest text-foreground/45">{title}</span>
          {subtitle ? <span className="block max-w-full truncate text-sm text-foreground/55">{subtitle}</span> : null}
        </div>
        {(status || actionButton) ? <div className="flex min-w-0 w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">{status}{actionButton}</div> : null}
      </header>
      <div className={cn("flex-1 min-h-0 overflow-y-auto p-4", className)}>{children}</div>
    </section>
  );
}
