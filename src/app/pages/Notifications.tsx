import { useState, useEffect } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import {
  Bell, Briefcase, Calendar, MessageSquare, Users,
  CheckCheck, ChevronLeft, ChevronRight, Inbox, Trash2, X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useNavigate } from "react-router";
import { SkeletonPage, SkeletonList } from "../components/Skeleton";

type NotifType =
  | "project_application"
  | "project_application_result"
  | "project_team_join"
  | "club_announcement"
  | "club_application"
  | "club_application_result"
  | "club_request"
  | "club_request_result"
  | "new_event"
  | "event_reminder"
  | "study_file_upload"
  | "system";

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

const iconMap: Record<string, React.ElementType> = {
  project_application: Briefcase,
  project_application_result: Briefcase,
  project_team_join: Briefcase,
  club_announcement: Users,
  club_application: Users,
  club_application_result: Users,
  club_request: Users,
  club_request_result: Users,
  new_event: Calendar,
  event_reminder: Calendar,
  study_file_upload: MessageSquare,
  system: Bell,
};

const colorMap: Record<string, string> = {
  project_application: "bg-blue-50 text-blue-600 ring-blue-100",
  project_application_result: "bg-blue-50 text-blue-600 ring-blue-100",
  project_team_join: "bg-blue-50 text-blue-600 ring-blue-100",
  club_announcement: "bg-green-50 text-green-600 ring-green-100",
  club_application: "bg-green-50 text-green-600 ring-green-100",
  club_application_result: "bg-green-50 text-green-600 ring-green-100",
  club_request: "bg-green-50 text-green-600 ring-green-100",
  club_request_result: "bg-green-50 text-green-600 ring-green-100",
  new_event: "bg-orange-50 text-orange-600 ring-orange-100",
  event_reminder: "bg-orange-50 text-orange-600 ring-orange-100",
  study_file_upload: "bg-purple-50 text-purple-600 ring-purple-100",
  system: "bg-primary/10 text-primary ring-primary/20",
};

const labelMap: Record<string, string> = {
  project_application: "Project",
  project_application_result: "Project",
  project_team_join: "Project",
  club_announcement: "Club",
  club_application: "Club",
  club_application_result: "Club",
  club_request: "Club",
  club_request_result: "Club",
  new_event: "Event",
  event_reminder: "Event",
  study_file_upload: "Study",
  system: "System",
};

