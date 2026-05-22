import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

/**
 * Centered placeholder for "nothing here yet" states. Keeps empty lists
 * from looking broken — an icon + a short line, optionally a description
 * and a call-to-action (e.g. a "Create" button).
 *
 * Pass already-translated strings; this component is i18n-agnostic.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}
    >
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <Icon className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
