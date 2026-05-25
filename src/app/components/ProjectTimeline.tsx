import { Calendar, Clock, Target, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ProjectTimelineProps {
  project: {
    start_date?: string;
    deadline?: string;
    created_at?: string;
  };
}

/**
 * Shows a project's timeline: start → current → deadline, with a progress
 * bar, current day/week, and human-friendly time remaining.
 *
 * Renders nothing if neither start_date nor deadline is set (so older
 * projects without dates don't get an empty box).
 */
export function ProjectTimeline({ project }: ProjectTimelineProps) {
  const { t, i18n } = useTranslation("common");
  const hasStart = Boolean(project.start_date);
  const hasEnd = Boolean(project.deadline);
  if (!hasStart && !hasEnd) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = project.start_date ? new Date(project.start_date) : (project.created_at ? new Date(project.created_at) : today);
  start.setHours(0, 0, 0, 0);
  const end = project.deadline ? new Date(project.deadline) : null;
  if (end) end.setHours(0, 0, 0, 0);

  const totalDays = end ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000)) : null;
  const elapsedDays = Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000));
  const remainingDays = end ? Math.round((end.getTime() - today.getTime()) / 86_400_000) : null;
  const progressPct = totalDays ? Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100)) : 0;

  const isBeforeStart = today.getTime() < start.getTime();
  const isCompleted = end && today.getTime() > end.getTime();

  const fmt = (d: Date) => d.toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" });

  // Status text
  let statusLabel = "";
  let statusColor = "";
  if (isBeforeStart) {
    const daysToStart = Math.round((start.getTime() - today.getTime()) / 86_400_000);
    statusLabel = t("timeline.startsIn", { count: daysToStart });
    statusColor = "text-blue-600";
  } else if (isCompleted) {
    statusLabel = t("timeline.endedAgo", { count: Math.abs(remainingDays || 0) });
    statusColor = "text-muted-foreground";
  } else if (remainingDays !== null) {
    if (remainingDays <= 0) {
      statusLabel = t("timeline.dueToday");
      statusColor = "text-red-600";
    } else if (remainingDays <= 7) {
      statusLabel = t("timeline.daysLeft", { count: remainingDays });
      statusColor = "text-amber-600";
    } else {
      const weeks = Math.round(remainingDays / 7);
      statusLabel = t("timeline.weeksLeft", { count: weeks });
      statusColor = "text-primary";
    }
  } else {
    statusLabel = t("timeline.inProgress");
    statusColor = "text-muted-foreground";
  }

  // "Current week" (if running)
  let currentLabel = "";
  if (!isBeforeStart && !isCompleted) {
    const elapsedWeeks = Math.floor(elapsedDays / 7) + 1;
    currentLabel = t("timeline.weekDay", { week: elapsedWeeks, day: elapsedDays + 1 });
  }

  return (
    <div className="mb-5 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Target className="w-4 h-4 text-primary" />
          <span>{t("timeline.title")}</span>
          {currentLabel && (
            <span className="text-xs font-medium text-muted-foreground">· {currentLabel}</span>
          )}
        </div>
        <div className={`flex items-center gap-1.5 text-sm font-semibold ${statusColor}`}>
          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
          {statusLabel}
        </div>
      </div>

      {/* Progress bar */}
      {end && (
        <div className="relative w-full h-2 rounded-full bg-border overflow-hidden mb-2">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: isCompleted
                ? "linear-gradient(to right, #10b981, #059669)"
                : remainingDays !== null && remainingDays <= 7
                  ? "linear-gradient(to right, #f59e0b, #ef4444)"
                  : "linear-gradient(to right, #7c3aed, #a78bfa)",
            }}
          />
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {fmt(start)}
        </span>
        {totalDays && (
          <span>{t("timeline.dayProgress", { elapsed: elapsedDays, total: totalDays })}</span>
        )}
        {end && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {fmt(end)}
          </span>
        )}
      </div>
    </div>
  );
}
