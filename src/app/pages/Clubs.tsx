import { useState, useEffect } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Tag } from "../components/Tag";
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
  status: string;
  created_at: string;
}

const CATEGORIES = ["All", "Technical", "Social", "Sports", "Arts", "Research", "Business"];
const MEMBERSHIP_FILTERS = ["All", "Joined", "Not Joined", "Pending"];

const CATEGORY_GRADIENTS: Record<string, string> = {
  Technical: "from-blue-500 to-indigo-600",
  Social: "from-green-400 to-teal-500",
  Sports: "from-orange-400 to-red-500",
  Arts: "from-pink-400 to-purple-500",
  Research: "from-cyan-500 to-blue-500",
  Business: "from-yellow-400 to-orange-500",
  default: "from-primary to-secondary",
};

const CATEGORY_COLORS: Record<string, string> = {
  Technical: "#3b82f6",
  Social: "#10b981",
  Sports: "#f97316",
  Arts: "#ec4899",
  Research: "#06b6d4",
  Business: "#eab308",
  default: "#6366f1",
};

const CLUBS_PER_PAGE = 9;

export function Clubs() {
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
  const [requestForm, setRequestForm] = useState({ club_name: "", category: "Technical", description: "" });

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
        msg: isOpen ? "Successfully joined!" : "Application sent! Waiting for admin approval.",
        ok: true,
      });
      fetchMemberships();
      setTimeout(() => setJoinFeedback(null), 3500);
    } catch (err: unknown) {
      setJoinFeedback({
        id: club.id,
        msg: err instanceof Error ? err.message : "Failed to join",
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
      showToast("Club created successfully!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to create club", false);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRequest() {
    try {
      setIsRequesting(true);
      await apiFetch("/api/clubs/request", { method: "POST", body: JSON.stringify(requestForm) });
      setShowRequestModal(false);
      setRequestForm({ club_name: "", category: "Technical", description: "" });
      showToast("Club request submitted! Admin will review it soon.");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to submit request", false);
    } finally {
      setIsRequesting(false);
    }
  }

  async function handleDeleteClub(clubId: string) {
    try {
      setDeletingClubId(clubId);
      await apiFetch(`/api/clubs/${clubId}`, { method: "DELETE" });
      setClubs((prev) => prev.filter((c) => c.id !== clubId));
      showToast("Club deleted.");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to delete club", false);
    } finally {
      setDeletingClubId(null);
      setDeleteConfirm(null);
    }
  }

  async function handleReviewRequest(requestId: string, status: "approved" | "rejected") {
    try {
      setReviewingId(requestId);
      await apiFetch(`/api/clubs/review-request/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          review_note: status === "rejected" ? "Request does not meet club creation criteria." : null,
        }),
      });
      showToast(status === "approved" ? "Club approved and created!" : "Request rejected.");
      fetchClubRequests();
      if (status === "approved") fetchClubs();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to review request", false);
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
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-bold text-base">Delete Club</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete <span className="font-semibold text-foreground">"{deleteConfirm.name}"</span>? This action cannot be undone.
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
                  : "Delete Club"
                }
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>
                Cancel
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

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Student Clubs</h1>
        </div>
        <div className="flex gap-2">
          {user?.role === "admin" ? (
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4" /> Create Club
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setShowRequestModal(true)}>
              <Plus className="w-4 h-4" /> Request a Club
            </Button>
          )}
        </div>
      </div>

      {/* Admin tabs */}
      {user?.role === "admin" && (
        <div className="flex gap-0 border-b border-border">
          <button
            onClick={() => setActiveTab("clubs")}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "clubs"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            All Clubs
          </button>
          <button
            onClick={() => { setActiveTab("requests"); fetchClubRequests(); }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "requests"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Club Requests
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
              <p className="text-muted-foreground">No pending club requests.</p>
            </Card>
          ) : (
            clubRequests.map((req) => (
              <Card key={req.id} className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-base">{req.club_name}</h3>
                      <Tag variant="muted" className="text-xs">{req.category}</Tag>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{req.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Submitted {new Date(req.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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
                        : <><Check className="w-4 h-4" /> Approve</>
                      }
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReviewRequest(req.id, "rejected")}
                      disabled={reviewingId === req.id}
                      className="text-destructive border-destructive hover:bg-destructive/10"
                    >
                      <X className="w-4 h-4" /> Reject
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
                  placeholder="Search clubs by name or description..."
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
                <Filter className="w-4 h-4" /> Filters
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
                  {cat}
                </button>
              ))}
            </div>

            {/* Extended filters */}
            {showFilters && (
              <Card className="p-4">
                <div className="flex flex-wrap gap-6">
                  {user?.role !== "admin" && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">My Status</p>
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
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Membership Type</p>
                    <div className="flex gap-2">
                      {[["all", "All Types"], ["open", "Open"], ["closed", "Approval Required"]].map(([val, label]) => (
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
                      Clear all
                    </button>
                  </div>
                </div>
              </Card>
            )}

            <p className="text-sm text-muted-foreground">
              {filtered.length} club{filtered.length !== 1 ? "s" : ""} found — page {currentPage} of {totalPages}
            </p>
          </div>

          {/* Club cards */}
          {filtered.length === 0 ? (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">No clubs found matching your filters.</p>
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
                          <img src={club.cover_url} alt={club.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                            <span className="text-white text-5xl font-bold opacity-25">{club.name[0]}</span>
                          </div>
                        )}
                        {/* Category badge */}
                        <div className="absolute top-3 left-3">
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: accentColor }}>
                            {club.category}
                          </span>
                        </div>
                        {/* Membership badge — only for non-admins */}
                        {!isAdmin && mem && (
                          <div className="absolute top-3 right-3">
                            {mem.status === "approved" ? (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500 text-white">
                                <CheckCircle className="w-3 h-3" /> Joined
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500 text-white">
                                <Clock className="w-3 h-3" /> Pending
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
                            {club.is_open ? "Open" : "Approval"}
                          </Tag>
                        </div>

                        <p className="text-muted-foreground text-sm mb-3 line-clamp-2 flex-1">
                          {club.description}
                        </p>

                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
                          <Users className="w-3.5 h-3.5" />
                          <span>{club.member_count ?? 0} members</span>
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
                            <Button variant="outline" className="w-full h-10 text-sm">View Club</Button>
                          </Link>
                          {isAdmin && (
                            <>
                              <Link to={`/clubs/${club.id}#manage`} className="flex-1">
                                <Button className="w-full h-10 text-sm">Manage</Button>
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
                              <Button className="w-full text-sm">Manage</Button>
                            </Link>
                          )}
                          {/* Club president/admin member — also show manage */}
                          {!isAdmin && !isClubAdmin && mem?.role === "president" || !isAdmin && !isClubAdmin && mem?.role === "admin" ? (
                            <Link to={`/clubs/${club.id}#manage`} className="flex-1">
                              <Button className="w-full text-sm">Manage</Button>
                            </Link>
                          ) : null}

                          {/* Regular student */}
                          {!isAdmin && !isClubAdmin && (
                            mem?.status === "approved" ? (
                              <Button variant="outline" className="flex-1 text-sm" disabled style={{ color: "#16a34a", borderColor: "#bbf7d0" }}>
                                Joined ✓
                              </Button>
                            ) : mem?.status === "pending" ? (
                              <Button variant="outline" className="flex-1 text-sm" disabled>
                                Pending
                              </Button>
                            ) : (
                              <Button
                                className="flex-1 text-sm"
                                onClick={() => handleJoin(club)}
                                disabled={joiningId === club.id}
                              >
                                {joiningId === club.id
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : club.is_open ? "Join" : "Apply"
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
                  Showing <span className="font-semibold text-foreground">{(currentPage - 1) * CLUBS_PER_PAGE + 1}</span>
                  –<span className="font-semibold text-foreground">{Math.min(currentPage * CLUBS_PER_PAGE, filtered.length)}</span>
                  {" "}of <span className="font-semibold text-foreground">{filtered.length}</span>
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 rounded-lg text-sm font-medium border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Prev
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
                    Next →
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Page <span className="font-semibold text-foreground">{currentPage}</span> of{" "}
                  <span className="font-semibold text-foreground">{totalPages}</span>
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Admin: Create Club Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Create a New Club</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Club Name</label>
                <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="Club name" className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="What is this club about?" rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Category</label>
                <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                  {CATEGORIES.filter((c) => c !== "All").map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_open_create" checked={createForm.is_open}
                  onChange={(e) => setCreateForm({ ...createForm, is_open: e.target.checked })} className="w-4 h-4" />
                <label htmlFor="is_open_create" className="text-sm">Open membership (anyone can join instantly)</label>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={handleCreate} disabled={isSubmitting || !createForm.name || !createForm.description}>
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Club"}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Student: Request Club Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold">Request a New Club</h2>
              <button onClick={() => setShowRequestModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Your request will be reviewed by the admin. You'll be notified of the outcome.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Club Name</label>
                <input value={requestForm.club_name} onChange={(e) => setRequestForm({ ...requestForm, club_name: e.target.value })}
                  placeholder="Proposed club name" className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Category</label>
                <select value={requestForm.category} onChange={(e) => setRequestForm({ ...requestForm, category: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                  {CATEGORIES.filter((c) => c !== "All").map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea value={requestForm.description} onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })}
                  placeholder="Why should this club be created? What will it do?" rows={4}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={handleRequest} disabled={isRequesting || !requestForm.club_name || !requestForm.description}>
                {isRequesting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit Request"}
              </Button>
              <Button variant="outline" onClick={() => setShowRequestModal(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}