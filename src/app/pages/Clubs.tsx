import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import {
  Users, Search, Plus, X, Loader2, Filter,
  CheckCircle, Clock, Check, Trash2
} from "lucide-react";
import { Link, useLocation } from "react-router";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { SkeletonPage, SkeletonGrid } from "../components/Skeleton";

interface Club {
  id: string;
  name: string;
  description: string;
  category: string;
  cover_url?: string;
  admin_user_id: string;
  is_open: boolean;
  status: string;
  member_count?: number;
}

interface MyMembership {
  club_id: string;
  status: string;
  role: string;
}

interface ClubRequest {
  id: string;
  requester_id: string;
  club_name: string;
  category: string;
  description: string;
  motivation?: string | null;
  is_open?: boolean;
  status: string;
  review_note?: string | null;
  created_at: string;
}

// Single source of truth for club categories.
// `CATEGORIES` includes the "All" pseudo-option used by the filter.
// `CLUB_CATEGORIES` is the actual list used in forms (no "All").
// Keep "Others" last — it's the catch-all.
const CATEGORIES = ["All", "Technical", "Social", "Sports", "Arts", "Research", "Business", "Others"];
const CLUB_CATEGORIES = ["Technical", "Social", "Sports", "Arts", "Research", "Business", "Others"];
const MEMBERSHIP_FILTERS = ["All", "Joined", "Not Joined", "Pending"];

const CATEGORY_GRADIENTS: Record<string, string> = {
  Technical: "from-blue-500 to-indigo-600",
  Social: "from-green-400 to-teal-500",
  Sports: "from-orange-400 to-red-500",
  Arts: "from-pink-400 to-purple-500",
  Research: "from-cyan-500 to-blue-500",
  Business: "from-yellow-400 to-orange-500",
  Others: "from-slate-400 to-slate-600",
  default: "from-primary to-secondary",
};

const CATEGORY_COLORS: Record<string, string> = {
  Technical: "#3b82f6",
  Social: "#10b981",
  Sports: "#f97316",
  Arts: "#ec4899",
  Research: "#06b6d4",
  Business: "#eab308",
  Others: "#64748b",
  default: "#6366f1",
};

const CLUBS_PER_PAGE = 9;