const PER_PAGE = 10;

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [currentPage, setCurrentPage] = useState(1);
  // IDs the user has checked for bulk deletion. Stored as a Set so the
  // O(1) lookups in the render path stay cheap on long lists.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    fetchNotifications();
  }, []);

  async function fetchNotifications() {
    try {
      setIsLoading(true);
      const data = await apiFetch("/api/notifications/");
      setNotifications(data);
    } catch {
      console.error("Failed to load notifications");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleNotifClick(notif: Notification) {
    if (!notif.is_read) {
      apiFetch(`/api/notifications/${notif.id}/read`, { method: "PATCH" }).then(() => {
        window.dispatchEvent(new Event("notifications-updated"));
      });
      setNotifications((prev) => prev.map((n) => n.id === notif.id ? { ...n, is_read: true } : n));
    }
    if (notif.link) navigate(notif.link);
  }

  async function markAllRead() {
    await apiFetch("/api/notifications/read-all", { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    window.dispatchEvent(new Event("notifications-updated"));
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function deleteOne(id: string) {
    // Optimistic remove first so the row disappears immediately.
    const prev = notifications;
    setNotifications((p) => p.filter((n) => n.id !== id));
    setSelectedIds((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    try {
      await apiFetch(`/api/notifications/${id}`, { method: "DELETE" });
      window.dispatchEvent(new Event("notifications-updated"));
    } catch {
      // Restore on failure so the user isn't silently stuck with a
      // mismatched view.
      setNotifications(prev);
    }
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const prev = notifications;
    setNotifications((p) => p.filter((n) => !selectedIds.has(n.id)));
    setSelectedIds(new Set());
    try {
      await apiFetch("/api/notifications/delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      window.dispatchEvent(new Event("notifications-updated"));
    } catch {
      setNotifications(prev);
    }
  }

  async function clearAll() {
    if (notifications.length === 0) return;
    if (!window.confirm("Delete all notifications? This cannot be undone.")) return;
    const prev = notifications;
    setNotifications([]);
    setSelectedIds(new Set());
    try {
      await apiFetch("/api/notifications/delete", {
        method: "POST",
        body: JSON.stringify({}),
      });
      window.dispatchEvent(new Event("notifications-updated"));
    } catch {
      setNotifications(prev);
    }
  }

  function handleFilterChange(newFilter: "all" | "unread") {
    setFilter(newFilter);
    setCurrentPage(1);
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const filtered = filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto">
        <SkeletonPage>
          <SkeletonList count={6} />
        </SkeletonPage>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`
              : "You are all caught up."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="w-4 h-4" />
            Mark all as read
          </Button>
          <Button variant="outline" onClick={clearAll} disabled={notifications.length === 0}>
            <Trash2 className="w-4 h-4" />
            Clear all
          </Button>
        </div>
      </div>

      {/* Selection action bar — only when items are checked. Lets the
          user delete a chosen subset rather than wiping everything. */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
          <span className="text-sm">
            <span className="font-semibold">{selectedIds.size}</span> selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={clearSelection}>
              <X className="w-3.5 h-3.5" />
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={deleteSelected}>
              <Trash2 className="w-3.5 h-3.5" />
              Delete selected
            </Button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => handleFilterChange("all")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            filter === "all" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All
          <span className="ml-2 text-xs text-muted-foreground">{notifications.length}</span>
        </button>
        <button
          onClick={() => handleFilterChange("unread")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            filter === "unread" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Unread
          <span className="ml-2 text-xs text-muted-foreground">{unreadCount}</span>
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card className="p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <Inbox className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg mb-1">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </h3>
          <p className="text-muted-foreground text-sm">
            {filter === "unread" ? "You are all caught up!" : "Your notifications will appear here."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden divide-y divide-border">
          {paginated.map((notif) => {
            const Icon = iconMap[notif.type] || Bell;
            const color = colorMap[notif.type] || colorMap.system;
            const label = labelMap[notif.type] || "System";
            const isSelected = selectedIds.has(notif.id);
            return (
              <div
                key={notif.id}
                className={`group/notif relative flex items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/60 ${
                  !notif.is_read ? "bg-accent/40" : ""
                } ${isSelected ? "bg-primary/5" : ""}`}
              >
                {/* Selection checkbox — click is independent of opening
                    the link, so users can build up a multi-item delete. */}
                <label
                  className="flex-shrink-0 flex items-center pt-3 cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(notif.id)}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/30 cursor-pointer"
                    aria-label={`Select notification: ${notif.title}`}
                  />
                </label>

                {/* Clickable area — opens link + marks read. Rendered as
                    a button so keyboard users get the same affordance. */}
                <button
                  type="button"
                  onClick={() => handleNotifClick(notif)}
                  className="flex-1 min-w-0 flex items-start gap-4 text-left"
                >
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ${color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-semibold text-sm truncate">{notif.title}</h3>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
                          {label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(notif.created_at)}</span>
                        {!notif.is_read && <span className="w-2 h-2 bg-primary rounded-full" />}
                      </div>
                    </div>
                    {/* No line-clamp here on purpose: long rejection
                        reasons need to be readable in full. */}
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{notif.body}</p>
                  </div>
                </button>

                {/* Per-item delete — appears on hover, always reachable
                    via keyboard. */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteOne(notif.id); }}
                  aria-label="Delete notification"
                  title="Delete"
                  className="flex-shrink-0 self-start mt-1 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/notif:opacity-100 focus:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </Card>
      )}

      {/* Pagination — always visible when there are notifications */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
          <p className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{(currentPage - 1) * PER_PAGE + 1}</span>
            –<span className="font-semibold text-foreground">{Math.min(currentPage * PER_PAGE, filtered.length)}</span>
            {" "}of <span className="font-semibold text-foreground">{filtered.length}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="w-9 h-9 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                const show = page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1;
                const showEllipsisBefore = page === currentPage - 2 && currentPage > 4;
                const showEllipsisAfter = page === currentPage + 2 && currentPage < totalPages - 3;
                if (showEllipsisBefore || showEllipsisAfter) {
                  return <span key={page} className="px-1 self-center text-sm text-muted-foreground">…</span>;
                }
                if (!show) return null;
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === page
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border border-border hover:bg-muted"
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              aria-label="Next page"
              className="w-9 h-9 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Page <span className="font-semibold text-foreground">{currentPage}</span> of{" "}
            <span className="font-semibold text-foreground">{totalPages}</span>
          </p>
        </div>
      )}
    </div>
  );
}
