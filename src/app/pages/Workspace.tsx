import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft, Loader2, LayoutDashboard, MessageCircle, CheckSquare,
  Users, Link2, Activity, Plus, X, Github, Figma, HardDrive,
  BookOpen, Video, ExternalLink, Trash2, ChevronDown, Circle,
  AlertCircle, Calendar, Crown, Shield, UserCircle, ArrowRight,
  Send,
} from "lucide-react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Avatar } from "../components/Avatar";
import { Tag } from "../components/Tag";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useConfirm } from "../context/ConfirmContext";
import { supabase } from "../lib/supabase";

// ── Types ──────────────────────────────────────────────────────

interface WorkspaceData {
  id: string;
  project_id: string;
  stage: string;
  chat_id: string | null;
  my_role: "owner" | "admin" | "member";
  member_count: number;
  task_counts: Record<string, number>;
  project: {
    id: string;
    title: string;
    description: string;
    tech_stack: string[];
    roles_needed: string[];
    status: string;
    github_url?: string;
    duration?: string;
    owner_id: string;
  };
  created_at: string;
}

interface Task {
  id: string;
  workspace_id: string;
  title: string;
  description?: string;
  assignee_id?: string;
  created_by: string;
  status: "todo" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  due_date?: string;
  position: number;
  assignee?: { id: string; name: string; avatar_url?: string };
  creator?: { id: string; name: string; avatar_url?: string };
}

interface Member {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  user?: { id: string; name: string; avatar_url?: string; department?: string; year?: number };
}

interface Resource {
  id: string;
  title: string;
  url: string;
  type: string;
  added_by: string;
  added_by_user?: { id: string; name: string; avatar_url?: string };
  created_at: string;
}

interface ActivityLog {
  id: string;
  actor_id: string;
  action: string;
  entity_type?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: { id: string; name: string; avatar_url?: string };
}

// ── Constants ─────────────────────────────────────────────────

const STAGES = ["recruiting", "planning", "development", "testing", "launch", "completed"] as const;

const STAGE_COLORS: Record<string, string> = {
  recruiting: "bg-blue-100 text-blue-700",
  planning: "bg-amber-100 text-amber-700",
  development: "bg-purple-100 text-purple-700",
  testing: "bg-orange-100 text-orange-700",
  launch: "bg-green-100 text-green-700",
  completed: "bg-muted text-muted-foreground",
};