export function Clubs() {
  const { t, i18n } = useTranslation("clubs");
  const { t: tc } = useTranslation("common");
  const locale = i18n.language;
  const { user } = useAuth();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [myMemberships, setMyMemberships] = useState<MyMembership[]>([]);
  const [clubRequests, setClubRequests] = useState<ClubRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<"clubs" | "requests">(() => {
    const params = new URLSearchParams(location.search);
    return params.get("tab") === "requests" ? "requests" : "clubs";
  });

  // React to URL changes (notification click etc.)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("tab") === "requests" && user?.role === "admin") {
      setActiveTab("requests");
    }
  }, [location.search, user?.role]);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [membershipFilter, setMembershipFilter] = useState("All");
  const [membershipType, setMembershipType] = useState<"all" | "open" | "closed">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({ name: "", description: "", category: "Technical", is_open: true });
  const [requestForm, setRequestForm] = useState({
    club_name: "",
    category: "Technical",
    description: "",
    motivation: "",
    is_open: true,
  });
  // Modal state for admin-side rejection: holds the request being rejected
  // plus the reason text. Reason is required server-side; we enforce on
  // the client too so the admin gets immediate feedback.
  const [rejectModal, setRejectModal] = useState<{ requestId: string; clubName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinFeedback, setJoinFeedback] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [deletingClubId, setDeletingClubId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  function handleFilterChange(fn: () => void) {
    fn();
    setCurrentPage(1);
  }

  useEffect(() => {
    fetchClubs();
    fetchMemberships();
    if (user?.role === "admin") fetchClubRequests();
  }, []);

  async function fetchClubs() {
    try {
      setIsLoading(true);
      const data = await apiFetch("/api/clubs/");
      setClubs(data);
    } catch {
      console.error("Failed to load clubs");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchMemberships() {
    try {
      const data = await apiFetch("/api/clubs/my-memberships");
      setMyMemberships(data);
    } catch { /* ignore */ }
  }

  async function fetchClubRequests() {
    try {
      setIsLoadingRequests(true);
      const data = await apiFetch("/api/clubs/admin-requests");
      setClubRequests((data || []).filter((r: ClubRequest) => r.status === "pending"));
    } catch {
      console.error("Failed to load requests");
    } finally {
      setIsLoadingRequests(false);
    }
  }

  function getMembership(clubId: string): MyMembership | undefined {
    return myMemberships.find((m) => m.club_id === clubId);
  }

  async function handleJoin(club: Club) {
    try {
      setJoiningId(club.id);
      const result = await apiFetch(`/api/clubs/${club.id}/join`, { method: "POST" });
      const isOpen = result.is_open;
      setJoinFeedback({
        id: club.id,
        msg: isOpen ? t("toast.joined") : t("toast.requestSent"),
        ok: true,
      });
      fetchMemberships();
      setTimeout(() => setJoinFeedback(null), 3500);
    } catch (err: unknown) {
      setJoinFeedback({
        id: club.id,
        msg: err instanceof Error ? err.message : t("toast.joinFailed"),
        ok: false,
      });
      setTimeout(() => setJoinFeedback(null), 3500);
    } finally {
      setJoiningId(null);
    }
  }

  async function handleCreate() {
    try {
      setIsSubmitting(true);
      await apiFetch("/api/clubs/", { method: "POST", body: JSON.stringify(createForm) });
      setShowCreateModal(false);
      setCreateForm({ name: "", description: "", category: "Technical", is_open: true });
      fetchClubs();
      showToast(t("toast.clubCreated"));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("toast.createFailed"), false);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRequest() {
    try {
      setIsRequesting(true);
      await apiFetch("/api/clubs/request", {
        method: "POST",
        body: JSON.stringify({
          club_name: requestForm.club_name,
          category: requestForm.category,
          description: requestForm.description,
          motivation: requestForm.motivation || undefined,
          is_open: requestForm.is_open,
        }),
      });
      setShowRequestModal(false);
      setRequestForm({
        club_name: "",
        category: "Technical",
        description: "",
        motivation: "",
        is_open: true,
      });
      showToast(t("toast.requestSubmitted"));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("toast.submitFailed"), false);
    } finally {
      setIsRequesting(false);
    }
  }

  async function handleDeleteClub(clubId: string) {
    try {
      setDeletingClubId(clubId);
      await apiFetch(`/api/clubs/${clubId}`, { method: "DELETE" });
      setClubs((prev) => prev.filter((c) => c.id !== clubId));
      showToast(t("toast.clubDeleted"));
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("toast.deleteFailed"), false);
    } finally {
      setDeletingClubId(null);
      setDeleteConfirm(null);
    }
  }

  async function handleReviewRequest(
    requestId: string,
    status: "approved" | "rejected",
    note?: string,
  ) {
    try {
      setReviewingId(requestId);
      await apiFetch(`/api/clubs/review-request/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          review_note: status === "rejected" ? (note || "").trim() : null,
        }),
      });
      showToast(status === "approved" ? t("toast.approved") : t("toast.rejected"));
      fetchClubRequests();
      if (status === "approved") fetchClubs();
      // Close the reject modal if it was open for this request.
      if (status === "rejected") {
        setRejectModal(null);
        setRejectReason("");
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("toast.reviewFailed"), false);
    } finally {
      setReviewingId(null);
    }
  }

  // Filtering
  const filtered = clubs.filter((c) => {
    const matchSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === "All" || c.category === activeCategory;
    const mem = getMembership(c.id);
    const matchMem =
      membershipFilter === "All" ||
      (membershipFilter === "Joined" && mem?.status === "approved") ||
      (membershipFilter === "Pending" && mem?.status === "pending") ||
      (membershipFilter === "Not Joined" && !mem);
    const matchType =
      membershipType === "all" ||
      (membershipType === "open" && c.is_open) ||
      (membershipType === "closed" && !c.is_open);
    return matchSearch && matchCat && matchMem && matchType;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / CLUBS_PER_PAGE));
  const paginated = filtered.slice((currentPage - 1) * CLUBS_PER_PAGE, currentPage * CLUBS_PER_PAGE);

  if (isLoading) {
    return (
      <SkeletonPage>
        <SkeletonGrid count={6} columns={3} />
      </SkeletonPage>
    );
  }

  return (
    <div className="space-y-6">

      {/* Delete Club Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border p-5 md:p-6 w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-bold text-base">{t("deleteModal.title")}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              {t("deleteModal.confirm", { name: deleteConfirm.name })}
            </p>
            <div className="flex gap-3">
              <Button
                className="flex-1"
                style={{ background: "#ef4444" }}
                onClick={() => handleDeleteClub(deleteConfirm.id)}
                disabled={deletingClubId === deleteConfirm.id}
              >
                {deletingClubId === deleteConfirm.id
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : t("deleteModal.delete")
                }
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                {tc("actions.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.ok ? <CheckCircle className="w-4 h-4" /> : <X className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header — stacks on mobile so the action button drops below the
          title instead of getting pushed off-screen. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">{t("list.heading")}</h1>
        </div>
        <div className="flex gap-2">
          {user?.role === "admin" ? (
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4" /> {t("list.createClub")}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setShowRequestModal(true)}>
              <Plus className="w-4 h-4" /> {t("list.requestClub")}
            </Button>
          )}
        </div>
      </div>

      {/* Admin tabs */}
      {user?.role === "admin" && (
        <div className="flex gap-0 border-b border-border overflow-x-auto">
          <button
            onClick={() => setActiveTab("clubs")}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "clubs"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("list.allClubs")}
          </button>
          <button
            onClick={() => { setActiveTab("requests"); fetchClubRequests(); }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "requests"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("list.clubRequests")}
            {clubRequests.length > 0 && (
              <span className="w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                {clubRequests.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* ── REQUESTS TAB (admin only) ── */}
      {activeTab === "requests" && user?.role === "admin" && (
        <div className="space-y-4">
          {isLoadingRequests ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : clubRequests.length === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">{t("list.noPendingRequests")}</p>
            </Card>
          ) : (
            clubRequests.map((req) => (
              <Card key={req.id} className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-base">{req.club_name}</h3>
                      <Tag variant="muted" className="text-xs">{t(`categories.${req.category}`, { defaultValue: req.category })}</Tag>
                      <Tag variant="muted" className="text-xs">
                        {req.is_open === false ? t("list.membersOnly") : t("list.open")}
                      </Tag>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{req.description}</p>
                    {req.motivation && (
                      <div className="mb-2 rounded-md bg-muted/60 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                          {t("list.motivationLabel")}
                        </div>
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                          {req.motivation}
                        </p>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("list.submittedOn", { date: new Date(req.created_at).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }) })}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleReviewRequest(req.id, "approved")}
                      disabled={reviewingId === req.id}
                    >
                      {reviewingId === req.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <><Check className="w-4 h-4" /> {t("list.approve")}</>
                      }
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setRejectModal({ requestId: req.id, clubName: req.club_name }); setRejectReason(""); }}
                      disabled={reviewingId === req.id}
                      className="text-destructive border-destructive hover:bg-destructive/10"
                    >
                      <X className="w-4 h-4" /> {t("list.reject")}
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ── CLUBS TAB ── */}
      {activeTab === "clubs" && (
        <div className="space-y-4">

          {/* Search + filter bar */}
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t("list.searchPlaceholder")}
                  value={search}
                  onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
                  className="w-full pl-10 pr-4 py-2.5 bg-card rounded-lg border border-border focus:border-primary focus:outline-none transition-colors"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  showFilters ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted"
                }`}
              >
                <Filter className="w-4 h-4" /> {t("list.filters")}
              </button>
            </div>

            {/* Category chips */}
            <div className="flex gap-2 overflow-x-auto pb-1 flex-wrap">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => handleFilterChange(() => setActiveCategory(cat))}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                    activeCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {t(`categories.${cat}`, { defaultValue: cat })}
                </button>
              ))}
            </div>

            {/* Extended filters */}
            {showFilters && (
              <Card className="p-4">
                <div className="flex flex-wrap gap-6">
                  {user?.role !== "admin" && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("list.myStatus")}</p>
                      <div className="flex gap-2">
                        {MEMBERSHIP_FILTERS.map((f) => (
                          <button
                            key={f}
                            onClick={() => handleFilterChange(() => setMembershipFilter(f))}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              membershipFilter === f
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground hover:bg-muted/80"
                            }`}
                          >
                            {t(`membershipFilters.${f}`, { defaultValue: f })}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("list.membershipType")}</p>
                    <div className="flex gap-2">
                      {[["all", t("list.allTypes")], ["open", t("list.open")], ["closed", t("list.approvalRequired")]].map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => handleFilterChange(() => setMembershipType(val as "all" | "open" | "closed"))}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            membershipType === val
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground hover:bg-muted/80"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ml-auto flex items-end">
                    <button
                      onClick={() => handleFilterChange(() => {
                        setActiveCategory("All");
                        setMembershipFilter("All");
                        setMembershipType("all");
                        setSearch("");
                      })}
                      className="text-sm text-muted-foreground hover:text-foreground underline"
                    >
                      {t("list.clearAll")}
                    </button>
                  </div>
                </div>
              </Card>
            )}

            <p className="text-sm text-muted-foreground">
              {t("list.found", { count: filtered.length, page: currentPage, pages: totalPages })}
            </p>
          </div>

          {/* Club cards */}
          {filtered.length === 0 ? (
            <Card className="p-4">
              <EmptyState icon={Search} title={t("list.noClubsFound")} />
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {paginated.map((club) => {
                  const mem = getMembership(club.id);
                  const isAdmin = user?.role === "admin";
                  const isClubAdmin = club.admin_user_id === user?.user_id;
                  const gradient = CATEGORY_GRADIENTS[club.category] || CATEGORY_GRADIENTS.default;
                  const accentColor = CATEGORY_COLORS[club.category] || CATEGORY_COLORS.default;
                  const feedback = joinFeedback?.id === club.id ? joinFeedback : null;

                  return (
                    <Card key={club.id} className="overflow-hidden hover:shadow-lg transition-shadow flex flex-col">
                      {/* Cover */}
                      <div className="relative h-36 flex-shrink-0">
                        {club.cover_url ? (
                          <img src={club.cover_url} alt={club.name} loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                            <span className="text-white text-5xl font-bold opacity-25">{club.name[0]}</span>
                          </div>
                        )}
                        {/* Category badge */}
                        <div className="absolute top-3 left-3">
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: accentColor }}>
                            {t(`categories.${club.category}`, { defaultValue: club.category })}
                          </span>
                        </div>
                        {/* Membership badge — only for non-admins */}
                        {!isAdmin && mem && (
                          <div className="absolute top-3 right-3">
                            {mem.status === "approved" ? (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500 text-white">
                                <CheckCircle className="w-3 h-3" /> {t("list.joined")}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500 text-white">
                                <Clock className="w-3 h-3" /> {t("list.pending")}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Card body */}
                      <div className="p-5 flex flex-col flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-bold text-base leading-tight flex-1 mr-2">{club.name}</h3>
                          <Tag variant={club.is_open ? "primary" : "muted"} className="text-xs flex-shrink-0">
                            {club.is_open ? t("list.open") : t("list.approval")}
                          </Tag>
                        </div>

                        <p className="text-muted-foreground text-sm mb-3 line-clamp-2 flex-1">
                          {club.description}
                        </p>

                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
                          <Users className="w-3.5 h-3.5" />
                          <span>{t("list.members", { count: club.member_count ?? 0 })}</span>
                        </div>

                        {/* Inline feedback */}
                        {feedback && (
                          <div className={`text-xs rounded-lg px-3 py-2 mb-3 font-medium ${
                            feedback.ok
                              ? "bg-green-50 text-green-700 border border-green-200"
                              : "bg-red-50 text-red-700 border border-red-200"
                          }`}>
                            {feedback.msg}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          <Link to={`/clubs/${club.id}`} className="flex-1">
                            <Button variant="outline" className="w-full h-10 text-sm">{t("list.viewClub")}</Button>
                          </Link>
                          {isAdmin && (
                            <>
                              <Link to={`/clubs/${club.id}#manage`} className="flex-1">
                                <Button className="w-full h-10 text-sm">{t("list.manage")}</Button>
                              </Link>
                              <button
                                onClick={() => setDeleteConfirm({ id: club.id, name: club.name })}
                                disabled={deletingClubId === club.id}
                                className="h-10 w-10 flex items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 flex-shrink-0 transition-colors disabled:opacity-50"
                              >
                                {deletingClubId === club.id
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : <Trash2 className="w-4 h-4" />
                                }
                              </button>
                            </>
                          )}

                          {/* Club admin (not platform admin) — show manage */}
                          {!isAdmin && isClubAdmin && (
                            <Link to={`/clubs/${club.id}#manage`} className="flex-1">
                              <Button className="w-full text-sm">{t("list.manage")}</Button>
                            </Link>
                          )}
                          {/* Club president/admin member — also show manage */}
                          {!isAdmin && !isClubAdmin && mem?.role === "president" || !isAdmin && !isClubAdmin && mem?.role === "admin" ? (
                            <Link to={`/clubs/${club.id}#manage`} className="flex-1">
                              <Button className="w-full text-sm">{t("list.manage")}</Button>
                            </Link>
                          ) : null}

                          {/* Regular student */}
                          {!isAdmin && !isClubAdmin && (
                            mem?.status === "approved" ? (
                              <Button variant="outline" className="flex-1 text-sm" disabled style={{ color: "#16a34a", borderColor: "#bbf7d0" }}>
                                {t("list.joinedCheck")}
                              </Button>
                            ) : mem?.status === "pending" ? (
                              <Button variant="outline" className="flex-1 text-sm" disabled>
                                {t("list.pending")}
                              </Button>
                            ) : (
                              <Button
                                className="flex-1 text-sm"
                                onClick={() => handleJoin(club)}
                                disabled={joiningId === club.id}
                              >
                                {joiningId === club.id
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : club.is_open ? t("list.join") : t("list.apply")
                                }
                              </Button>
                            )
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* Pagination — always shown */}
              <div className="flex items-center justify-between gap-4 flex-wrap pt-4">
                <p className="text-xs text-muted-foreground">
                  {t("list.showing", {
                    from: (currentPage - 1) * CLUBS_PER_PAGE + 1,
                    to: Math.min(currentPage * CLUBS_PER_PAGE, filtered.length),
                    total: filtered.length,
                  })}
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 rounded-lg text-sm font-medium border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ← {t("list.prev")}
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
                    className="px-3 py-2 rounded-lg text-sm font-medium border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {t("list.next")} →
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("list.pageOf", { current: currentPage, total: totalPages })}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Admin: Create Club Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-5 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{t("createModal.title")}</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">{t("createModal.clubName")}</label>
                <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder={t("createModal.clubNamePlaceholder")} className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">{t("createModal.description")}</label>
                <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder={t("createModal.descriptionPlaceholder")} rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">{t("createModal.category")}</label>
                <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                  {CATEGORIES.filter((c) => c !== "All").map((cat) => <option key={cat} value={cat}>{t(`categories.${cat}`, { defaultValue: cat })}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_open_create" checked={createForm.is_open}
                  onChange={(e) => setCreateForm({ ...createForm, is_open: e.target.checked })} className="w-4 h-4" />
                <label htmlFor="is_open_create" className="text-sm">{t("createModal.openMembership")}</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={handleCreate} disabled={isSubmitting || !createForm.name || !createForm.description}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("createModal.create")}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>{tc("actions.cancel")}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Student: Request Club Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-5 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold">{t("requestModal.title")}</h2>
              <button onClick={() => setShowRequestModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              {t("requestModal.intro")}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">{t("requestModal.clubName")}</label>
                <input value={requestForm.club_name} onChange={(e) => setRequestForm({ ...requestForm, club_name: e.target.value })}
                  placeholder={t("requestModal.clubNamePlaceholder")} className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">{t("requestModal.category")}</label>
                <select value={requestForm.category} onChange={(e) => setRequestForm({ ...requestForm, category: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                  {CATEGORIES.filter((c) => c !== "All").map((cat) => <option key={cat} value={cat}>{t(`categories.${cat}`, { defaultValue: cat })}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">{t("requestModal.description")}</label>
                <textarea value={requestForm.description} onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })}
                  placeholder={t("requestModal.descriptionPlaceholder")} rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  {t("requestModal.motivation")} <span className="text-muted-foreground font-normal">{t("requestModal.optional")}</span>
                </label>
                <textarea
                  value={requestForm.motivation}
                  onChange={(e) => setRequestForm({ ...requestForm, motivation: e.target.value })}
                  placeholder={t("requestModal.motivationPlaceholder")}
                  rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t("requestModal.membershipType")}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRequestForm({ ...requestForm, is_open: true })}
                    className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      requestForm.is_open
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="font-semibold mb-0.5">{t("requestModal.open")}</div>
                    <div className="text-xs opacity-80">{t("requestModal.openDesc")}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestForm({ ...requestForm, is_open: false })}
                    className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      !requestForm.is_open
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="font-semibold mb-0.5">{t("requestModal.membersOnly")}</div>
                    <div className="text-xs opacity-80">{t("requestModal.membersOnlyDesc")}</div>
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={handleRequest} disabled={isRequesting || !requestForm.club_name || !requestForm.description}>
                {isRequesting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("requestModal.submit")}
              </Button>
              <Button variant="outline" onClick={() => setShowRequestModal(false)}>{tc("actions.cancel")}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Admin: Reject Club Request Modal — reason required, matches the
          project-application rejection UX. */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-5 md:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold">{t("rejectModal.title")}</h2>
              <button onClick={() => { setRejectModal(null); setRejectReason(""); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t("rejectModal.intro", { name: rejectModal.clubName })}
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("rejectModal.placeholder")}
              rows={4}
              autoFocus
              className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none mb-4"
            />
            <div className="flex gap-3">
              <Button
                variant="danger"
                onClick={() => handleReviewRequest(rejectModal.requestId, "rejected", rejectReason.trim())}
                disabled={!rejectReason.trim() || reviewingId === rejectModal.requestId}
              >
                {reviewingId === rejectModal.requestId ? <Loader2 className="w-4 h-4 animate-spin" /> : t("rejectModal.reject")}
              </Button>
              <Button variant="outline" onClick={() => { setRejectModal(null); setRejectReason(""); }}>{tc("actions.cancel")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}