import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type BadgeTone = "risk" | "caution" | "clear" | "info" | "muted";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  iconOnly?: boolean;
};

export function buttonClassName(variant: ButtonVariant = "secondary", iconOnly = false, className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50",
    variant === "primary" && "bg-foreground px-4 py-2 text-background hover:-translate-y-0.5 hover:opacity-85",
    variant === "secondary" &&
      "border border-foreground/10 bg-surface px-4 py-2 text-foreground/70 hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-foreground/[0.04] hover:text-foreground",
    variant === "ghost" && "px-3 py-1.5 text-foreground/50 hover:bg-foreground/[0.05] hover:text-foreground",
    variant === "danger" &&
      "border border-signal-risk/20 bg-signal-risk/10 px-4 py-2 text-signal-risk hover:-translate-y-0.5 hover:bg-signal-risk/15",
    iconOnly && "h-9 w-9 px-0 py-0",
    className
  );
}

export function AegisButton({
  variant = "secondary",
  iconOnly = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return <button type={type} className={buttonClassName(variant, iconOnly, className)} {...props} />;
}

export function badgeClassName(tone: BadgeTone = "muted", className?: string) {
  return cn(
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-mono font-medium tracking-wide",
    tone === "risk" && "border-red-200 bg-red-50 text-red-600 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300",
    tone === "caution" && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
    tone === "clear" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
    tone === "info" && "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300",
    tone === "muted" && "border-foreground/8 bg-foreground/[0.04] text-foreground/55",
    className
  );
}

export function StatusBadge({
  tone = "muted",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={badgeClassName(tone, className)}>{children}</span>;
}

export function MetricCard({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  const valueClass =
    tone === "risk"
      ? "text-signal-risk"
      : tone === "caution"
        ? "text-signal-caution"
        : tone === "clear"
          ? "text-signal-clear"
          : tone === "info"
            ? "text-signal-info"
            : "text-foreground";

  return (
    <div className={cn("rounded-2xl border border-foreground/8 bg-surface p-4", className)}>
      <p className="mb-2 text-xs font-mono uppercase tracking-widest text-foreground/40">{label}</p>
      <p className={cn("text-3xl font-medium tracking-tight", valueClass)}>{value}</p>
      {sub ? <p className="mt-2 text-sm font-light leading-relaxed text-foreground/60">{sub}</p> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-8 py-16 text-center", className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground/[0.04] text-foreground/40">{icon}</div>
      <p className="text-sm font-medium text-foreground/75">{title}</p>
      <p className="max-w-48 text-sm font-light leading-relaxed text-foreground/55">{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function InlineError({ message, className }: { message: string; className?: string }) {
  return (
    <p className={cn("mt-1 flex items-center gap-1.5 text-xs text-signal-risk", className)}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {message}
    </p>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("h-4 w-4 animate-spin rounded-full border-2 border-foreground border-r-transparent", className)} aria-hidden="true" />;
}

export function ProcessingBadge({ label = "Processing" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-mono font-medium uppercase tracking-widest text-foreground/45">
      <span className="status-live h-1.5 w-1.5 rounded-full bg-signal-caution" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Divider({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("my-4 h-px bg-foreground/8", className)} {...props} />;
}

export function IconWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/55", className)}>{children}</span>;
}
