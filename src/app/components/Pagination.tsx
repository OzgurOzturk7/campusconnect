import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}

/**
 * Reusable pagination control. Always rendered (even on a single page) so the
 * range/page info stays visible — matches the rest of the app.
 */
export function Pagination({ page, totalPages, totalItems, pageSize, onPageChange }: PaginationProps) {
  const { t } = useTranslation("common");
  if (totalItems === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  const renderPageNumber = (n: number) => {
    const show = n === 1 || n === totalPages || Math.abs(n - page) <= 1;
    const beforeEllipsis = n === page - 2 && page > 4;
    const afterEllipsis = n === page + 2 && page < totalPages - 3;
    if (beforeEllipsis || afterEllipsis) return <span key={n} className="px-1 self-center text-sm text-muted-foreground">…</span>;
    if (!show) return null;
    return (
      <button
        key={n}
        onClick={() => onPageChange(n)}
        className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
          page === n
            ? "bg-primary text-primary-foreground"
            : "bg-card border border-border hover:bg-muted"
        }`}
      >
        {n}
      </button>
    );
  };

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap pt-4">
      <p className="text-xs text-muted-foreground">
        {t("pagination.showing", { from: start, to: end, total: totalItems })}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          aria-label={t("pagination.prevPage")}
          className="w-9 h-9 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex gap-1">
          {Array.from({ length: totalPages }, (_, i) => renderPageNumber(i + 1))}
        </div>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          aria-label={t("pagination.nextPage")}
          className="w-9 h-9 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("pagination.pageOf", { current: page, total: totalPages })}
      </p>
    </div>
  );
}
