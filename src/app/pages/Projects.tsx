import { useState, useEffect } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Tag } from "../components/Tag";
import { Avatar } from "../components/Avatar";
import {
  Search, Plus, X, Loader2, Github, Users,
  Clock, Briefcase, ChevronRight, Check,
  Sparkles, Edit, Trash2, AlertCircle, LayoutDashboard
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { useLocation, useNavigate } from "react-router";
import { Pagination } from "../components/Pagination";
import { ProjectTimeline } from "../components/ProjectTimeline";
import { getStoredToken } from "../context/AuthContext";

interface Owner {
  name: string;
  avatar_url?: string;
  department?: string;
  year?: number;
  skills?: string[];
  github_url?: string;
}

interface Project {
  id: string;
  title: string;
  description: string;
  owner_id: string;
  tech_stack: string[];
  roles_needed: string[];
  status: string;
  github_url?: string;
  duration?: string;
  start_date?: string;   // ISO date
  deadline?: string;     // ISO date
  created_at: string;
  owner?: Owner;
  application_count?: number;
  my_role?: "owner" | "member";
}

interface Application {
  id: string;
  project_id: string;
  applicant_id: string;
  role: string;
  motivation: string;
  status: string;
  rejection_reason?: string;
  applied_at: string;
  cv_url?: string | null;
  cv_name?: string | null;
  links?: { label: string; url: string }[];
  applicant?: Owner;
  project?: { title: string; status: string; owner_id: string };
}

interface PublishLimitInfo {
  limit: number | null;
  used: number;
  remaining: number | null;
  resets_at: string | null;
  is_admin: boolean;
}

// ISO date helpers — work in calendar days, not millisecond-clock time.
// `new Date("YYYY-MM-DD")` parses as UTC midnight, so we compare via the ISO string itself
// to avoid timezone drift around the "is today" boundary.
function todayISO(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    .toISOString()
    .slice(0, 10);
}

function daysBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO);
  const end = new Date(endISO);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/**
 * Validate project start/deadline per product rules:
 *   - start cannot be before today
 *   - deadline cannot be before today
 *   - if both set, start must be strictly before deadline
 * Returns a translated error message, or null if valid.
 */
function validateProjectDates(startISO: string, deadlineISO: string): string | null {
  const today = todayISO();
  if (startISO && startISO < today) return "Start date can't be in the past.";
  if (deadlineISO && deadlineISO < today) return "Deadline can't be in the past.";
  if (startISO && deadlineISO) {
    if (startISO === deadlineISO) return "Start date and deadline can't be the same day.";
    if (startISO > deadlineISO) return "Start date must be before the deadline.";
  }
  return null;
}

function computeDurationLabel(startISO: string, deadlineISO: string): string {
  if (!startISO || !deadlineISO) return "";
  const days = daysBetween(startISO, deadlineISO);
  if (days <= 0) return "";
  return `${days} day${days === 1 ? "" : "s"}`;
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-100 text-green-700",
  closed: "bg-muted text-muted-foreground",
  completed: "bg-blue-100 text-blue-700",
};

