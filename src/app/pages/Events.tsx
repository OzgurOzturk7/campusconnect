import { useState, useEffect } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Avatar } from "../components/Avatar";
import {
  Calendar, MapPin, Users, Clock, Search,
  Plus, X, Loader2, ChevronLeft, ChevronRight,
  List, CalendarDays, Edit, Trash2, Check, Globe, Lock,
  CalendarPlus
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface Event {
  id: string;
  title: string;
  description: string;
  club_id?: string;
  created_by: string;
  event_date: string;
  location: string;
  capacity?: number | null;
  is_school_wide: boolean;
  is_members_only?: boolean;
  cover_url?: string;
  created_at: string;
  attendee_count?: number;
}

interface Club {
  id: string;
  name: string;
  admin_user_id: string;
}

const MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function Events() {
  const { user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [myAdminClubs, setMyAdminClubs] = useState<Club[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("upcoming");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "", description: "", event_date: "", location: "",
    is_school_wide: false, club_id: "",
  });

  // Edit modal
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "", description: "", event_date: "", location: "",
  });

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [attendingIds, setAttendingIds] = useState<Set<string>>(new Set());
  const [togglingAttendId, setTogglingAttendId] = useState<string | null>(null);

  // Attendee list panel — opened from the "Attendees (N)" button on each
  // event the current user organises. Holds the event id + title for the
  // modal header; the modal does its own data fetch by id.
  const [attendeesPanel, setAttendeesPanel] = useState<{ eventId: string; title: string } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  // Calendar
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());

  const isAdmin = user?.role === "admin";
  const canCreate = isAdmin || myAdminClubs.length > 0;

  useEffect(() => {
    fetchEvents();
    fetchMyAdminClubs();
    fetchAttending();
  }, []);

  async function fetchEvents() {
    try {
      setIsLoading(true);
      const data = await apiFetch("/api/events/");
      setEvents(data);
    } catch {
      console.error("Failed to load events");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchMyAdminClubs() {
    try {
      const data = await apiFetch("/api/clubs/");
      setMyAdminClubs(data.filter((c: Club) => c.admin_user_id === user?.user_id));
    } catch { /* ignore */ }
  }

  async function fetchAttending() {
    try {
      const data = await apiFetch("/api/events/my-attending");
      setAttendingIds(new Set(data.map((e: { event_id: string }) => e.event_id)));
    } catch { /* ignore */ }
  }

  function buildGoogleCalendarUrl(event: Event): string {
    const startDate = new Date(event.event_date);
    // Default duration: 1 hour
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

    // Google Calendar expects format YYYYMMDDTHHMMSSZ
    const formatDate = (d: Date) => {
      return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    };

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: event.title,
      dates: `${formatDate(startDate)}/${formatDate(endDate)}`,
      details: event.description || "",
      location: event.location || "",
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function handleAddToCalendar(event: Event) {
    const url = buildGoogleCalendarUrl(event);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleToggleAttend(eventId: string) {
    try {
      setTogglingAttendId(eventId);
      if (attendingIds.has(eventId)) {
        await apiFetch(`/api/events/${eventId}/attend`, { method: "DELETE" });
        setAttendingIds((prev) => { const s = new Set(prev); s.delete(eventId); return s; });
        setEvents((prev) => prev.map((e) =>
          e.id === eventId ? { ...e, attendee_count: Math.max(0, (e.attendee_count || 1) - 1) } : e
        ));
      } else {
        await apiFetch(`/api/events/${eventId}/attend`, { method: "POST" });
        setAttendingIds((prev) => new Set(prev).add(eventId));
        setEvents((prev) => prev.map((e) =>
          e.id === eventId ? { ...e, attendee_count: (e.attendee_count || 0) + 1 } : e
        ));
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update attendance", false);
    } finally {
      setTogglingAttendId(null);
    }
  }

  async function handleCreate() {
    try {
      setIsSubmitting(true);
      await apiFetch("/api/events/", {
        method: "POST",
        body: JSON.stringify({
          title: createForm.title,
          description: createForm.description,
          event_date: new Date(createForm.event_date).toISOString(),
          location: createForm.location,
          is_school_wide: createForm.is_school_wide,
          club_id: createForm.club_id || null,
        }),
      });
      setShowCreateModal(false);
      setCreateForm({ title: "", description: "", event_date: "", location: "", is_school_wide: false, club_id: "" });
      fetchEvents();
      showToast("Event created!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to create event", false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function openEdit(event: Event) {
    setEditingEvent(event);
    const d = new Date(event.event_date);
    // format for datetime-local input
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setEditForm({
      title: event.title,
      description: event.description,
      event_date: local,
      location: event.location,
    });
  }

  async function handleSaveEdit() {
    if (!editingEvent) return;
    try {
      setIsSavingEdit(true);
      await apiFetch(`/api/events/${editingEvent.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editForm.title,
          description: editForm.description,
          event_date: new Date(editForm.event_date).toISOString(),
          location: editForm.location,
        }),
      });
      setEditingEvent(null);
      fetchEvents();
      showToast("Event updated!");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to update", false);
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDelete(eventId: string) {
    try {
      setIsDeletingId(eventId);
      await apiFetch(`/api/events/${eventId}`, { method: "DELETE" });
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
      setDeleteConfirm(null);
      showToast("Event deleted.");
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "Failed to delete", false);
    } finally {
      setIsDeletingId(null);
    }
  }

  const now = new Date();
  const filtered = events.filter((e) => {
    const matchSearch = e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.location.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    const eDate = new Date(e.event_date);
    if (filter === "upcoming") return eDate >= now;
    if (filter === "past") return eDate < now;
    return true;
  });

  // Calendar helpers
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  function getEventsForDay(day: number) {
    return events.filter((e) => {
      const d = new Date(e.event_date);
      return d.getDate() === day && d.getMonth() === calMonth && d.getFullYear() === calYear;
    });
  }
  function prevMonth() { if (calMonth === 0) { setCalMonth(11); setCalYear(y=>y-1); } else setCalMonth(m=>m-1); }
  function nextMonth() { if (calMonth === 11) { setCalMonth(0); setCalYear(y=>y+1); } else setCalMonth(m=>m+1); }

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

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border p-5 md:p-6 w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-bold text-base">Delete Event</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Delete <span className="font-semibold text-foreground">"{deleteConfirm.title}"</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button className="flex-1" style={{ background: "#ef4444" }}
                onClick={() => handleDelete(deleteConfirm.id)}
                disabled={isDeletingId === deleteConfirm.id}>
                {isDeletingId === deleteConfirm.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-5 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold">Edit Event</h2>
              <button onClick={() => setEditingEvent(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Title</label>
                <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3} className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Date & Time</label>
                <input type="datetime-local" value={editForm.event_date} onChange={(e) => setEditForm({ ...editForm, event_date: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Location</label>
                <input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  placeholder="Physical location or Online"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={handleSaveEdit} disabled={isSavingEdit || !editForm.title || !editForm.event_date || !editForm.location}>
                {isSavingEdit ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save Changes"}
              </Button>
              <Button variant="outline" onClick={() => setEditingEvent(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">Campus Events</h1>
      </div>

      {/* Search + filters + view toggle */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input type="text" placeholder="Search events..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-card rounded-lg border border-border focus:border-primary focus:outline-none transition-colors" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["upcoming", "all", "past"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                filter === f ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground hover:bg-muted"
              }`}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
          <button onClick={() => setViewMode("list")}
            className={`p-2 rounded transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setViewMode("calendar")}
            className={`p-2 rounded transition-colors ${viewMode === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <CalendarDays className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Calendar View */}
      {viewMode === "calendar" && (
        <Card className="p-3 md:p-6">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-muted transition-colors"><ChevronLeft className="w-5 h-5" /></button>
            <h2 className="text-lg md:text-xl font-bold">{MONTHS[calMonth]} {calYear}</h2>
            <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-muted transition-colors"><ChevronRight className="w-5 h-5" /></button>
          </div>
          <div className="grid grid-cols-7 mb-2">
            {DAYS.map((d) => <div key={d} className="text-center text-[10px] md:text-xs font-semibold text-muted-foreground py-1.5 md:py-2">{d.slice(0, 2)}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5 md:gap-1">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} className="min-h-[56px] md:min-h-[80px]" />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayEvents = getEventsForDay(day);
              const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
              return (
                <div key={day} className={`min-h-[56px] md:min-h-[80px] p-0.5 md:p-1 rounded-lg border transition-colors ${isToday ? "border-primary bg-primary/5" : "border-transparent hover:border-border"}`}>
                  <div className={`text-xs md:text-sm font-medium mb-0.5 md:mb-1 w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{day}</div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 2).map((e) => (
                      <div key={e.id} className="text-[10px] md:text-xs px-1 md:px-1.5 py-0.5 rounded truncate font-medium bg-primary/15 text-primary" title={e.title}>{e.title}</div>
                    ))}
                    {dayEvents.length > 2 && <div className="text-[10px] md:text-xs text-muted-foreground px-0.5 md:px-1">+{dayEvents.length - 2}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* List View */}
      {viewMode === "list" && (
        filtered.length === 0 ? (
          <Card className="p-12 text-center"><p className="text-muted-foreground">No events found.</p></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map((event) => {
              const isPast = new Date(event.event_date) < now;
              const eventDate = new Date(event.event_date);
              const canEditThis = isAdmin || myAdminClubs.some((c) => c.id === event.club_id);
              const isAttending = attendingIds.has(event.id);

              return (
                <Card key={event.id} className={`overflow-hidden hover:shadow-lg transition-shadow flex flex-col ${isPast ? "opacity-70" : ""}`}>
                  {/* Cover */}
                  <div className="relative h-40 flex-shrink-0">
                    {event.cover_url ? (
                      <img src={event.cover_url} alt={event.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center ${
                        event.is_school_wide ? "bg-gradient-to-br from-primary to-blue-700"
                        : event.club_id ? "bg-gradient-to-br from-secondary to-teal-600"
                        : "bg-gradient-to-br from-slate-400 to-slate-600"
                      }`}>
                        <Calendar className="w-12 h-12 text-white opacity-30" />
                      </div>
                    )}
                    {/* Date badge */}
                    <div className="absolute top-3 left-3 bg-card rounded-xl overflow-hidden shadow-md text-center w-12">
                      <div className="bg-primary text-primary-foreground text-xs font-bold py-0.5">
                        {eventDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
                      </div>
                      <div className="text-foreground text-lg font-bold leading-tight py-0.5">{eventDate.getDate()}</div>
                    </div>
                    {/* Right badges */}
                    <div className="absolute top-3 right-3 flex flex-col gap-1 items-end">
                      {event.is_members_only && (
                        <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                          <Lock className="w-3 h-3" /> Members
                        </span>
                      )}
                      {isAttending && !isAdmin && (
                        <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500 text-white">
                          <Check className="w-3 h-3" /> Attending
                        </span>
                      )}
                      {(() => {
                        const cap = event.capacity ?? null;
                        const filled = cap !== null && cap > 0 && (event.attendee_count ?? 0) >= cap;
                        if (!filled || isPast) return null;
                        return (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500 text-white">
                            Full
                          </span>
                        );
                      })()}
                      {isPast && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-black/40 text-white">Past</span>}
                    </div>
                    {/* Admin edit/delete overlay */}
                    {canEditThis && !isPast && (
                      <div className="absolute bottom-3 right-3 flex gap-1.5">
                        <button onClick={() => openEdit(event)}
                          className="flex items-center gap-1 text-xs bg-card/90 hover:bg-card text-foreground px-2.5 py-1.5 rounded-lg shadow transition-colors font-medium">
                          <Edit className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button onClick={() => setDeleteConfirm({ id: event.id, title: event.title })}
                          className="flex items-center gap-1 text-xs bg-red-500 hover:bg-red-600 text-white px-2.5 py-1.5 rounded-lg shadow transition-colors font-medium">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    )}
                    {canEditThis && isPast && (
                      <div className="absolute bottom-3 right-3">
                        <button onClick={() => setDeleteConfirm({ id: event.id, title: event.title })}
                          className="flex items-center gap-1 text-xs bg-red-500 hover:bg-red-600 text-white px-2.5 py-1.5 rounded-lg shadow transition-colors font-medium">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-bold text-base mb-1 line-clamp-1">{event.title}</h3>
                    {event.description && (
                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{event.description}</p>
                    )}
                    <div className="space-y-1.5 text-xs text-muted-foreground flex-1">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{eventDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {eventDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{event.location}</span>
                      </div>
                      {((event.attendee_count ?? 0) > 0 || (event.capacity ?? 0) > 0) && (
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>
                            {event.attendee_count ?? 0}
                            {event.capacity ? ` / ${event.capacity}` : ""} attending
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Mark as Attending — students only, upcoming events only.
                        Capacity full → button is disabled but still shown so
                        the user understands why they can't RSVP. */}
                    {!isAdmin && !isPast && (() => {
                      const cap = event.capacity ?? null;
                      const isFull =
                        !isAttending &&
                        cap !== null &&
                        cap > 0 &&
                        (event.attendee_count ?? 0) >= cap;
                      return (
                        <button
                          onClick={() => handleToggleAttend(event.id)}
                          disabled={togglingAttendId === event.id || isFull}
                          className={`mt-3 w-full py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                            isAttending
                              ? "bg-green-50 text-green-700 border border-green-300 hover:bg-green-100"
                              : isFull
                              ? "bg-muted text-muted-foreground border border-border cursor-not-allowed"
                              : "bg-muted text-foreground border border-border hover:bg-muted/80"
                          }`}
                        >
                          {togglingAttendId === event.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : isAttending ? (
                            <><Check className="w-4 h-4" /> Attending</>
                          ) : isFull ? (
                            <>Event full</>
                          ) : (
                            <>+ Mark as Attending</>
                          )}
                        </button>
                      );
                    })()}

                    {/* Attendee list / export — visible only to the event
                        organisers (admin, creator, club president). */}
                    {canEditThis && (
                      <button
                        onClick={() => setAttendeesPanel({ eventId: event.id, title: event.title })}
                        className="mt-2 w-full py-2 rounded-lg text-sm font-medium border border-border bg-card hover:bg-muted transition-colors flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                      >
                        <Users className="w-3.5 h-3.5" /> Attendees ({event.attendee_count ?? 0})
                      </button>
                    )}

                    {/* Add to Google Calendar — anyone, upcoming events only */}
                    {!isPast && (
                      <button
                        onClick={() => handleAddToCalendar(event)}
                        className="mt-2 w-full py-2 rounded-lg text-sm font-medium border border-border bg-card hover:bg-muted transition-colors flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                      >
                        <CalendarPlus className="w-4 h-4" />
                        Add to Google Calendar
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* Create Event Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-5 md:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Create Event</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Title</label>
                <input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  placeholder="Event title" className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="Event description" rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Date & Time</label>
                <input type="datetime-local" value={createForm.event_date} onChange={(e) => setCreateForm({ ...createForm, event_date: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Location</label>
                <input value={createForm.location} onChange={(e) => setCreateForm({ ...createForm, location: e.target.value })}
                  placeholder="Physical location or Online"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>

              {/* Club selector for club admins */}
              {myAdminClubs.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">Link to Club (optional)</label>
                  <select value={createForm.club_id} onChange={(e) => setCreateForm({ ...createForm, club_id: e.target.value, is_school_wide: false })}
                    className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">None (general event)</option>
                    {myAdminClubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {/* School-wide toggle — admin only */}
              {isAdmin && !createForm.club_id && (
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="is_school_wide" checked={createForm.is_school_wide}
                    onChange={(e) => setCreateForm({ ...createForm, is_school_wide: e.target.checked })} className="w-4 h-4" />
                  <label htmlFor="is_school_wide" className="text-sm">
                    School-wide event <span className="text-muted-foreground">(notifies all students)</span>
                  </label>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <Button onClick={handleCreate} disabled={isSubmitting || !createForm.title || !createForm.event_date || !createForm.location}>
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : "Create Event"}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {attendeesPanel && (
        <AttendeesModal
          eventId={attendeesPanel.eventId}
          eventTitle={attendeesPanel.title}
          onClose={() => setAttendeesPanel(null)}
          onError={(msg) => showToast(msg, false)}
        />
      )}
    </div>
  );
}

// =============================================================================
// Attendees panel — fetched on open. Visible to admin / event creator /
// club president (server enforces). Includes a Download CSV button that
// hits the export endpoint with our auth header.
// =============================================================================
interface AttendeeRow {
  id: string;
  user_id: string;
  created_at: string;
  user?: {
    id: string;
    name: string;
    email: string;
    department?: string;
    year?: number;
    avatar_url?: string;
  } | null;
}

function AttendeesModal({
  eventId,
  eventTitle,
  onClose,
  onError,
}: {
  eventId: string;
  eventTitle: string;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [rows, setRows] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(`/api/events/${eventId}/attendees`);
        if (!cancelled) setRows(data || []);
      } catch (e: any) {
        if (!cancelled) onError(e?.message || "Couldn't load attendees");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function downloadCsv() {
    try {
      setExporting(true);
      // We bypass apiFetch because we need the raw Blob to trigger a
      // download. Same auth header pattern, no body parsing.
      const token =
        localStorage.getItem("campusconnect_token") ||
        sessionStorage.getItem("campusconnect_token") ||
        "";
      const apiBase =
        (import.meta as any).env?.VITE_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/events/${eventId}/attendees/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      // Browser-friendly filename hint, server sends Content-Disposition too.
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `${eventTitle}-attendees.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      onError(e?.message || "Couldn't export CSV");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-xl flex flex-col" style={{ maxHeight: "80vh" }}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold truncate">{eventTitle}</h3>
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading…" : `${rows.length} attending`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={downloadCsv}
              disabled={loading || exporting || rows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
              title={rows.length === 0 ? "No attendees yet" : "Download as CSV"}
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Download CSV"}
            </button>
            <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              Nobody has marked attendance yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => {
                const u = r.user;
                return (
                  <li key={r.id} className="px-5 py-3 flex items-start gap-3">
                    <Avatar
                      name={u?.name || "?"}
                      src={u?.avatar_url}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u?.name || "Unknown"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {u?.email}
                        {u?.department && ` · ${u.department}`}
                        {u?.year != null && ` · Year ${u.year}`}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground flex-shrink-0">
                      {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}