import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type PageFrameProps = React.HTMLAttributes<HTMLDivElement>;

export function PageFrame({ className, ...props }: PageFrameProps) {
  return (
    <div
      className={cn("h-full min-w-0 overflow-y-auto bg-[var(--surface-chat)] scrollbar-auto", className)}
      {...props}
    />
  );
}

export function PageContent({ className, ...props }: PageFrameProps) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-7", className)}
      {...props}
    />
  );
}

interface PageHeaderProps extends Omit<PageFrameProps, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: LucideIcon;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  icon: Icon,
  backHref,
  backLabel = "返回",
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn("mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between", className)}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        {backHref && (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] lg:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        {Icon && (
          <span className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--brand-soft)] text-[var(--text-accent)] sm:flex">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-ui-2xs font-medium text-[var(--text-tertiary)]">{eyebrow}</div>
          )}
          <h1 className={cn("text-ui-xl font-semibold text-[var(--text-primary)]", eyebrow && "mt-1")}>
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-ui-caption leading-relaxed text-[var(--text-secondary)]">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="min-w-0 shrink-0">{actions}</div>}
    </header>
  );
}

export function SurfacePanel({ className, ...props }: PageFrameProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-[var(--shadow-sm)]",
        className,
      )}
      {...props}
    />
  );
}

type StatusTone = "neutral" | "brand" | "success" | "warning" | "danger";

const STATUS_TONES: Record<StatusTone, string> = {
  neutral: "bg-[var(--surface-tertiary)] text-[var(--text-secondary)]",
  brand: "bg-[var(--brand-soft)] text-[var(--text-accent)]",
  success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  danger: "bg-[var(--color-destructive-soft)] text-[var(--color-destructive)]",
};

export function StatusPill({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center rounded-md px-2 text-ui-2xs font-semibold",
        STATUS_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
