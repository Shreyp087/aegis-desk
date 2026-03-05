import type { ReactNode } from "react";

export default function PanelFrame({
  title,
  subtitle,
  children,
  className,
  actionButton,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  actionButton?: ReactNode;
}) {
  return (
    <div className="glass-panel min-h-0 lg:h-full flex flex-col overflow-hidden shadow-[0_8px_20px_rgba(53,103,148,0.14)]">
      <div className="panel-head px-4 py-3 md:px-5 md:py-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold leading-tight heading-spectrum">{title}</div>
          {subtitle ? (
            <div className="text-xs sm:text-sm text-[var(--muted)] leading-snug">{subtitle}</div>
          ) : null}
        </div>
        {actionButton}
      </div>

      <div className={`min-h-0 flex-1 p-3 md:p-5 ${className || ""}`}>{children}</div>
    </div>
  );
}
