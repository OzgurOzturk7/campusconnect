import { useState, useEffect, useRef } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Tag } from "../components/Tag";
import { Avatar } from "../components/Avatar";
import {
  Users, ArrowLeft, Loader2, UserPlus, UserMinus,
  Check, X, Settings, Video, Upload, Trash2, Shield,
  Megaphone, Plus, MapPin, Clock, Image, Calendar,
  Lock, Globe
} from "lucide-react";
import { Link, useParams, useLocation } from "react-router";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { getStoredToken } from "../context/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface Club {
  id: string;
  name: string;
  description: string;
  category: string;
  admin_user_id: string;
  is_open: boolean;
  video_url?: string;
  cover_url?: string;
  member_count?: number;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  status: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  department?: string;
}

interface ClubEvent {
  id: string;
  title: string;
  description: string;
  event_date: string;
  location: string;
  capacity?: number;
  club_id: string;
  is_members_only: boolean;
  cover_url?: string;
  created_by: string;
  attendee_count?: number;
}

interface Announcement {
  id: string;
  title: string;
  content: string;
  created_at: string;
  author_id: string;
}

const CATEGORIES = ["Technical", "Social", "Sports", "Arts", "Research", "Business"];

export function ClubDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"overview" | "announcements" | "manage">(
    location.hash === "#manage" ? "manage" : "overview"
  );

  // React to hash changes (e.g. user clicks Manage on the Clubs list)
  useEffect(() => {
    if (location.hash === "#manage") setActiveTab("manage");
  }, [location.hash]);
  const [club, setClub] = useState<Club | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [clubEvents, setClubEvents] = useState<ClubEvent[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isSavingClub, setIsSavingClub] = useState(false);
  const [isPostingAnnouncement, setIsPostingAnnouncement] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const eventCoverInputRef = useRef<HTMLInputElement>(null);

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState<{
    title: string; message: string; onConfirm: () => void; danger?: boolean;
  } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  const [editForm, setEditForm] = useState({ name: "", description: "", category: "", is_open: true });
  const [announcementForm, setAnnouncementForm] = useState({ title: "", content: "" });
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);

  // Club event form
  const [showEventForm, setShowEventForm] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    event_date: "",
    location: "",
    capacity: "",
    is_members_only: false,
  });
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [eventCoverFile, setEventCoverFile] = useState<File | null>(null);
  const [eventCoverPreview, setEventCoverPreview] = useState<string | null>(null);

  useEffect(() => {
    if (id) fetchData();
  }, [id]);

  async function fetchData() {
    try {
      setIsLoading(true);
      const [clubData, membersData, eventsData, announcementsData] = await Promise.all([
        apiFetch(`/api/clubs/${id}`),
        apiFetch(`/api/clubs/${id}/members`),
        apiFetch(`/api/events/`),
        apiFetch(`/api/clubs/${id}/announcements`),
      ]);
      setClub(clubData);
      setMembers(membersData);
      setClubEvents(eventsData.filter((e: ClubEvent) => e.club_id === id));
      setAnnouncements(announcementsData);
      setEditForm({
        name: clubData.name,
        description: clubData.description,
        category: clubData.category,
        is_open: clubData.is_open,
      });
    } catch {
      console.error("Failed to load club");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleJoin() {
    try {
      setIsJoining(true);
      await apiFetch(`/api/clubs/${id}/join`, { method: "POST" });
      fetchData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to join", false);
    } finally {
      setIsJoining(false);
    }
  }

  async function handleLeave() {
    setConfirmModal({
      title: "Leave Club",
      message: `Are you sure you want to leave "${club?.name}"?`,
      danger: true,
      onConfirm: async () => {
        try {
          setIsJoining(true);
          await apiFetch(`/api/clubs/${id}/leave`, { method: "DELETE" });
          fetchData();
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Failed to leave", false);
        } finally {
          setIsJoining(false);
        }
      },
    });
  }

  async function handleMembershipUpdate(userId: string, memberStatus: "approved" | "rejected") {
    try {
      setUpdatingMemberId(userId);
      await apiFetch(`/api/clubs/${id}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: memberStatus }),
      });
      fetchData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update", false);
    } finally {
      setUpdatingMemberId(null);
    }
  }

  async function handleRemoveMember(userId: string, memberName: string) {
    setConfirmModal({
      title: "Remove Member",
      message: `Remove "${memberName}" from this club?`,
      danger: true,
      onConfirm: async () => {
        try {
          setUpdatingMemberId(userId);
          await apiFetch(`/api/clubs/${id}/members/${userId}/remove`, { method: "DELETE" });
          fetchData();
          showToast("Member removed.");
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Failed to remove", false);
        } finally {
          setUpdatingMemberId(null);
        }
      },
    });
  }

  async function handleRoleUpdate(userId: string, role: string) {
    try {
      setUpdatingMemberId(userId);
      await apiFetch(`/api/clubs/${id}/members/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      fetchData();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update role", false);
    } finally {
      setUpdatingMemberId(null);
    }
  }

  async function handleSaveClub() {
    try {
      setIsSavingClub(true);
      await apiFetch(`/api/clubs/${id}`, { method: "PUT", body: JSON.stringify(editForm) });
      fetchData();
      showToast("Club updated!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update club", false);
    } finally {
      setIsSavingClub(false);
    }
  }

  async function handlePostAnnouncement() {
    try {
      setIsPostingAnnouncement(true);
      await apiFetch(`/api/clubs/${id}/announcements`, {
        method: "POST",
        body: JSON.stringify(announcementForm),
      });
      setAnnouncementForm({ title: "", content: "" });
      setShowAnnouncementForm(false);
      fetchData();
      showToast("Announcement posted!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to post", false);
    } finally {
      setIsPostingAnnouncement(false);
    }
  }

  async function handleDeleteAnnouncement(annId: string) {
    setConfirmModal({
      title: "Delete Announcement",
      message: "Are you sure you want to delete this announcement?",
      danger: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/clubs/${id}/announcements/${annId}`, { method: "DELETE" });
          fetchData();
          showToast("Announcement deleted.");
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Failed to delete", false);
        }
      },
    });
  }

  // Club event creation
  function handleEventCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEventCoverFile(file);
    setEventCoverPreview(URL.createObjectURL(file));
  }

  async function handleCreateEvent() {
    if (!eventForm.title || !eventForm.event_date || !eventForm.location) return;
    try {
      setIsCreatingEvent(true);
      const result = await apiFetch("/api/events/", {
        method: "POST",
        body: JSON.stringify({
          title: eventForm.title,
          description: eventForm.description,
          event_date: new Date(eventForm.event_date).toISOString(),
          location: eventForm.location,
          capacity: eventForm.capacity ? parseInt(eventForm.capacity) : null,
          club_id: id,
          is_school_wide: false,
          is_members_only: eventForm.is_members_only,
        }),
      });

      // Upload cover if selected
      if (eventCoverFile && result?.id) {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append("file", eventCoverFile);
        await fetch(`${API_BASE}/api/events/${result.id}/upload-cover`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      }

      setEventForm({ title: "", description: "", event_date: "", location: "", capacity: "", is_members_only: false });
      setEventCoverFile(null);
      setEventCoverPreview(null);
      setShowEventForm(false);
      fetchData();
      showToast("Event created!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to create event", false);
    } finally {
      setIsCreatingEvent(false);
    }
  }

  async function handleDeleteEvent(eventId: string, eventTitle: string) {
    setConfirmModal({
      title: "Delete Event",
      message: `Delete "${eventTitle}"? This cannot be undone.`,
      danger: true,
      onConfirm: async () => {
        try {
          setIsDeletingEvent(eventId);
          await apiFetch(`/api/events/${eventId}`, { method: "DELETE" });
          fetchData();
          showToast("Event deleted.");
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Failed to delete event", false);
        } finally {
          setIsDeletingEvent(null);
        }
      },
    });
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingCover(true);
      const formData = new FormData();
      formData.append("file", file);
      const token = getStoredToken();
      const response = await fetch(`${API_BASE}/api/clubs/${id}/upload-cover`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      fetchData();
      showToast("Cover updated!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to upload", false);
    } finally {
      setIsUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleVideoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { showToast("Video must be under 100MB", false); return; }
    try {
      setIsUploadingVideo(true);
      const formData = new FormData();
      formData.append("file", file);
      const token = getStoredToken();
      const response = await fetch(`${API_BASE}/api/clubs/${id}/upload-video`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      fetchData();
      showToast("Video uploaded!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to upload", false);
    } finally {
      setIsUploadingVideo(false);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  async function handleDeleteVideo() {
    setConfirmModal({
      title: "Delete Video",
      message: "Delete the introduction video?",
      danger: true,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/clubs/${id}/delete-video`, { method: "DELETE" });
          fetchData();
          showToast("Video deleted.");
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : "Failed to delete", false);
        }
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!club) {
    return <div className="text-center py-12 text-muted-foreground">Club not found.</div>;
  }

  const approvedMembers = members.filter((m) => m.status === "approved");
  const pendingMembers = members.filter((m) => m.status === "pending");
  const myMembership = members.find((m) => m.user_id === user?.user_id);
  const isClubManager =
    user?.role === "admin" ||
    club.admin_user_id === user?.user_id ||
    myMembership?.role === "president";
  const isApprovedMember = members.some((m) => m.user_id === user?.user_id && m.status === "approved");
  const isPending = members.some((m) => m.user_id === user?.user_id && m.status === "pending");
  const upcomingEvents = clubEvents.filter((e) => new Date(e.event_date) >= new Date());
  const pastEvents = clubEvents.filter((e) => new Date(e.event_date) < new Date());

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

      {/* Custom confirm modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border p-5 md:p-6 w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-base mb-2">{confirmModal.title}</h3>
            <p className="text-sm text-muted-foreground mb-6">{confirmModal.message}</p>
            <div className="flex gap-3">
              <Button
                className="flex-1"
                style={confirmModal.danger ? { background: "#ef4444" } : {}}
                onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
              >
                Confirm
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setConfirmModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <Link to="/clubs">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="w-4 h-4" /> Back to Clubs
        </Button>
      </Link>

      {/* Club Hero */}
      <Card className="overflow-hidden">
        <div className="relative h-48 bg-gradient-to-br from-primary to-secondary">
          {club.cover_url ? (
            <img src={club.cover_url} alt={club.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-white text-7xl font-bold opacity-20">{club.name[0]}</span>
            </div>
          )}
          {isClubManager && (
            <button
              onClick={() => coverInputRef.current?.click()}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs bg-black/50 hover:bg-black/70 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {isUploadingCover ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Image className="w-3.5 h-3.5" />}
              {isUploadingCover ? "Uploading..." : "Change Cover"}
            </button>
          )}
          <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
        </div>

        <div className="p-5 md:p-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold mb-2 break-words">{club.name}</h1>
              <div className="flex gap-2 flex-wrap mb-3">
                <Tag variant="muted">{club.category}</Tag>
                <Tag variant={club.is_open ? "primary" : "secondary"}>
                  {club.is_open ? "Open Membership" : "Approval Required"}
                </Tag>
                {isClubManager && pendingMembers.length > 0 && (
                  <Tag variant="secondary">{pendingMembers.length} pending</Tag>
                )}
              </div>
              <p className="text-muted-foreground mb-3">{club.description}</p>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="w-4 h-4" />
                <span className="text-sm font-medium">{approvedMembers.length} members</span>
              </div>
            </div>
            <div className="flex gap-2 md:ml-4 flex-shrink-0">
              {!isClubManager && (
                isApprovedMember ? (
                  <Button variant="outline" onClick={handleLeave} disabled={isJoining}>
                    {isJoining ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserMinus className="w-4 h-4" /> Leave</>}
                  </Button>
                ) : isPending ? (
                  <Tag variant="muted" className="self-center">Pending approval</Tag>
                ) : (
                  <Button onClick={handleJoin} disabled={isJoining}>
                    {isJoining ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserPlus className="w-4 h-4" /> Join</>}
                  </Button>
                )
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs — horizontal scroll on small screens so long labels
          ("Events & Announcements (12)") don't push the page width. */}
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {[
          { key: "overview", label: "Overview" },
          { key: "announcements", label: `Events & Announcements${clubEvents.length + announcements.length > 0 ? ` (${clubEvents.length + announcements.length})` : ""}` },
          ...(isClubManager ? [{ key: "manage", label: "Manage" }] : []),
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.key === "manage" && pendingMembers.length > 0 && (
              <span className="ml-1.5 w-4 h-4 bg-primary text-white text-xs rounded-full inline-flex items-center justify-center">
                {pendingMembers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {club.video_url && (
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Video className="w-5 h-5 text-primary" />
                  <h2 className="text-xl font-bold">Club Introduction</h2>
                </div>
                <video src={club.video_url} controls className="w-full rounded-lg max-h-72 bg-black" />
              </Card>
            )}
          </div>
          <div>
            <Card className="p-6">
              <h3 className="font-bold mb-4">Members ({approvedMembers.length})</h3>
              <div className="space-y-3">
                {approvedMembers.slice(0, 10).map((member) => (
                  <div key={member.id} className="flex items-center gap-3">
                    <Avatar name={member.name || "?"} size="sm" src={member.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{member.name || "Student"}</p>
                      <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
                    </div>
                  </div>
                ))}
                {approvedMembers.length > 10 && (
                  <p className="text-xs text-muted-foreground text-center">+{approvedMembers.length - 10} more</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* EVENTS & ANNOUNCEMENTS TAB */}
      {activeTab === "announcements" && (
        <div className="space-y-6">

          {/* Admin actions */}
          {isClubManager && (
            <div className="flex gap-3 flex-wrap">
              <Button onClick={() => setShowEventForm(!showEventForm)}>
                <Plus className="w-4 h-4" /> Add Event
              </Button>
              <Button variant="outline" onClick={() => setShowAnnouncementForm(!showAnnouncementForm)}>
                <Megaphone className="w-4 h-4" /> Post Announcement
              </Button>
            </div>
          )}

          {/* New event form */}
          {showEventForm && isClubManager && (
            <Card className="p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" /> New Club Event
              </h3>

              {/* Cover image picker */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1.5">Event Poster / Cover (optional)</label>
                {eventCoverPreview ? (
                  <div className="relative rounded-xl overflow-hidden h-40 mb-2">
                    <img src={eventCoverPreview} alt="cover preview" className="w-full h-full object-cover" />
                    <button
                      onClick={() => { setEventCoverFile(null); setEventCoverPreview(null); }}
                      className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => eventCoverInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-xl h-28 flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors"
                  >
                    <Image className="w-6 h-6 text-muted-foreground mb-1" />
                    <p className="text-sm text-muted-foreground">Click to upload poster</p>
                  </div>
                )}
                <input ref={eventCoverInputRef} type="file" accept="image/*" onChange={handleEventCoverChange} className="hidden" />
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Title</label>
                  <input value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                    placeholder="Event title" className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Description</label>
                  <textarea value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                    placeholder="Event details..." rows={3}
                    className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Date & Time</label>
                    <input type="datetime-local" value={eventForm.event_date} onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Location</label>
                    <input value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                      placeholder="Place or Online" className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Capacity (optional)</label>
                  <input type="number" value={eventForm.capacity} onChange={(e) => setEventForm({ ...eventForm, capacity: e.target.value })}
                    placeholder="Max attendees" className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Visibility</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setEventForm({ ...eventForm, is_members_only: false })}
                      className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                        !eventForm.is_members_only ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      <Globe className="w-4 h-4" /> Everyone
                    </button>
                    <button
                      onClick={() => setEventForm({ ...eventForm, is_members_only: true })}
                      className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                        eventForm.is_members_only ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      <Lock className="w-4 h-4" /> Members Only
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <Button onClick={handleCreateEvent} disabled={isCreatingEvent || !eventForm.title || !eventForm.event_date || !eventForm.location}>
                  {isCreatingEvent ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Event"}
                </Button>
                <Button variant="outline" onClick={() => { setShowEventForm(false); setEventCoverFile(null); setEventCoverPreview(null); }}>Cancel</Button>
              </div>
            </Card>
          )}

          {/* New announcement form */}
          {showAnnouncementForm && isClubManager && (
            <Card className="p-6">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-primary" /> New Announcement
              </h3>
              <div className="space-y-3">
                <input value={announcementForm.title} onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                  placeholder="Announcement title" className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                <textarea value={announcementForm.content} onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })}
                  placeholder="Write your announcement..." rows={4}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div className="flex gap-3 mt-4">
                <Button onClick={handlePostAnnouncement} disabled={isPostingAnnouncement || !announcementForm.title || !announcementForm.content}>
                  {isPostingAnnouncement ? <Loader2 className="w-4 h-4 animate-spin" /> : "Post"}
                </Button>
                <Button variant="outline" onClick={() => setShowAnnouncementForm(false)}>Cancel</Button>
              </div>
            </Card>
          )}

          {/* Club Events */}
          {clubEvents.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">Club Events</h2>
              <div className="space-y-4">
                {[...upcomingEvents, ...pastEvents].map((event) => {
                  const isPast = new Date(event.event_date) < new Date();
                  return (
                    <Card key={event.id} className={`overflow-hidden ${isPast ? "opacity-70" : ""}`}>
                      {event.cover_url && (
                        <img src={event.cover_url} alt={event.title} className="w-full h-40 object-cover" />
                      )}
                      <div className="p-5">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h3 className="font-bold text-base">{event.title}</h3>
                              {event.is_members_only ? (
                                <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                                  <Lock className="w-3 h-3" /> Members Only
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                  <Globe className="w-3 h-3" /> Public
                                </span>
                              )}
                              {isPast && <Tag variant="muted" className="text-xs">Past</Tag>}
                            </div>
                            {event.description && (
                              <p className="text-sm text-muted-foreground mb-3">{event.description}</p>
                            )}
                          </div>
                          {isClubManager && (
                            <button
                              onClick={() => handleDeleteEvent(event.id, event.title)}
                              disabled={isDeletingEvent === event.id}
                              className="ml-3 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                            >
                              {isDeletingEvent === event.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Trash2 className="w-4 h-4" />
                              }
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4" />
                            {new Date(event.event_date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4" />
                            {new Date(event.event_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4" /> {event.location}
                          </span>
                          {event.capacity && (
                            <span className="flex items-center gap-1.5">
                              <Users className="w-4 h-4" />
                              {event.attendee_count ?? 0} / {event.capacity}
                            </span>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Announcements */}
          {announcements.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">Announcements</h2>
              <div className="space-y-4">
                {announcements.map((ann) => (
                  <Card key={ann.id} className="p-6">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-bold text-base">{ann.title}</h3>
                      {isClubManager && (
                        <button onClick={() => handleDeleteAnnouncement(ann.id)} className="text-muted-foreground hover:text-destructive ml-4">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm leading-relaxed">{ann.content}</p>
                    <p className="text-xs text-muted-foreground mt-3">
                      {new Date(ann.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {clubEvents.length === 0 && announcements.length === 0 && (
            <Card className="p-12 text-center">
              <Megaphone className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-muted-foreground">No events or announcements yet.</p>
            </Card>
          )}
        </div>
      )}

      {/* MANAGE TAB */}
      {activeTab === "manage" && isClubManager && (
        <div className="space-y-6">

          {/* Edit club */}
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Settings className="w-5 h-5" /> Club Settings
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Club Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3} className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Category</label>
                <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="is_open_edit" checked={editForm.is_open}
                  onChange={(e) => setEditForm({ ...editForm, is_open: e.target.checked })} className="w-4 h-4" />
                <label htmlFor="is_open_edit" className="text-sm">Open membership</label>
              </div>
              <Button onClick={handleSaveClub} disabled={isSavingClub}>
                {isSavingClub ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
              </Button>
            </div>
          </Card>

          {/* Video */}
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Video className="w-5 h-5" /> Introduction Video
            </h2>
            {club.video_url ? (
              <div className="space-y-4">
                <video src={club.video_url} controls className="w-full rounded-lg max-h-64 bg-black" />
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => videoInputRef.current?.click()} disabled={isUploadingVideo}>
                    {isUploadingVideo ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Upload className="w-4 h-4" /> Replace</>}
                  </Button>
                  <Button variant="outline" onClick={handleDeleteVideo} className="text-destructive border-destructive">
                    <Trash2 className="w-4 h-4" /> Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => videoInputRef.current?.click()}>
                {isUploadingVideo ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Uploading...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Video className="w-8 h-8 text-muted-foreground" />
                    <p className="font-medium text-sm">Upload intro video</p>
                    <p className="text-xs text-muted-foreground">MP4, WebM — max 100MB</p>
                  </div>
                )}
              </div>
            )}
            <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/ogg" onChange={handleVideoUpload} className="hidden" />
          </Card>

          {/* Pending */}
          {pendingMembers.length > 0 && (
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-4">Pending Requests ({pendingMembers.length})</h2>
              <div className="space-y-3">
                {pendingMembers.map((member) => (
                  <div key={member.id} className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                    <Avatar name={member.name || "?"} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{member.name || "Student"}</p>
                      <p className="text-xs text-muted-foreground">{member.email || ""}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleMembershipUpdate(member.user_id, "approved")}
                        disabled={updatingMemberId === member.user_id}>
                        <Check className="w-4 h-4" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleMembershipUpdate(member.user_id, "rejected")}
                        disabled={updatingMemberId === member.user_id}
                        className="text-destructive border-destructive">
                        <X className="w-4 h-4" /> Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Members — anchor for "Manage" button from Clubs list */}
          <Card id="manage" className="p-6 scroll-mt-24">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5" /> Members ({approvedMembers.length})
            </h2>
            <div className="space-y-3">
              {approvedMembers.map((member) => (
                <div key={member.id} className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                  <Avatar name={member.name || "?"} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{member.name || "Student"}</p>
                    <p className="text-xs text-muted-foreground capitalize">{member.role}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select value={member.role}
                      onChange={(e) => handleRoleUpdate(member.user_id, e.target.value)}
                      disabled={updatingMemberId === member.user_id || user?.role !== "admin"}
                      title={user?.role !== "admin" ? "Only platform admin can change roles" : undefined}
                      className="text-xs px-2 py-1 bg-card border border-border rounded-lg focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed">
                      <option value="member">Member</option>
                      <option value="president">President</option>
                    </select>
                    {(user?.role === "admin" || member.user_id !== club.admin_user_id) && (
                      <Button size="sm" variant="outline"
                        onClick={() => handleRemoveMember(member.user_id, member.name || "this member")}
                        disabled={updatingMemberId === member.user_id}
                        className="text-destructive border-destructive hover:bg-destructive/10">
                        {updatingMemberId === member.user_id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Trash2 className="w-3 h-3" />
                        }
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}