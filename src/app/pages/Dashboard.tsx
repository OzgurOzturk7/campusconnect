import { useState, useEffect, type ElementType } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Tag } from "../components/Tag";
import { Calendar, MapPin, Users, Bell, Clock, CalendarPlus, Briefcase, Building2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Skeleton, SkeletonGrid } from "../components/Skeleton";

interface Event {
  id: string;
  title: string;
  description: string;
  event_date: string;
  location: string;
  is_school_wide: boolean;
  club_id?: string;
  cover_url?: string;
  attendee_count?: number;
}

interface Project {
  id: string;
  title: string;
  description: string;
  tech_stack: string[];
  roles_needed: string[];
  status: string;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

interface Stats {
  clubsJoined: number;
  eventsRsvpd: number;
}

interface AdminStats {
  users: number;
  clubs: number;
  events: number;
  projects: number;
  pending_requests: number;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildGoogleCalendarUrl(event: Event): string {
  const startDate = new Date(event.event_date);
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  const formatDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${formatDate(startDate)}/${formatDate(endDate)}`,
    details: event.description || "",
    location: event.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function AdminStatCard({
  label,
  value,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: number;
  icon: ElementType;
  highlight?: boolean;
}) {
  return (
    <Card className={`p-4 ${highlight ? "border-primary/40" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-0.5">{value}</p>
        </div>
        <Icon className={`w-7 h-7 flex-shrink-0 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [stats, setStats] = useState<Stats>({ clubsJoined: 0, eventsRsvpd: 0 });
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    try {
      setIsLoading(true);
      const [eventsData, projectsData, notificationsData, myClubs] = await Promise.all([
        apiFetch("/api/events/"),
        apiFetch("/api/projects/"),
        apiFetch("/api/notifications/"),
        apiFetch("/api/clubs/"),
      ]);

      const now = new Date();
      const upcoming = eventsData
        .filter((e: Event) => new Date(e.event_date) > now)
        .sort((a: Event, b: Event) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
        .slice(0, 6);
      setEvents(upcoming);

      const openProjects = projectsData
        .filter((p: Project) => p.status === "open")
        .slice(0, 3);
      setProjects(openProjects);

      setNotifications(notificationsData.slice(0, 4));

      setStats({
        clubsJoined: myClubs.length,
        eventsRsvpd: eventsData.length,
      });

      if (user?.role === "admin") {
        try {
          const adminData = await apiFetch("/api/admin/stats");
          setAdminStats(adminData);
        } catch {
          // silent — admin overview is non-critical
        }
      }
    } catch (err) {
      console.error("Failed to load dashboard", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleNotifClick(notif: Notification) {
    if (!notif.is_read) {
      apiFetch(`/api/notifications/${notif.id}/read`, { method: "PATCH" }).then(() => {
        window.dispatchEvent(new Event("notifications-updated"));
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
    }
    if (notif.link) {
      navigate(notif.link);
    }
  }

  function handleAddToCalendar(event: Event) {
    window.open(buildGoogleCalendarUrl(event), "_blank", "noopener,noreferrer");
  }

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-32 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <SkeletonGrid count={4} columns={2} />
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div className="border-b border-border pb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm md:text-base">
          Here's what's happening in your campus community today.
        </p>
      </div>

      {/* Admin-only platform overview */}
      {user?.role === "admin" && adminStats && (
        <div>
          <h2 className="text-lg font-bold mb-3">Platform Overview</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <AdminStatCard label="Users" value={adminStats.users} icon={Users} />
            <AdminStatCard label="Clubs" value={adminStats.clubs} icon={Building2} />
            <AdminStatCard label="Events" value={adminStats.events} icon={Calendar} />
            <AdminStatCard label="Projects" value={adminStats.projects} icon={Briefcase} />
            <Link to="/clubs?tab=requests" className="block">
              <AdminStatCard
                label="Pending"
                value={adminStats.pending_requests}
                icon={Clock}
                highlight={adminStats.pending_requests > 0}
              />
            </Link>
          </div>
        </div>
      )}

      {/* Stats — two-up always so the second card is visible above the fold
          on phones too, just narrower. */}
      <div className="grid grid-cols-2 gap-3 md:gap-6">
        <Card className="p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Clubs</p>
              <p className="text-2xl font-bold mt-1">{stats.clubsJoined}</p>
            </div>
            <Users className="w-10 h-10 text-primary" />
          </div>
        </Card>
        <Card className="p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Events</p>
              <p className="text-2xl font-bold mt-1">{stats.eventsRsvpd}</p>
            </div>
            <Calendar className="w-8 h-8 md:w-10 md:h-10 text-secondary flex-shrink-0" />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        {/* Left — Upcoming Events */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl md:text-2xl font-bold">Upcoming Events</h2>
            <Link to="/events">
              <Button variant="ghost" size="sm">View all</Button>
            </Link>
          </div>
          {events.length === 0 ? (
            <Card className="p-8 text-center">
              <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-muted-foreground">No upcoming events.</p>
              <Link to="/events">
                <Button className="mt-4">Browse Events</Button>
              </Link>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {events.map((event) => {
                const eventDate = new Date(event.event_date);
                return (
                  <Card key={event.id} className="overflow-hidden hover:shadow-lg transition-shadow flex flex-col">
                    <div className="relative h-40 flex-shrink-0">
                      {event.cover_url ? (
                        <img src={event.cover_url} alt={event.title} loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${
                          event.is_school_wide ? "bg-primary/10"
                          : event.club_id ? "bg-secondary/10"
                          : "bg-muted"
                        }`}>
                          <Calendar className="w-12 h-12 text-muted-foreground opacity-50" />
                        </div>
                      )}
                      <div className="absolute top-3 left-3 bg-card rounded-xl overflow-hidden shadow-md text-center w-12">
                        <div className="bg-primary text-primary-foreground text-xs font-bold py-0.5">
                          {eventDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
                        </div>
                        <div className="text-foreground text-lg font-bold leading-tight py-0.5">{eventDate.getDate()}</div>
                      </div>
                    </div>

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
                        {(event.attendee_count ?? 0) > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{event.attendee_count} attending</span>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleAddToCalendar(event)}
                        className="mt-3 w-full py-2 rounded-lg text-sm font-medium border border-border bg-card hover:bg-muted transition-colors flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                      >
                        <CalendarPlus className="w-4 h-4" />
                        Add to Calendar
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {events.length >= 6 && (
            <div className="flex justify-center mt-4">
              <Link to="/events">
                <Button variant="outline">View more events</Button>
              </Link>
            </div>
          )}
        </div>

        {/* Right — Open Projects + Notifications */}
        <div className="space-y-8">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl md:text-2xl font-bold">Open Projects</h2>
              <Link to="/projects">
                <Button variant="ghost" size="sm">View all</Button>
              </Link>
            </div>
            {projects.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-muted-foreground text-sm">No open projects yet.</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <Card key={project.id} className="p-4 hover:shadow-md transition-shadow">
                    <h3 className="font-semibold text-sm mb-1 line-clamp-1">{project.title}</h3>
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{project.description}</p>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {project.tech_stack.slice(0, 3).map((tech) => (
                        <Tag key={tech} variant="primary" className="text-xs">{tech}</Tag>
                      ))}
                      {project.tech_stack.length > 3 && (
                        <span className="text-xs text-muted-foreground">+{project.tech_stack.length - 3}</span>
                      )}
                    </div>
                    <Link to="/projects">
                      <Button variant="outline" className="w-full text-xs py-1.5">View Project</Button>
                    </Link>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <Bell className="w-5 h-5 text-primary" />
              <h2 className="text-xl md:text-2xl font-bold">Notifications</h2>
              {unreadCount > 0 && (
                <span className="w-6 h-6 bg-primary text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {unreadCount}
                </span>
              )}
            </div>
            {notifications.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-muted-foreground text-sm">No notifications yet.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {notifications.map((notification) => (
                  <Card
                    key={notification.id}
                    className={`p-4 cursor-pointer hover:shadow-md transition-all ${
                      !notification.is_read ? "bg-accent border-primary/20" : ""
                    }`}
                    onClick={() => handleNotifClick(notification)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative">
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                          <Bell className="w-4 h-4 text-primary" />
                        </div>
                        {!notification.is_read && (
                          <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full border-2 border-card" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{notification.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{notification.body}</p>
                        <p className="text-xs text-muted-foreground mt-1">{timeAgo(notification.created_at)}</p>
                      </div>
                    </div>
                  </Card>
                ))}
                <Link to="/notifications">
                  <Button variant="outline" className="w-full mt-2">View all notifications</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}