const PRIORITY_BG: Record<string, string> = {
  low: "bg-blue-100 text-blue-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

const RESOURCE_ICONS: Record<string, typeof Github> = {
  github: Github,
  figma: Figma,
  drive: HardDrive,
  notion: BookOpen,
  meeting: Video,
  link: Link2,
};

const COLUMNS: { key: Task["status"]; label: string; color: string }[] = [
  { key: "todo", label: "To Do", color: "bg-muted" },
  { key: "in_progress", label: "In Progress", color: "bg-blue-50 dark:bg-blue-950/20" },
  { key: "review", label: "Review", color: "bg-amber-50 dark:bg-amber-950/20" },
  { key: "done", label: "Done", color: "bg-green-50 dark:bg-green-950/20" },
];

const ROLE_ICONS = { owner: Crown, admin: Shield, member: UserCircle };

// ── Utility ────────────────────────────────────────────────────

function DeleteTaskButton({ onDelete }: { onDelete: () => void }) {
  const { confirm } = useConfirm();
  const { t } = useTranslation("workspace");
  return (
    <button
      onClick={async () => {
        const ok = await confirm({
          title: t("tasks.deleteConfirmTitle"),
          description: t("tasks.deleteConfirmDesc"),
          confirmLabel: t("tasks.deleteConfirmLabel"),
          tone: "danger",
        });
        if (ok) onDelete();
      }}
      className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

function timeAgo(dateStr: string, tc: TFunc, locale: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return tc("notifications.justNow");
  if (m < 60) return tc("notifications.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return tc("notifications.hoursAgo", { count: h });
  const d = Math.floor(h / 24);
  if (d < 7) return tc("notifications.daysAgo", { count: d });
  return new Date(dateStr).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function activityLabel(log: ActivityLog, t: TFunc): string {
  const actor = log.actor?.name || t("activity.someone");
  const m = log.metadata as Record<string, string>;
  const stageName = (s?: string) => (s ? t(`stages.${s}`, { defaultValue: s }) : "");
  const colName = (s?: string) => (s ? t(`columns.${s}`, { defaultValue: s }) : "");
  switch (log.action) {
    case "workspace_created": return t("activity.workspace_created", { actor });
    case "member_joined": return t("activity.member_joined", { actor });
    case "member_removed": return t("activity.member_removed", { actor });
    case "task_created": return t("activity.task_created", { actor, title: m.title });
    case "task_moved": return t("activity.task_moved", { actor, title: m.title, from: colName(m.from), to: colName(m.to) });
    case "task_deleted": return t("activity.task_deleted", { actor, title: m.title });
    case "resource_added": return t("activity.resource_added", { actor, title: m.title });
    case "resource_removed": return t("activity.resource_removed", { actor });
    case "stage_updated": return t("activity.stage_updated", { actor, stage: stageName(m.stage) });
    default: return t("activity.default", { actor });
  }
}

// ══════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════

export function Workspace() {
  const { t } = useTranslation("workspace");
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "chat" | "tasks" | "members" | "resources" | "activity">("overview");

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    loadWorkspace();
  }, [projectId]);

  async function loadWorkspace() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/api/workspaces/project/${projectId}`);
      setWorkspace(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  const handleTaskCountChange = useCallback(
    (changes: Array<{ status: Task["status"]; delta: number }>) => {
      setWorkspace((w) => {
        if (!w) return w;
        const tc = { ...w.task_counts };
        for (const { status, delta } of changes) {
          tc[status] = Math.max(0, (tc[status] || 0) + delta);
        }
        return { ...w, task_counts: tc };
      });
    },
    [],
  );

  const handleMemberCountChange = useCallback((delta: number) => {
    setWorkspace((w) => w ? { ...w, member_count: Math.max(0, w.member_count + delta) } : w);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate("/projects")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> {t("backToProjects")}
        </button>
        <Card className="p-12 text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-muted-foreground">{error || t("notFound")}</p>
        </Card>
      </div>
    );
  }

  const tabs = [
    { key: "overview", label: t("tabs.overview"), icon: LayoutDashboard },
    { key: "chat", label: t("tabs.chat"), icon: MessageCircle },
    { key: "tasks", label: t("tabs.tasks"), icon: CheckSquare },
    { key: "members", label: t("tabs.members", { count: workspace.member_count }), icon: Users },
    { key: "resources", label: t("tabs.resources"), icon: Link2 },
    { key: "activity", label: t("tabs.activity"), icon: Activity },
  ] as const;

  return (
    <div className="space-y-6 min-w-0">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.ok ? "✓" : "✗"} {toast.msg}
        </div>
      )}

      {/* Back nav */}
      <button onClick={() => navigate("/projects")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> {t("backToProjects")}
      </button>

      {/* Workspace Header */}
      <WorkspaceHeader
        workspace={workspace}
        onStageChange={async (stage) => {
          try {
            await apiFetch(`/api/workspaces/${workspace.id}/stage`, {
              method: "PATCH",
              body: JSON.stringify({ stage }),
            });
            setWorkspace((w) => w ? { ...w, stage } : w);
            showToast(t("stageUpdated", { stage: t(`stages.${stage}`, { defaultValue: stage }) }));
          } catch (e: unknown) {
            showToast(e instanceof Error ? e.message : t("stageUpdateFailed"), false);
          }
        }}
      />

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      {activeTab === "overview" && <OverviewTab workspace={workspace} />}
      {activeTab === "chat" && (
        <ChatBridgeTab
          chatId={workspace.chat_id}
          projectTitle={workspace.project.title}
          memberCount={workspace.member_count}
        />
      )}
      {activeTab === "tasks" && (
        <TasksTab
          workspaceId={workspace.id}
          myRole={workspace.my_role}
          currentUserId={user?.user_id || ""}
          showToast={showToast}
          onTaskCountChange={handleTaskCountChange}
        />
      )}
      {activeTab === "members" && (
        <MembersTab
          workspaceId={workspace.id}
          myRole={workspace.my_role}
          currentUserId={user?.user_id || ""}
          showToast={showToast}
          onMemberCountChange={handleMemberCountChange}
        />
      )}
      {activeTab === "resources" && (
        <ResourcesTab
          workspaceId={workspace.id}
          myRole={workspace.my_role}
          currentUserId={user?.user_id || ""}
          showToast={showToast}
        />
      )}
      {activeTab === "activity" && <ActivityTab workspaceId={workspace.id} />}
    </div>
  );
}

// ── Workspace Header ───────────────────────────────────────────

function WorkspaceHeader({
  workspace,
  onStageChange,
}: {
  workspace: WorkspaceData;
  onStageChange: (stage: string) => void;
}) {
  const { t } = useTranslation("workspace");
  const [stageOpen, setStageOpen] = useState(false);
  const canEditStage = workspace.my_role === "owner" || workspace.my_role === "admin";

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{workspace.project.title}</h1>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
              workspace.project.status === "open"
                ? "bg-green-100 text-green-700"
                : workspace.project.status === "completed"
                ? "bg-blue-100 text-blue-700"
                : "bg-muted text-muted-foreground"
            }`}>
              {t(`status.${workspace.project.status}`, { defaultValue: workspace.project.status })}
            </span>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{workspace.project.description}</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {(workspace.project.tech_stack || []).slice(0, 5).map((t) => (
              <Tag key={t} variant="primary" className="text-xs">{t}</Tag>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4" /> {t("memberCount", { count: workspace.member_count })}
            </span>
            {workspace.project.github_url && (
              <a href={workspace.project.github_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Github className="w-4 h-4" /> GitHub
              </a>
            )}
            {workspace.project.duration && (
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" /> {workspace.project.duration}
              </span>
            )}
          </div>
        </div>

        {/* Stage selector */}
        <div className="relative flex-shrink-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{t("stageLabel")}</p>
          <button
            onClick={() => canEditStage && setStageOpen(!stageOpen)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              STAGE_COLORS[workspace.stage]
            } ${canEditStage ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
          >
            <span>{t(`stages.${workspace.stage}`, { defaultValue: workspace.stage })}</span>
            {canEditStage && <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {stageOpen && canEditStage && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl z-20 py-1 min-w-36">
              {STAGES.map((s) => (
                <button
                  key={s}
                  onClick={() => { onStageChange(s); setStageOpen(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors ${
                    workspace.stage === s ? "font-semibold text-primary" : ""
                  }`}
                >
                  {t(`stages.${s}`, { defaultValue: s })}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stage progress bar */}
      <div className="mt-4">
        <div className="flex gap-1">
          {STAGES.map((s, i) => {
            const currentIdx = STAGES.indexOf(workspace.stage as typeof STAGES[number]);
            const filled = i <= currentIdx;
            return (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${filled ? "bg-primary" : "bg-muted"}`}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-1">
          {STAGES.map((s) => (
            <span key={s} className="text-[10px] text-muted-foreground hidden sm:block">{t(`stages.${s}`, { defaultValue: s })}</span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Overview Tab ───────────────────────────────────────────────

function OverviewTab({ workspace }: { workspace: WorkspaceData }) {
  const { t } = useTranslation("workspace");
  const tc = workspace.task_counts;
  const total = Object.values(tc).reduce((a, b) => a + b, 0);
  const done = tc.done || 0;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column */}
      <div className="lg:col-span-2 space-y-6">
        {/* Task overview */}
        <Card className="p-5">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-primary" /> {t("overview.taskProgress")}
          </h3>
          {/* Stats grid — 2 columns on phones (so 4 boxes fit snugly in
              a 2×2), 4 columns from sm: up. Previous flex-wrap could
              overflow on 360px because `min-w-20` * 4 + gaps exceeded
              the card's inner width. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
            {[
              { key: "todo", color: "bg-muted text-muted-foreground" },
              { key: "in_progress", color: "bg-blue-100 text-blue-700" },
              { key: "review", color: "bg-amber-100 text-amber-700" },
              { key: "done", color: "bg-green-100 text-green-700" },
            ].map(({ key, color }) => (
              <div key={key} className={`rounded-xl p-3 text-center ${color}`}>
                <p className="text-2xl font-bold">{tc[key] || 0}</p>
                <p className="text-xs font-medium mt-0.5">{t(`columns.${key}`)}</p>
              </div>
            ))}
          </div>
          {total > 0 && (
            <>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{t("overview.tasksDone", { done, total })}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </>
          )}
          {total === 0 && (
            <p className="text-sm text-muted-foreground italic">{t("overview.noTasks")}</p>
          )}
        </Card>

        {/* Project details */}
        <Card className="p-5">
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4 text-primary" /> {t("overview.projectInfo")}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">{workspace.project.description}</p>
          {(workspace.project.roles_needed || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("overview.roles")}</p>
              <div className="flex flex-wrap gap-2">
                {workspace.project.roles_needed.map((r) => (
                  <Tag key={r} variant="muted" className="text-xs">{r}</Tag>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Right column */}
      <div className="space-y-6">
        <Card className="p-5">
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> {t("overview.team")}
          </h3>
          <p className="text-3xl font-bold text-primary">{workspace.member_count}</p>
          <p className="text-sm text-muted-foreground">{t("overview.activeMembers")}</p>
        </Card>

        <Card className="p-5">
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <Circle className="w-4 h-4 text-primary" /> {t("overview.currentStage")}
          </h3>
          <span className={`inline-block px-3 py-1.5 rounded-lg text-sm font-semibold ${STAGE_COLORS[workspace.stage]}`}>
            {t(`stages.${workspace.stage}`, { defaultValue: workspace.stage })}
          </span>
          <p className="text-xs text-muted-foreground mt-2">
            {t("overview.stepOf", { step: STAGES.indexOf(workspace.stage as typeof STAGES[number]) + 1, total: STAGES.length })}
          </p>
        </Card>
      </div>
    </div>
  );
}

// ── Chat Bridge Tab ─────────────────────────────────────────────

function ChatBridgeTab({
  chatId,
  projectTitle,
  memberCount,
}: {
  chatId: string | null;
  projectTitle: string;
  memberCount: number;
}) {
  const { t, i18n } = useTranslation("workspace");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const [lastMessage, setLastMessage] = useState<{
    body?: string;
    created_at: string;
    sender?: { name: string };
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!chatId) { setIsLoading(false); return; }
    apiFetch(`/api/chats/${chatId}/messages?limit=1`)
      .then((data) => {
        const msgs = data || [];
        setLastMessage(msgs[0] || null);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [chatId]);

  if (!chatId) {
    return (
      <Card className="p-12 text-center">
        <MessageCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
        <p className="text-muted-foreground">{t("chat.noChat")}</p>
      </Card>
    );
  }

  return (
    <Card className="p-6 max-w-xl mx-auto">
      <div className="flex items-center gap-4 mb-5">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="font-bold text-lg">{projectTitle}</h3>
          <p className="text-sm text-muted-foreground">{t("chat.subtitle", { count: memberCount })}</p>
        </div>
      </div>

      {/* Latest message preview */}
      <div className="bg-muted/50 rounded-xl p-4 mb-5 min-h-16 flex items-center">
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" />
        ) : lastMessage ? (
          <div className="w-full">
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              {lastMessage.sender?.name || t("chat.teamMember")} · {timeAgo(lastMessage.created_at, tc, i18n.language)}
            </p>
            <p className="text-sm line-clamp-2">{lastMessage.body || t("chat.attachment")}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic w-full text-center">{t("chat.noMessages")}</p>
        )}
      </div>

      <Button className="w-full" onClick={() => navigate(`/chats?chatId=${chatId}`)}>
        {t("chat.open")} <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
      <p className="text-xs text-muted-foreground text-center mt-3">
        {t("chat.footer")}
      </p>
    </Card>
  );
}

// ── Tasks Tab ──────────────────────────────────────────────────

// "YYYY-MM-DD" in the user's local timezone — used as the `min`
// attribute on task due-date inputs so the native picker won't let
// you pick a past day. Backend re-validates the same rule.
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DEFAULT_FORM = {
  title: "",
  description: "",
  assignee_id: "",
  priority: "medium" as Task["priority"],
  due_date: "",
};

function TasksTab({
  workspaceId,
  myRole,
  currentUserId,
  showToast,
  onTaskCountChange,
}: {
  workspaceId: string;
  myRole: "owner" | "admin" | "member";
  currentUserId: string;
  showToast: (msg: string, ok?: boolean) => void;
  onTaskCountChange: (changes: Array<{ status: Task["status"]; delta: number }>) => void;
}) {
  const { t, i18n } = useTranslation("workspace");
  const { t: tc } = useTranslation("common");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState<Task["status"] | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<Task["status"] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ ...DEFAULT_FORM });

  const membersRef = useRef<Member[]>([]);
  useEffect(() => { membersRef.current = members; }, [members]);

  useEffect(() => {
    loadInitial();

    const channel = supabase
      .channel(`workspace-tasks-${workspaceId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "workspace_tasks",
        filter: `workspace_id=eq.${workspaceId}`,
      }, (payload) => {
        const t = payload.new as Task;
        const m = membersRef.current.find((x) => x.user_id === t.assignee_id);
        const enriched: Task = {
          ...t,
          assignee: m?.user ? { id: m.user_id, name: m.user.name, avatar_url: m.user.avatar_url } : undefined,
        };
        setTasks((prev) => {
          if (prev.some((x) => x.id === t.id)) return prev;
          return [...prev, enriched];
        });
        onTaskCountChange([{ status: t.status, delta: 1 }]);
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "workspace_tasks",
        filter: `workspace_id=eq.${workspaceId}`,
      }, (payload) => {
        const t = payload.new as Task;
        const old = payload.old as Partial<Task>;
        setTasks((prev) => prev.map((x) => x.id === t.id ? { ...x, ...t } : x));
        if (old.status && t.status && old.status !== t.status) {
          onTaskCountChange([
            { status: old.status, delta: -1 },
            { status: t.status, delta: 1 },
          ]);
        }
      })
      .on("postgres_changes", {
        event: "DELETE", schema: "public", table: "workspace_tasks",
        filter: `workspace_id=eq.${workspaceId}`,
      }, (payload) => {
        const old = payload.old as Partial<Task>;
        if (!old.id) return;
        setTasks((prev) => prev.filter((x) => x.id !== old.id));
        if (old.status) onTaskCountChange([{ status: old.status, delta: -1 }]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workspaceId]);

  async function loadInitial() {
    setIsLoading(true);
    try {
      const [tasksData, membersData] = await Promise.all([
        apiFetch(`/api/workspaces/${workspaceId}/tasks`),
        apiFetch(`/api/workspaces/${workspaceId}/members`),
      ]);
      setTasks(tasksData || []);
      setMembers(membersData || []);
    } catch {
      showToast(t("tasks.loadFailed"), false);
    } finally {
      setIsLoading(false);
    }
  }

  function openCreate(status: Task["status"]) {
    setForm({ ...DEFAULT_FORM });
    setShowCreate(status);
  }

  async function createTask(status: Task["status"]) {
    if (!form.title.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const created = await apiFetch(`/api/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          assignee_id: form.assignee_id || null,
          status,
          priority: form.priority,
          due_date: form.due_date || null,
        }),
      });
      const m = members.find((x) => x.user_id === created.assignee_id);
      const enriched: Task = {
        ...created,
        assignee: m?.user ? { id: m.user_id, name: m.user.name, avatar_url: m.user.avatar_url } : undefined,
      };
      setTasks((prev) => prev.some((x) => x.id === enriched.id) ? prev : [...prev, enriched]);
      onTaskCountChange([{ status, delta: 1 }]);
      setShowCreate(null);
      setForm({ ...DEFAULT_FORM });
      showToast(t("tasks.created"));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t("tasks.createFailed"), false);
    } finally {
      setIsCreating(false);
    }
  }

  async function moveTask(taskId: string, newStatus: Task["status"]) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;
    const oldStatus = task.status;

    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus } : t));
    onTaskCountChange([{ status: oldStatus, delta: -1 }, { status: newStatus, delta: 1 }]);

    try {
      await apiFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e: unknown) {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: oldStatus } : t));
      onTaskCountChange([{ status: newStatus, delta: -1 }, { status: oldStatus, delta: 1 }]);
      showToast(e instanceof Error ? e.message : t("tasks.moveFailed"), false);
    }
  }

  async function deleteTask(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (task) onTaskCountChange([{ status: task.status, delta: -1 }]);
      setSelectedTask(null);
      showToast(t("tasks.deleted"));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t("tasks.deleteFailed"), false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          const isDragTarget = dragOver === col.key;
          return (
            <div
              key={col.key}
              className={`rounded-2xl p-3 min-h-64 border transition-all ${
                isDragTarget
                  ? `${col.color} border-primary ring-2 ring-primary/30`
                  : `${col.color} border-border/50`
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) moveTask(dragging, col.key);
                setDragging(null);
                setDragOver(null);
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">{t(`columns.${col.key}`)}</h3>
                <span className="text-xs bg-card border border-border rounded-full px-2 py-0.5 font-medium">
                  {colTasks.length}
                </span>
              </div>

              <div className="space-y-2">
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => { setDragging(null); setDragOver(null); }}
                    onClick={() => setSelectedTask(task)}
                    className={`bg-card border border-border rounded-xl p-3 cursor-pointer hover:shadow-md transition-all ${
                      dragging === task.id ? "opacity-50 scale-95" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-medium text-sm leading-snug">{task.title}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${PRIORITY_BG[task.priority]}`}>
                        {t(`priority.${task.priority}`, { defaultValue: task.priority })}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{task.description}</p>
                    )}
                    <div className="flex items-center justify-between">
                      {task.due_date && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(task.due_date).toLocaleDateString(i18n.language, { month: "short", day: "numeric" })}
                        </span>
                      )}
                      {task.assignee && (
                        <Avatar name={task.assignee.name} size="sm" src={task.assignee.avatar_url} />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {showCreate === col.key ? (
                <div className="mt-2 bg-card border border-border rounded-xl p-3 space-y-2">
                  <input
                    autoFocus
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createTask(col.key);
                      if (e.key === "Escape") setShowCreate(null);
                    }}
                    placeholder={t("tasks.titlePlaceholder")}
                    className="w-full text-sm bg-muted px-2 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value as Task["priority"] })}
                    className="w-full text-xs bg-muted px-2 py-1.5 rounded-lg border border-border focus:outline-none"
                  >
                    <option value="low">{t("priorityOption.low")}</option>
                    <option value="medium">{t("priorityOption.medium")}</option>
                    <option value="high">{t("priorityOption.high")}</option>
                    <option value="urgent">{t("priorityOption.urgent")}</option>
                  </select>
                  <select
                    value={form.assignee_id}
                    onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
                    className="w-full text-xs bg-muted px-2 py-1.5 rounded-lg border border-border focus:outline-none"
                  >
                    <option value="">{t("tasks.noAssignee")}</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>{m.user?.name}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={form.due_date}
                    min={todayISO()}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                    className="w-full text-xs bg-muted px-2 py-1.5 rounded-lg border border-border focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => createTask(col.key)}
                      disabled={!form.title.trim() || isCreating}
                    >
                      {isCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : t("tasks.add")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowCreate(null)}>
                      {tc("actions.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => openCreate(col.key)}
                  className="mt-2 w-full flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-card/60 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> {t("tasks.addTask")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          workspaceId={workspaceId}
          members={members}
          currentUserId={currentUserId}
          myRole={myRole}
          onClose={() => setSelectedTask(null)}
          onDelete={() => deleteTask(selectedTask.id)}
          onUpdate={async (updates) => {
            try {
              const updated = await apiFetch(`/api/workspaces/${workspaceId}/tasks/${selectedTask.id}`, {
                method: "PATCH",
                body: JSON.stringify(updates),
              });
              const oldStatus = selectedTask.status;
              setTasks((prev) => prev.map((t) => t.id === selectedTask.id ? { ...t, ...updated } : t));
              setSelectedTask((t) => t ? { ...t, ...updated } : t);
              if (updates.status && updates.status !== oldStatus) {
                onTaskCountChange([
                  { status: oldStatus, delta: -1 },
                  { status: updates.status as Task["status"], delta: 1 },
                ]);
              }
              showToast(t("tasks.updated"));
            } catch (e: unknown) {
              showToast(e instanceof Error ? e.message : t("tasks.updateFailed"), false);
            }
          }}
          showToast={showToast}
        />
      )}
    </>
  );
}

// ── Task Detail Modal ──────────────────────────────────────────

function TaskDetailModal({
  task,
  workspaceId,
  members,
  currentUserId,
  myRole,
  onClose,
  onDelete,
  onUpdate,
  showToast,
}: {
  task: Task;
  workspaceId: string;
  members: Member[];
  currentUserId: string;
  myRole: "owner" | "admin" | "member";
  onClose: () => void;
  onDelete: () => void;
  onUpdate: (updates: Record<string, unknown>) => Promise<void>;
  showToast: (msg: string, ok?: boolean) => void;
}) {
  const { t, i18n } = useTranslation("workspace");
  const { t: tc } = useTranslation("common");
  const [comments, setComments] = useState<Array<{
    id: string; body: string; created_at: string;
    user?: { id: string; name: string; avatar_url?: string };
  }>>([]);
  const [commentInput, setCommentInput] = useState("");
  const [isLoadingComments, setIsLoadingComments] = useState(true);
  const [isSendingComment, setIsSendingComment] = useState(false);

  // Controlled fields — synced when task changes
  const [assigneeId, setAssigneeId] = useState(task.assignee_id || "");
  const [dueDate, setDueDate] = useState(task.due_date || "");

  useEffect(() => {
    setAssigneeId(task.assignee_id || "");
    setDueDate(task.due_date || "");
  }, [task.id]);

  const canDelete = task.created_by === currentUserId || myRole === "owner" || myRole === "admin";

  useEffect(() => {
    apiFetch(`/api/workspaces/${workspaceId}/tasks/${task.id}/comments`)
      .then(setComments)
      .catch(() => showToast(t("tasks.loadCommentsFailed"), false))
      .finally(() => setIsLoadingComments(false));
  }, [task.id]);

  async function addComment() {
    if (!commentInput.trim()) return;
    setIsSendingComment(true);
    try {
      const c = await apiFetch(`/api/workspaces/${workspaceId}/tasks/${task.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentInput }),
      });
      setComments((prev) => [...prev, c]);
      setCommentInput("");
    } catch {
      showToast(t("tasks.addCommentFailed"), false);
    } finally {
      setIsSendingComment(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-xl max-h-[85vh] overflow-y-auto shadow-2xl">
        <div className="p-5 border-b border-border flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-bold text-lg mb-1">{task.title}</h3>
            <div className="flex gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_BG[task.priority]}`}>
                {t(`priority.${task.priority}`, { defaultValue: task.priority })}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
                {t(`columns.${task.status}`, { defaultValue: task.status })}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {canDelete && (
              <DeleteTaskButton onDelete={onDelete} />
            )}
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {task.description && (
            <p className="text-sm text-muted-foreground">{task.description}</p>
          )}

          {/* Move status */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{t("tasks.moveTo")}</p>
            <div className="flex gap-2 flex-wrap">
              {COLUMNS.filter((c) => c.key !== task.status).map((c) => (
                <button
                  key={c.key}
                  onClick={() => onUpdate({ status: c.key })}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  {t(`columns.${c.key}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Assignee */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{t("tasks.assignee")}</p>
            <select
              value={assigneeId}
              onChange={(e) => {
                const val = e.target.value;
                setAssigneeId(val);
                onUpdate({ assignee_id: val || null });
              }}
              className="text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none w-full"
            >
              <option value="">{t("tasks.unassigned")}</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.user?.name}</option>
              ))}
            </select>
          </div>

          {/* Due date */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{t("tasks.dueDate")}</p>
            <input
              type="date"
              value={dueDate}
              min={todayISO()}
              onChange={(e) => {
                const val = e.target.value;
                setDueDate(val);
                onUpdate({ due_date: val || null });
              }}
              className="text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none"
            />
          </div>

          {/* Comments */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("tasks.comments")}</p>
            {isLoadingComments ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : comments.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">{t("tasks.noComments")}</p>
            ) : (
              <div className="space-y-3 mb-3">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar name={c.user?.name || "?"} size="sm" src={c.user?.avatar_url} />
                    <div>
                      <p className="text-xs font-medium">
                        {c.user?.name} <span className="text-muted-foreground font-normal">{timeAgo(c.created_at, tc, i18n.language)}</span>
                      </p>
                      <p className="text-sm mt-0.5">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addComment(); }}
                placeholder={t("tasks.commentPlaceholder")}
                className="flex-1 text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button size="sm" onClick={addComment} disabled={!commentInput.trim() || isSendingComment}>
                {isSendingComment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Members Tab ────────────────────────────────────────────────

function MembersTab({
  workspaceId,
  myRole,
  currentUserId,
  showToast,
  onMemberCountChange,
}: {
  workspaceId: string;
  myRole: "owner" | "admin" | "member";
  currentUserId: string;
  showToast: (msg: string, ok?: boolean) => void;
  onMemberCountChange: (delta: number) => void;
}) {
  const { t, i18n } = useTranslation("workspace");
  const { t: tc } = useTranslation("common");
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/workspaces/${workspaceId}/members`)
      .then(setMembers)
      .catch(() => showToast(t("members.loadFailed"), false))
      .finally(() => setIsLoading(false));
  }, [workspaceId]);

  const { confirm: confirmDialog } = useConfirm();
  async function removeMember(userId: string, name: string) {
    const ok = await confirmDialog({
      title: t("members.removeConfirmTitle", { name }),
      description: t("members.removeConfirmDesc", { name }),
      confirmLabel: t("members.removeConfirmLabel"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      onMemberCountChange(-1);
      showToast(t("members.removed", { name }));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t("members.removeFailed"), false);
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {members.map((m) => {
        const RoleIcon = ROLE_ICONS[m.role];
        const canRemove = (myRole === "owner" || myRole === "admin") && m.role !== "owner";
        return (
          <Card key={m.user_id} className="p-4 flex items-center gap-3">
            <Avatar name={m.user?.name || "?"} src={m.user?.avatar_url} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-sm truncate">{m.user?.name}</p>
                <RoleIcon className={`w-3.5 h-3.5 flex-shrink-0 ${
                  m.role === "owner" ? "text-amber-500" : m.role === "admin" ? "text-blue-500" : "text-muted-foreground"
                }`} />
              </div>
              {m.user?.department && (
                <p className="text-xs text-muted-foreground truncate">{m.user.department}</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-0.5">{t("members.joinedLine", { role: t(`roles.${m.role}`, { defaultValue: m.role }), time: timeAgo(m.joined_at, tc, i18n.language) })}</p>
            </div>
            {canRemove && (
              <button
                onClick={() => removeMember(m.user_id, m.user?.name || t("roles.member"))}
                className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Resources Tab ──────────────────────────────────────────────

function ResourcesTab({
  workspaceId,
  myRole,
  currentUserId,
  showToast,
}: {
  workspaceId: string;
  myRole: "owner" | "admin" | "member";
  currentUserId: string;
  showToast: (msg: string, ok?: boolean) => void;
}) {
  const { t } = useTranslation("workspace");
  const { t: tc } = useTranslation("common");
  const [resources, setResources] = useState<Resource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", type: "link" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    apiFetch(`/api/workspaces/${workspaceId}/resources`)
      .then(setResources)
      .catch(() => showToast(t("resources.loadFailed"), false))
      .finally(() => setIsLoading(false));
  }, [workspaceId]);

  async function addResource() {
    if (!form.title.trim() || !form.url.trim()) return;
    setIsSubmitting(true);
    try {
      const r = await apiFetch(`/api/workspaces/${workspaceId}/resources`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setResources((prev) => [r, ...prev]);
      setShowAdd(false);
      setForm({ title: "", url: "", type: "link" });
      showToast(t("resources.added"));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t("resources.addFailed"), false);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteResource(id: string) {
    try {
      await apiFetch(`/api/workspaces/${workspaceId}/resources/${id}`, { method: "DELETE" });
      setResources((prev) => prev.filter((r) => r.id !== id));
      showToast(t("resources.removed"));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : t("resources.removeFailed"), false);
    }
  }

  const RESOURCE_TYPES = [
    { value: "github", label: t("resources.types.github") },
    { value: "figma", label: t("resources.types.figma") },
    { value: "drive", label: t("resources.types.drive") },
    { value: "notion", label: t("resources.types.notion") },
    { value: "meeting", label: t("resources.types.meeting") },
    { value: "link", label: t("resources.types.link") },
  ];

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> {t("resources.addResource")}
        </Button>
      </div>

      {showAdd && (
        <Card className="p-5 space-y-3">
          <h3 className="font-semibold">{t("resources.addShared")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">{t("resources.title")}</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={t("resources.titlePlaceholder")}
                className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">{t("resources.type")}</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none"
              >
                {RESOURCE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t("resources.url")}</label>
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://..."
              className="w-full text-sm bg-muted px-3 py-2 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex gap-3">
            <Button onClick={addResource} disabled={isSubmitting || !form.title.trim() || !form.url.trim()}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("resources.addResource")}
            </Button>
            <Button variant="outline" onClick={() => setShowAdd(false)}>{tc("actions.cancel")}</Button>
          </div>
        </Card>
      )}

      {resources.length === 0 ? (
        <Card className="p-12 text-center">
          <Link2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-muted-foreground text-sm">{t("resources.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("resources.emptyHint")}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {resources.map((r) => {
            const Icon = RESOURCE_ICONS[r.type] || Link2;
            const canDelete = r.added_by === currentUserId || myRole === "owner" || myRole === "admin";
            return (
              <Card key={r.id} className="p-4 flex items-center gap-3 group">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{t(`resources.types.${r.type}`, { defaultValue: r.type })}</p>
                  {r.added_by_user && (
                    <p className="text-[10px] text-muted-foreground">{t("resources.by", { name: r.added_by_user.name })}</p>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  {canDelete && (
                    <button
                      onClick={() => deleteResource(r.id)}
                      className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Activity Tab ───────────────────────────────────────────────

function ActivityTab({ workspaceId }: { workspaceId: string }) {
  const { t, i18n } = useTranslation("workspace");
  const { t: tc } = useTranslation("common");
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/workspaces/${workspaceId}/activity`)
      .then(setLogs)
      .catch(() => {})
      .finally(() => setIsLoading(false));

    const channel = supabase
      .channel(`workspace-activity-${workspaceId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "workspace_activity_logs",
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => {
        apiFetch(`/api/workspaces/${workspaceId}/activity`).then(setLogs).catch(() => {});
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workspaceId]);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  if (logs.length === 0) {
    return (
      <Card className="p-12 text-center">
        <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
        <p className="text-muted-foreground text-sm">{t("activityTab.empty")}</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
        <div className="space-y-5">
          {logs.map((log) => (
            <div key={log.id} className="flex gap-4 relative">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 z-10">
                {log.actor ? (
                  <Avatar name={log.actor.name} size="sm" src={log.actor.avatar_url} />
                ) : (
                  <Activity className="w-4 h-4 text-primary" />
                )}
              </div>
              <div className="flex-1 pt-1">
                <p className="text-sm">{activityLabel(log, t)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(log.created_at, tc, i18n.language)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