const APP_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export function Projects() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"browse" | "my-posts" | "my-projects" | "my-applications">("browse");
  const [projects, setProjects] = useState<Project[]>([]);
  const [myPosts, setMyPosts] = useState<Project[]>([]);
  const [myProjects, setMyProjects] = useState<Project[]>([]);
  const [myApplications, setMyApplications] = useState<Application[]>([]);

  // Pagination state per tab
  const [browsePage, setBrowsePage] = useState(1);
  const [myProjectsPage, setMyProjectsPage] = useState(1);
  const BROWSE_PAGE_SIZE = 8;
  const MY_PROJECTS_PAGE_SIZE = 6;
  const [suggested, setSuggested] = useState<Project[]>([]);
  const [limitInfo, setLimitInfo] = useState<PublishLimitInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed" | "completed">("open");

  // Selected project detail
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectApplications, setProjectApplications] = useState<Application[]>([]);
  const [isLoadingApplications, setIsLoadingApplications] = useState(false);
  const [myApplicationForProject, setMyApplicationForProject] = useState<Application | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Project | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingAppId, setUpdatingAppId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ appId: string; projectId: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  const [createForm, setCreateForm] = useState({
    title: "", description: "", tech_stack: "",
    roles_needed: "", github_url: "", duration: "",
    start_date: "", deadline: "",
  });
  const [applyForm, setApplyForm] = useState<{
    role: string; motivation: string;
    cv_url: string | null; cv_name: string | null;
    links: { label: string; url: string }[];
  }>({ role: "", motivation: "", cv_url: null, cv_name: null, links: [] });
  const [isUploadingCv, setIsUploadingCv] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  // React to URL changes (from notification clicks)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    const projectId = params.get("project");

    if (tab === "my-applications") {
      setActiveTab("my-applications");
    } else if (tab === "my-posts") {
      setActiveTab("my-posts");
    } else if (tab === "browse") {
      setActiveTab("browse");
    }

    // If a specific project is requested, open its detail
    if (projectId && projects.length > 0) {
      const proj = projects.find((p) => p.id === projectId);
      if (proj) {
        setActiveTab("browse");
        openProjectDetail(proj);
      }
    }
  }, [location.search, projects]);

  async function fetchAll() {
    setIsLoading(true);
    try {
      const [all, mine, mineProj, apps, sugg, limit] = await Promise.all([
        apiFetch("/api/projects/"),
        apiFetch("/api/projects/mine/posts"),
        apiFetch("/api/projects/mine/projects"),
        apiFetch("/api/projects/mine/applications"),
        apiFetch("/api/projects/suggested").catch(() => []),
        apiFetch("/api/projects/limit-info").catch(() => null),
      ]);
      setProjects(all);
      setMyPosts(mine);
      setMyProjects(mineProj);
      setMyApplications(apps);
      setSuggested(sugg);
      setLimitInfo(limit);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to load projects", false);
    } finally {
      setIsLoading(false);
    }
  }

  async function openProjectDetail(project: Project) {
    setSelectedProject(project);
    // Check if I already applied
    const myApp = myApplications.find((a) => a.project_id === project.id) || null;
    setMyApplicationForProject(myApp);

    // If I'm the owner, load applications
    if (project.owner_id === user?.user_id || user?.role === "admin") {
      try {
        setIsLoadingApplications(true);
        const apps = await apiFetch(`/api/projects/${project.id}/applications`);
        setProjectApplications(apps);
      } catch { setProjectApplications([]); }
      finally { setIsLoadingApplications(false); }
    } else {
      setProjectApplications([]);
    }
  }

  async function handleCreate() {
    const dateError = validateProjectDates(createForm.start_date, createForm.deadline);
    if (dateError) { showToast(dateError, false); return; }
    // Local guard so we don't hit the backend with a request we already know will fail.
    if (limitInfo && !limitInfo.is_admin && (limitInfo.remaining ?? 0) <= 0) {
      showToast("Monthly publish limit reached. Try again next month.", false);
      return;
    }
    try {
      setIsSubmitting(true);
      const computedDuration = computeDurationLabel(createForm.start_date, createForm.deadline);
      await apiFetch("/api/projects/", {
        method: "POST",
        body: JSON.stringify({
          title: createForm.title,
          description: createForm.description,
          tech_stack: createForm.tech_stack.split(",").map((s) => s.trim()).filter(Boolean),
          roles_needed: createForm.roles_needed.split(",").map((s) => s.trim()).filter(Boolean),
          github_url: createForm.github_url || null,
          duration: computedDuration || createForm.duration || null,
          start_date: createForm.start_date || null,
          deadline: createForm.deadline || null,
        }),
      });
      setShowCreateModal(false);
      setCreateForm({ title: "", description: "", tech_stack: "", roles_needed: "", github_url: "", duration: "", start_date: "", deadline: "" });
      fetchAll();
      showToast("Project created!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to create project", false);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEdit() {
    if (!editingProject) return;
    const dateError = validateProjectDates(createForm.start_date, createForm.deadline);
    if (dateError) { showToast(dateError, false); return; }
    try {
      setIsSubmitting(true);
      const computedDuration = computeDurationLabel(createForm.start_date, createForm.deadline);
      await apiFetch(`/api/projects/${editingProject.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: createForm.title,
          description: createForm.description,
          tech_stack: createForm.tech_stack.split(",").map((s) => s.trim()).filter(Boolean),
          roles_needed: createForm.roles_needed.split(",").map((s) => s.trim()).filter(Boolean),
          github_url: createForm.github_url || null,
          duration: computedDuration || createForm.duration || null,
          start_date: createForm.start_date || null,
          deadline: createForm.deadline || null,
        }),
      });
      setEditingProject(null);
      fetchAll();
      showToast("Project updated!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update", false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function openEdit(project: Project) {
    setEditingProject(project);
    setCreateForm({
      title: project.title,
      description: project.description,
      tech_stack: (project.tech_stack || []).join(", "),
      roles_needed: (project.roles_needed || []).join(", "),
      github_url: project.github_url || "",
      duration: project.duration || "",
      start_date: project.start_date ? project.start_date.slice(0, 10) : "",
      deadline: project.deadline ? project.deadline.slice(0, 10) : "",
    });
  }

  async function handleDelete(project: Project) {
    try {
      await apiFetch(`/api/projects/${project.id}`, { method: "DELETE" });
      setDeleteConfirm(null);
      if (selectedProject?.id === project.id) setSelectedProject(null);
      fetchAll();
      showToast("Project deleted.");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to delete", false);
    }
  }

  async function handleStatusChange(project: Project, newStatus: string) {
    try {
      await apiFetch(`/api/projects/${project.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      fetchAll();
      if (selectedProject?.id === project.id) {
        setSelectedProject({ ...selectedProject, status: newStatus });
      }
      showToast(`Status changed to ${newStatus}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update status", false);
    }
  }

  async function handleApply() {
    if (!selectedProject) return;
    try {
      setIsSubmitting(true);
      const result = await apiFetch(`/api/projects/${selectedProject.id}/apply`, {
        method: "POST",
        body: JSON.stringify({
          role: applyForm.role,
          motivation: applyForm.motivation,
          cv_url: applyForm.cv_url,
          links: applyForm.links.filter((l) => l.label.trim() && l.url.trim()),
        }),
      });
      setShowApplyModal(false);
      setMyApplicationForProject(result);
      setApplyForm({ role: "", motivation: "", cv_url: null, cv_name: null, links: [] });
      fetchAll();
      showToast("Application submitted!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to apply", false);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCvUpload(file: File) {
    try {
      setIsUploadingCv(true);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8000"}/api/projects/upload-cv`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getStoredToken()}` },
        body: fd,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Upload failed");
      }
      const data = await res.json();
      setApplyForm((p) => ({ ...p, cv_url: data.url, cv_name: data.name }));
      showToast("CV uploaded");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "CV upload failed", false);
    } finally {
      setIsUploadingCv(false);
    }
  }

  async function handleApplicationStatus(appId: string, projectId: string, newStatus: "accepted" | "rejected", reason?: string) {
    try {
      setUpdatingAppId(appId);
      await apiFetch(`/api/projects/${projectId}/applications/${appId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, reason: reason || null }),
      });
      setProjectApplications((prev) =>
        prev.map((a) => a.id === appId ? { ...a, status: newStatus } : a)
      );
      setRejectModal(null);
      setRejectReason("");
      showToast(`Application ${newStatus}!`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update", false);
    } finally {
      setUpdatingAppId(null);
    }
  }

  const filtered = projects.filter((p) => {
    const matchSearch = p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      (p.tech_stack || []).some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Reject reason modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <X className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-base">Reject Application</h3>
                <p className="text-xs text-muted-foreground">The applicant will be notified with your reason.</p>
              </div>
            </div>
            <div className="mb-5">
              <label className="block text-sm font-medium mb-1.5">
                Reason for rejection <span className="text-destructive font-normal">*</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. We already found someone for this role, or your skills don't match our current needs..."
                rows={3}
                required
                className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Please provide a reason — this helps the applicant understand and improve.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                className="flex-1"
                style={{ background: "#ef4444" }}
                onClick={() => handleApplicationStatus(rejectModal.appId, rejectModal.projectId, "rejected", rejectReason)}
                disabled={updatingAppId === rejectModal.appId || !rejectReason.trim()}
              >
                {updatingAppId === rejectModal.appId
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : "Send Rejection"
                }
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => { setRejectModal(null); setRejectReason(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-bold">Delete Project</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Delete <span className="font-semibold text-foreground">"{deleteConfirm.title}"</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button className="flex-1" style={{ background: "#ef4444" }} onClick={() => handleDelete(deleteConfirm)}>Delete</Button>
              <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">Projects</h1>
          <p className="text-muted-foreground">Find teammates and collaborate on projects</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {(() => {
            const atLimit =
              !!limitInfo && !limitInfo.is_admin && (limitInfo.remaining ?? 0) <= 0;
            return (
              <Button
                onClick={() => setShowCreateModal(true)}
                disabled={atLimit}
                title={atLimit ? "Monthly publish limit reached" : undefined}
              >
                <Plus className="w-4 h-4" /> Post a Project
              </Button>
            );
          })()}
          {limitInfo && !limitInfo.is_admin && (
            <p
              className={`text-xs ${
                (limitInfo.remaining ?? 0) === 0
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {(limitInfo.remaining ?? 0) > 0
                ? `${limitInfo.remaining} of ${limitInfo.limit} left this month`
                : `Monthly limit reached${
                    limitInfo.resets_at
                      ? ` — resets ${new Date(limitInfo.resets_at).toLocaleDateString()}`
                      : ""
                  }`}
            </p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {[
          { key: "browse", label: "Browse Projects" },
          { key: "my-posts", label: `My Posts (${myPosts.length})` },
          { key: "my-projects", label: `My Projects (${myProjects.length})` },
          { key: "my-applications", label: `My Applications (${myApplications.length})` },
        ].map((tab) => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key as typeof activeTab); setSelectedProject(null); }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── BROWSE TAB ── */}
      {activeTab === "browse" && !selectedProject && (
        <div className="space-y-6">
          {/* AI Suggestions — only shown when skill matches exist */}
          {suggested.length > 0 && (
            <div className="border border-primary/20 bg-primary/3 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-primary" />
                <h2 className="font-bold text-lg">Suggested for You</h2>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Based on your skills</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {suggested.map((p) => (
                  <ProjectCard key={p.id} project={p} onClick={() => openProjectDetail(p)} highlighted />
                ))}
              </div>
            </div>
          )}

          {/* Search + Filter */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input type="text" placeholder="Search projects, tech stack..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-card rounded-lg border border-border focus:border-primary focus:outline-none transition-colors" />
            </div>
            <div className="flex gap-2">
              {(["open", "all", "closed", "completed"] as const).map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    statusFilter === s ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-muted"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{filtered.length} project{filtered.length !== 1 ? "s" : ""} found</p>

          {filtered.length === 0 ? (
            <Card className="p-12 text-center"><p className="text-muted-foreground">No projects found.</p></Card>
          ) : (() => {
            const totalPages = Math.max(1, Math.ceil(filtered.length / BROWSE_PAGE_SIZE));
            const page = Math.min(browsePage, totalPages);
            const paginated = filtered.slice((page - 1) * BROWSE_PAGE_SIZE, page * BROWSE_PAGE_SIZE);
            return (
              <>
                <div className="space-y-4">
                  {paginated.map((p) => (
                    <ProjectCard key={p.id} project={p} onClick={() => openProjectDetail(p)} />
                  ))}
                </div>
                <Pagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={BROWSE_PAGE_SIZE} onPageChange={setBrowsePage} />
              </>
            );
          })()}
        </div>
      )}

      {/* ── MY PROJECTS TAB ── */}
      {activeTab === "my-projects" && !selectedProject && (
        <div className="space-y-6">
          {myProjects.length === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">You're not in any projects yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Apply to a project from Browse, or create your own.</p>
            </Card>
          ) : (() => {
            const totalPages = Math.max(1, Math.ceil(myProjects.length / MY_PROJECTS_PAGE_SIZE));
            const page = Math.min(myProjectsPage, totalPages);
            const paginated = myProjects.slice((page - 1) * MY_PROJECTS_PAGE_SIZE, page * MY_PROJECTS_PAGE_SIZE);
            return (
              <>
                <div className="space-y-4">
                  {paginated.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      onClick={() => { setActiveTab("browse"); openProjectDetail(p); }}
                    />
                  ))}
                </div>
                <Pagination page={page} totalPages={totalPages} totalItems={myProjects.length} pageSize={MY_PROJECTS_PAGE_SIZE} onPageChange={setMyProjectsPage} />
              </>
            );
          })()}
        </div>
      )}

      {/* ── PROJECT DETAIL ── */}
      {activeTab === "browse" && selectedProject && (
        <div className="space-y-6">
          <button onClick={() => setSelectedProject(null)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            ← Back to projects
          </button>

          {/* Big centered Open Workspace CTA — for owner + accepted members */}
          {(selectedProject.owner_id === user?.user_id ||
            myApplicationForProject?.status === "accepted") && (
            <div className="rounded-2xl p-6 border border-primary/30"
              style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.08), rgba(167,139,250,0.04))",
              }}>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                    <LayoutDashboard className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base">Project Workspace</h3>
                    <p className="text-xs text-muted-foreground">Tasks, members, resources, and team chat in one place.</p>
                  </div>
                </div>
                <Button
                  size="lg"
                  className="px-8 py-3 text-base"
                  onClick={() => navigate(`/projects/${selectedProject.id}/workspace`)}
                >
                  Open Workspace <LayoutDashboard className="w-5 h-5" />
                </Button>
              </div>
            </div>
          )}

          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h2 className="text-2xl font-bold">{selectedProject.title}</h2>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[selectedProject.status] || ""}`}>
                    {selectedProject.status}
                  </span>
                </div>
                {selectedProject.owner && (
                  <div className="flex items-center gap-2 mb-4">
                    <Avatar name={selectedProject.owner.name} size="sm" src={selectedProject.owner.avatar_url} />
                    <div>
                      <p className="text-sm font-medium">{selectedProject.owner.name}</p>
                      <p className="text-xs text-muted-foreground">{selectedProject.owner.department}</p>
                    </div>
                  </div>
                )}
                <p className="text-muted-foreground leading-relaxed mb-4">{selectedProject.description}</p>

                <ProjectTimeline project={selectedProject} />

                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
                  {selectedProject.duration && (
                    <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" />{selectedProject.duration}</span>
                  )}
                  {selectedProject.github_url && (
                    <a href={selectedProject.github_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                      <Github className="w-4 h-4" /> GitHub
                    </a>
                  )}
                  <span className="flex items-center gap-1.5">
                    <Users className="w-4 h-4" />{selectedProject.application_count || 0} applications
                  </span>
                </div>

                {selectedProject.tech_stack?.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tech Stack</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedProject.tech_stack.map((t) => <Tag key={t} variant="primary">{t}</Tag>)}
                    </div>
                  </div>
                )}
                {selectedProject.roles_needed?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Roles Needed</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedProject.roles_needed.map((r) => <Tag key={r} variant="muted">{r}</Tag>)}
                    </div>
                  </div>
                )}
              </div>

              {/* Owner actions */}
              {selectedProject.owner_id === user?.user_id && (
                <div className="flex flex-col gap-2 ml-4 flex-shrink-0">
                  <Button variant="outline" size="sm" onClick={() => { openEdit(selectedProject); }}>
                    <Edit className="w-4 h-4" /> Edit
                  </Button>
                  <div className="flex gap-1">
                    {["open", "closed", "completed"].filter((s) => s !== selectedProject.status).map((s) => (
                      <button key={s} onClick={() => handleStatusChange(selectedProject, s)}
                        className={`px-2 py-1 text-xs font-medium rounded-lg border capitalize transition-colors ${STATUS_COLORS[s]}`}>
                        → {s}
                      </button>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="text-destructive border-destructive"
                    onClick={() => setDeleteConfirm(selectedProject)}>
                    <Trash2 className="w-4 h-4" /> Delete
                  </Button>
                </div>
              )}
            </div>

            {/* Apply section — for non-owners */}
            {selectedProject.owner_id !== user?.user_id && (
              <div className="border-t border-border pt-4">
                {myApplicationForProject ? (
                  <div className="space-y-3">
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${APP_STATUS_COLORS[myApplicationForProject.status]}`}>
                      <AlertCircle className="w-5 h-5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold capitalize">Application {myApplicationForProject.status}</p>
                        <p className="text-xs opacity-80">
                          {myApplicationForProject.status === "pending" && "The project owner will review your application and notify you."}
                          {myApplicationForProject.status === "accepted" && "Congratulations! You've been accepted to the team."}
                          {myApplicationForProject.status === "rejected" && "Your application was not accepted this time."}
                          {myApplicationForProject.role && ` · Role: ${myApplicationForProject.role}`}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : selectedProject.status === "open" ? (
                  <div className="flex items-center gap-4">
                    <Button onClick={() => setShowApplyModal(true)}>
                      <Briefcase className="w-4 h-4" /> Send Join Request
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      The project owner will review your request and notify you of the outcome.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    This project is <strong>{selectedProject.status}</strong> and not accepting new members.
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* Applications section — owner only */}
          {selectedProject.owner_id === user?.user_id && (
            <Card className="p-6">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Users className="w-5 h-5" /> Applications ({projectApplications.length})
              </h3>
              {isLoadingApplications ? (
                <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : projectApplications.length === 0 ? (
                <p className="text-muted-foreground text-sm italic">No applications yet.</p>
              ) : (
                <div className="space-y-4">
                  {projectApplications.map((app) => (
                    <div key={app.id} className="border border-border rounded-xl p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <Avatar name={app.applicant?.name || "?"} size="sm" src={app.applicant?.avatar_url} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="font-semibold text-sm">{app.applicant?.name || "Student"}</p>
                              {app.applicant?.github_url && (
                                <a href={app.applicant.github_url} target="_blank" rel="noopener noreferrer"
                                  className="text-muted-foreground hover:text-foreground">
                                  <Github className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">
                              {app.applicant?.department} {app.applicant?.year ? `· Year ${app.applicant.year}` : ""}
                            </p>
                            {app.applicant?.skills && app.applicant.skills.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {app.applicant.skills.slice(0, 5).map((s) => (
                                  <span key={s} className="text-xs bg-muted px-1.5 py-0.5 rounded">{s}</span>
                                ))}
                              </div>
                            )}
                            <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                              <p className="text-xs font-semibold text-muted-foreground mb-1">Applying for: <span className="text-foreground">{app.role}</span></p>
                              <p className="text-sm text-foreground">{app.motivation}</p>
                            </div>
                            {app.cv_url && (
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                <a
                                  href={app.cv_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors"
                                >
                                  <Sparkles className="w-3 h-3" /> Preview CV
                                </a>
                                <a
                                  href={app.cv_url}
                                  download={app.cv_name || "cv.pdf"}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors"
                                >
                                  Download
                                </a>
                                {app.cv_name && (
                                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                    {app.cv_name}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${APP_STATUS_COLORS[app.status]}`}>
                            {app.status}
                          </span>
                          {app.status === "pending" && (
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => handleApplicationStatus(app.id, selectedProject.id, "accepted")}
                                disabled={updatingAppId === app.id}>
                                {updatingAppId === app.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3" /> Accept</>}
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive border-destructive"
                                onClick={() => { setRejectModal({ appId: app.id, projectId: selectedProject.id }); setRejectReason(""); }}
                                disabled={updatingAppId === app.id}>
                                <X className="w-3 h-3" /> Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── MY POSTS TAB ── */}
      {activeTab === "my-posts" && (
        <div className="space-y-4">
          {myPosts.length === 0 ? (
            <Card className="p-12 text-center">
              <Briefcase className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-muted-foreground mb-4">You haven't posted any projects yet.</p>
              <Button onClick={() => setShowCreateModal(true)}><Plus className="w-4 h-4" /> Post a Project</Button>
            </Card>
          ) : (
            myPosts.map((p) => (
              <Card key={p.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 cursor-pointer" onClick={() => { setActiveTab("browse"); openProjectDetail(p); }}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-base">{p.title}</h3>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[p.status]}`}>{p.status}</span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{p.description}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{p.application_count || 0} applications</span>
                      {p.duration && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{p.duration}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/projects/${p.id}/workspace`)}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <LayoutDashboard className="w-3.5 h-3.5" /> Workspace
                    </button>
                    <div className="flex gap-1">
                      {["open", "closed", "completed"].filter((s) => s !== p.status).map((s) => (
                        <button key={s} onClick={() => handleStatusChange(p, s)}
                          className={`px-2 py-1 text-xs font-medium rounded-lg border capitalize ${STATUS_COLORS[s]}`}>
                          → {s}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(p)}
                        className="p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteConfirm(p)}
                        className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── MY APPLICATIONS TAB ── */}
      {activeTab === "my-applications" && (
        <div className="space-y-4">
          {myApplications.length === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">You haven't applied to any projects yet.</p>
            </Card>
          ) : (
            myApplications.map((app) => (
              <Card
                key={app.id}
                className="p-5 cursor-pointer hover:shadow-md transition-shadow"
                onClick={async () => {
                  // Try to find in projects list first
                  let proj = projects.find((p) => p.id === app.project_id);
                  if (!proj) {
                    // Otherwise fetch it
                    try {
                      proj = await apiFetch(`/api/projects/${app.project_id}`);
                    } catch {
                      showToast("Project not found or deleted", false);
                      return;
                    }
                  }
                  setActiveTab("browse");
                  if (proj) openProjectDetail(proj);
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-base">{app.project?.title || "Unknown Project"}</h3>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${APP_STATUS_COLORS[app.status]}`}>
                        {app.status}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">
                      Applied for: <span className="font-medium text-foreground">{app.role}</span>
                    </p>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{app.motivation}</p>

                    {/* Workspace entry — accepted applications */}
                    {app.status === "accepted" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/projects/${app.project_id}/workspace`); }}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors mb-2"
                      >
                        <LayoutDashboard className="w-3.5 h-3.5" /> Open Workspace
                      </button>
                    )}

                    {/* Rejection reason */}
                    {app.status === "rejected" && app.rejection_reason && (
                      <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold">Rejection reason: </span>
                          {app.rejection_reason}
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(app.applied_at || app.created_at || "").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1" />
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingProject) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold">{editingProject ? "Edit Project" : "Post a Project"}</h2>
              <button onClick={() => { setShowCreateModal(false); setEditingProject(null); }}
                className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              {[
                { label: "Title", key: "title", placeholder: "Project title" },
                { label: "GitHub URL (optional)", key: "github_url", placeholder: "https://github.com/..." },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-sm font-medium mb-1.5">{label}</label>
                  <input value={createForm[key as keyof typeof createForm]}
                    onChange={(e) => setCreateForm({ ...createForm, [key]: e.target.value })}
                    placeholder={placeholder}
                    className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              ))}
              {(() => {
                const today = todayISO();
                // Deadline must be strictly *after* start, so its `min` is one day later.
                const deadlineMin = createForm.start_date
                  ? new Date(new Date(createForm.start_date).getTime() + 86_400_000).toISOString().slice(0, 10)
                  : today;
                const startMax = createForm.deadline
                  ? new Date(new Date(createForm.deadline).getTime() - 86_400_000).toISOString().slice(0, 10)
                  : undefined;
                const dateError = validateProjectDates(createForm.start_date, createForm.deadline);
                const duration = computeDurationLabel(createForm.start_date, createForm.deadline);
                return (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Start date</label>
                        <input
                          type="date"
                          value={createForm.start_date}
                          min={today}
                          max={startMax}
                          onChange={(e) => setCreateForm({ ...createForm, start_date: e.target.value })}
                          className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1.5">Deadline</label>
                        <input
                          type="date"
                          value={createForm.deadline}
                          min={deadlineMin}
                          onChange={(e) => setCreateForm({ ...createForm, deadline: e.target.value })}
                          className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>
                    {dateError ? (
                      <p className="text-xs text-red-500 flex items-center gap-1.5 -mt-2">
                        <AlertCircle className="w-3.5 h-3.5" /> {dateError}
                      </p>
                    ) : duration ? (
                      <p className="text-xs text-muted-foreground -mt-2">
                        <Clock className="w-3.5 h-3.5 inline mr-1" />
                        Duration: <span className="font-medium text-foreground">{duration}</span> (auto-calculated)
                      </p>
                    ) : null}
                  </>
                );
              })()}
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="Describe your project..." rows={4}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Tech Stack <span className="text-muted-foreground font-normal">(comma separated)</span></label>
                <input value={createForm.tech_stack} onChange={(e) => setCreateForm({ ...createForm, tech_stack: e.target.value })}
                  placeholder="React, Python, PostgreSQL"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Roles Needed <span className="text-muted-foreground font-normal">(comma separated)</span></label>
                <input value={createForm.roles_needed} onChange={(e) => setCreateForm({ ...createForm, roles_needed: e.target.value })}
                  placeholder="Frontend Developer, UI Designer, Backend Developer"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={editingProject ? handleEdit : handleCreate}
                disabled={
                  isSubmitting ||
                  !createForm.title ||
                  !createForm.description ||
                  validateProjectDates(createForm.start_date, createForm.deadline) !== null
                }>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : editingProject ? "Save Changes" : "Post Project"}
              </Button>
              <Button variant="outline" onClick={() => { setShowCreateModal(false); setEditingProject(null); }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Apply Modal */}
      {showApplyModal && selectedProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Send Join Request</h2>
              <button onClick={() => setShowApplyModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-muted rounded-lg px-4 py-3 mb-4">
              <p className="text-sm font-medium">{selectedProject.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your request will be sent to the project owner. They will review your profile and motivation, then accept or reject your application.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Role You're Applying For</label>
                <select value={applyForm.role} onChange={(e) => setApplyForm({ ...applyForm, role: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="">Select a role</option>
                  {selectedProject.roles_needed.map((r) => <option key={r} value={r}>{r}</option>)}
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Motivation</label>
                <textarea value={applyForm.motivation} onChange={(e) => setApplyForm({ ...applyForm, motivation: e.target.value })}
                  placeholder="Why do you want to join this project? What can you contribute?"
                  rows={4} className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>

              {/* CV upload */}
              <div>
                <label className="block text-sm font-medium mb-1.5">CV / Resume <span className="text-muted-foreground font-normal">(optional, PDF/DOC)</span></label>
                {applyForm.cv_url ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-muted border border-border rounded-lg">
                    <div className="flex items-center gap-2 min-w-0 text-sm">
                      <span className="text-primary">📄</span>
                      <a href={applyForm.cv_url} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{applyForm.cv_name}</a>
                    </div>
                    <button type="button" onClick={() => setApplyForm((p) => ({ ...p, cv_url: null, cv_name: null }))} className="text-xs text-destructive hover:underline flex-shrink-0">Remove</button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm bg-muted border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/70 transition-colors">
                    {isUploadingCv ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                    ) : (
                      <><span>📎</span> Choose file (max 10 MB)</>
                    )}
                    <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      hidden disabled={isUploadingCv}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCvUpload(f); e.target.value = ""; }} />
                  </label>
                )}
              </div>

              {/* Links */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium">Links <span className="text-muted-foreground font-normal">(GitHub, LinkedIn, portfolio…)</span></label>
                  <button type="button"
                    onClick={() => setApplyForm((p) => ({ ...p, links: [...p.links, { label: "", url: "" }] }))}
                    className="text-xs text-primary hover:underline">+ Add link</button>
                </div>
                {applyForm.links.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No links added.</p>
                ) : (
                  <div className="space-y-2">
                    {applyForm.links.map((link, i) => (
                      <div key={i} className="flex gap-2">
                        <input type="text" placeholder="Label (e.g. GitHub)" value={link.label}
                          onChange={(e) => setApplyForm((p) => ({ ...p, links: p.links.map((l, j) => j === i ? { ...l, label: e.target.value } : l) }))}
                          className="w-32 px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                        <input type="url" placeholder="https://…" value={link.url}
                          onChange={(e) => setApplyForm((p) => ({ ...p, links: p.links.map((l, j) => j === i ? { ...l, url: e.target.value } : l) }))}
                          className="flex-1 px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                        <button type="button"
                          onClick={() => setApplyForm((p) => ({ ...p, links: p.links.filter((_, j) => j !== i) }))}
                          className="px-2 text-destructive hover:bg-destructive/10 rounded-lg"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={handleApply} disabled={isSubmitting || isUploadingCv || !applyForm.role || !applyForm.motivation}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Request"}
              </Button>
              <Button variant="outline" onClick={() => setShowApplyModal(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Project Card Component ──
function ProjectCard({ project, onClick, highlighted }: {
  project: Project; onClick: () => void; highlighted?: boolean;
}) {
  return (
    <Card
      className={`p-5 hover:shadow-md transition-all ${highlighted ? "border-primary/30 bg-primary/2" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onClick}>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-bold text-base">{project.title}</h3>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[project.status] || ""}`}>
              {project.status}
            </span>
            {highlighted && (
              <span className="flex items-center gap-1 text-xs text-primary font-medium">
                <Sparkles className="w-3 h-3" /> Match
              </span>
            )}
          </div>
          {project.owner && (
            <p className="text-xs text-muted-foreground mb-2">{project.owner.name} · {project.owner.department}</p>
          )}
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
            {project.duration && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{project.duration}</span>}
            {project.github_url && <span className="flex items-center gap-1"><Github className="w-3.5 h-3.5" />GitHub</span>}
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{project.application_count || 0} applicants</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(project.tech_stack || []).slice(0, 4).map((t) => (
              <Tag key={t} variant="primary" className="text-xs">{t}</Tag>
            ))}
            {(project.tech_stack || []).length > 4 && (
              <span className="text-xs text-muted-foreground">+{project.tech_stack.length - 4} more</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 items-end flex-shrink-0">
          <div className="flex flex-wrap gap-1 justify-end max-w-32">
            {(project.roles_needed || []).slice(0, 2).map((r) => (
              <Tag key={r} variant="muted" className="text-xs">{r}</Tag>
            ))}
          </div>
          <button
            onClick={onClick}
            className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors mt-1"
          >
            View Details <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}