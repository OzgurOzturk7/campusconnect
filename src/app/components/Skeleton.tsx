import { ReactNode } from "react";

/**
 * Generic skeleton placeholder. Use it as a building block for page-level
 * loading states. Animates with a subtle shimmer in both light and dark.
 */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`bg-muted rounded-md animate-pulse ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 rounded" style={{ width: `${85 - i * 10}%` }} />
      ))}
    </div>
  );
}

/** Card-shaped skeleton — drop-in replacement for "loading a card" states. */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-card border border-border rounded-xl p-5 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2 w-20" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

/** Row skeleton — for list views (notifications, chats, members). */
export function SkeletonRow({ withAvatar = true }: { withAvatar?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
      {withAvatar && <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />}
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-2 w-1/3" />
      </div>
      <Skeleton className="h-2 w-10" />
    </div>
  );
}

/** Grid of N card skeletons. */
export function SkeletonGrid({ count = 6, columns = 3 }: { count?: number; columns?: number }) {
  const colsClass = columns === 2 ? "md:grid-cols-2" : columns === 4 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={`grid grid-cols-1 ${colsClass} gap-6`}>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

/** Stack of N row skeletons. */
export function SkeletonList({ count = 5, withAvatar = true }: { count?: number; withAvatar?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {Array.from({ length: count }).map((_, i) => <SkeletonRow key={i} withAvatar={withAvatar} />)}
    </div>
  );
}

/** Generic page wrapper with header skeleton + body slot. */
export function SkeletonPage({ children }: { children?: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      {children}
    </div>
  );
}
