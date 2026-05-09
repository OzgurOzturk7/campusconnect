import { useState, useEffect } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Tag } from "../components/Tag";
import { Avatar } from "../components/Avatar";
import {
  Github, Linkedin, Mail, MapPin, GraduationCap,
  Edit, X, Loader2, Check, Sparkles, BookOpen,
  AlertCircle, RefreshCw, Users, LogOut
} from "lucide-react";
import { Link } from "react-router";
import { apiFetch } from "../lib/api";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  university?: string;
  department?: string;
  year?: number;
  avatar_url?: string;
  github_url?: string;
  linkedin_url?: string;
  bio?: string;
  skills?: string[];
  courses?: string[];
}

interface AIAnalysis {
  missing_fields: string[];
  tips: string[];
  club_suggestions: string[];
  event_suggestions: string[];
}

interface MyClub {
  id: string;
  name: string;
  description: string;
  category: string;
  cover_url?: string;
  is_open: boolean;
  member_count?: number;
  my_role: string;
  my_status: string;
}

export function Profile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [myClubs, setMyClubs] = useState<MyClub[]>([]);
  const [isLoadingClubs, setIsLoadingClubs] = useState(false);
  const [leavingClubId, setLeavingClubId] = useState<string | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState<{ id: string; name: string } | null>(null);

  const [editForm, setEditForm] = useState({
    name: "",
    university: "",
    department: "",
    year: "",
    github_url: "",
    linkedin_url: "",
    bio: "",
    skills: "",
    courses: "",
  });

  useEffect(() => {
    fetchProfile();
    fetchMyClubs();
  }, []);

  async function fetchMyClubs() {
    try {
      setIsLoadingClubs(true);
      const memberships = await apiFetch("/api/clubs/my-memberships");
      if (!memberships || memberships.length === 0) { setMyClubs([]); return; }
      const clubPromises = memberships.map(async (m: { club_id: string; role: string; status: string }) => {
        try {
          const club = await apiFetch(`/api/clubs/${m.club_id}`);
          return { ...club, my_role: m.role, my_status: m.status };
        } catch {
          return null;
        }
      });
      const results = await Promise.all(clubPromises);
      setMyClubs(results.filter(Boolean));
    } catch {
      console.error("Failed to load clubs");
    } finally {
      setIsLoadingClubs(false);
    }
  }

  async function handleLeaveClub(clubId: string, clubName: string) {
    setLeaveConfirm({ id: clubId, name: clubName });
  }

  async function confirmLeave() {
    if (!leaveConfirm) return;
    const { id: clubId } = leaveConfirm;
    setLeaveConfirm(null);
    try {
      setLeavingClubId(clubId);
      await apiFetch(`/api/clubs/${clubId}/leave`, { method: "DELETE" });
      setMyClubs((prev) => prev.filter((c) => c.id !== clubId));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to leave club");
    } finally {
      setLeavingClubId(null);
    }
  }

  async function fetchProfile() {
    try {
      setIsLoading(true);
      const data = await apiFetch("/api/auth/me");
      setProfile(data);
      setEditForm({
        name: data.name || "",
        university: data.university || "",
        department: data.department || "",
        year: data.year?.toString() || "",
        github_url: data.github_url || "",
        linkedin_url: data.linkedin_url || "",
        bio: data.bio || "",
        skills: (data.skills || []).join(", "),
        courses: (data.courses || []).join(", "),
      });
    } catch {
      console.error("Failed to load profile");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSave() {
    try {
      setIsSaving(true);
      await apiFetch("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: editForm.name || undefined,
          university: editForm.university || undefined,
          department: editForm.department || undefined,
          year: editForm.year ? parseInt(editForm.year) : undefined,
          github_url: editForm.github_url || undefined,
          linkedin_url: editForm.linkedin_url || undefined,
          bio: editForm.bio || undefined,
          skills: editForm.skills ? editForm.skills.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
          courses: editForm.courses ? editForm.courses.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        }),
      });
      setSaveSuccess(true);
      setIsEditing(false);
      fetchProfile();
      setAiAnalysis(null);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  }

  async function fetchAIAnalysis() {
    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      const data = await apiFetch("/api/auth/ai-analysis", { method: "POST" });
      setAiAnalysis(data);
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return <div className="text-center py-12 text-muted-foreground">Profile not found.</div>;
  }

  return (
    <div className="space-y-6">
      {saveSuccess && (
        <div className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200 rounded-lg px-4 py-3 text-sm">
          <Check className="w-4 h-4" />
          Profile updated successfully!
        </div>
      )}

      {/* ── Header card ── */}
      <Card className="p-8">
        <div className="flex items-start gap-6">
          <Avatar name={profile.name} size="xl" src={profile.avatar_url} />
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-bold mb-1">{profile.name}</h1>
                <div className="flex items-center gap-4 text-muted-foreground mb-4 flex-wrap">
                  {(profile.department || profile.year) && (
                    <div className="flex items-center gap-1">
                      <GraduationCap className="w-4 h-4" />
                      <span>
                        {profile.department}
                        {profile.year ? `, Semester ${profile.year}` : ""}
                      </span>
                    </div>
                  )}
                  {profile.university && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span>{profile.university}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  {profile.github_url && (
                    <a
                      href={profile.github_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Github className="w-4 h-4" />
                      <span>{profile.github_url.replace("https://github.com/", "")}</span>
                    </a>
                  )}
                  {profile.linkedin_url && (
                    <a
                      href={profile.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Linkedin className="w-4 h-4" />
                      <span>LinkedIn</span>
                    </a>
                  )}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="w-4 h-4" />
                    <span>{profile.email}</span>
                  </div>
                </div>
              </div>
              <Button variant="outline" onClick={() => setIsEditing(true)}>
                <Edit className="w-4 h-4" />
                Edit Profile
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* ── About ── */}
      <Card className="p-6">
        <h2 className="text-xl font-bold mb-4">About</h2>
        {profile.bio ? (
          <p className="text-muted-foreground leading-relaxed">{profile.bio}</p>
        ) : (
          <p className="text-muted-foreground italic">No bio yet. Click Edit Profile to add one.</p>
        )}
      </Card>

      {/* ── Skills + Courses (side by side) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Skills</h2>
            <span className="text-sm font-medium text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
              {profile.skills?.length || 0}
            </span>
          </div>
          {profile.skills && profile.skills.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {profile.skills.map((skill) => (
                <Tag key={skill} variant="primary">{skill}</Tag>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground italic">No skills added yet.</p>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-bold">Current Courses</h2>
            </div>
            <span className="text-sm font-medium text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">
              {profile.courses?.length || 0}
            </span>
          </div>
          {profile.courses && profile.courses.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {profile.courses.map((course) => (
                <Tag key={course} variant="muted">{course}</Tag>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground italic">No courses added yet.</p>
          )}
        </Card>
      </div>

      {/* ── AI Profile Analysis ── */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold">AI Profile Analysis</h2>
          </div>
          <Button variant="outline" onClick={fetchAIAnalysis} disabled={isAnalyzing}>
            {isAnalyzing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
            ) : aiAnalysis ? (
              <><RefreshCw className="w-4 h-4" /> Refresh</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Analyze Profile</>
            )}
          </Button>
        </div>

        {analysisError && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {analysisError}
          </div>
        )}

        {!aiAnalysis && !isAnalyzing && !analysisError && (
          <p className="text-muted-foreground text-sm">
            Get personalized tips, club suggestions, and improvement ideas based on your profile.
            Analysis is cached for 24 hours.
          </p>
        )}

        {aiAnalysis && (
          <div className="space-y-5">
            {aiAnalysis.missing_fields.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-medium text-amber-800 mb-2">
                  Complete your profile for better suggestions:
                </p>
                <div className="flex flex-wrap gap-2">
                  {aiAnalysis.missing_fields.map((f) => (
                    <span key={f} className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full capitalize">
                      {f.replace("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {aiAnalysis.tips.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2 text-foreground">Profile Improvement Tips</h3>
                <ul className="space-y-2">
                  {aiAnalysis.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {aiAnalysis.club_suggestions.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2 text-foreground">Suggested Clubs for You</h3>
                <div className="flex flex-wrap gap-2">
                  {aiAnalysis.club_suggestions.map((club) => (
                    <Tag key={club} variant="primary">{club}</Tag>
                  ))}
                </div>
              </div>
            )}

            {aiAnalysis.event_suggestions.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2 text-foreground">Recommended Event Types</h3>
                <div className="flex flex-wrap gap-2">
                  {aiAnalysis.event_suggestions.map((ev) => (
                    <Tag key={ev} variant="muted">{ev}</Tag>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── My Clubs ── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-bold">My Clubs</h2>
          <span className="text-sm text-muted-foreground">({myClubs.length})</span>
        </div>

        {isLoadingClubs ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : myClubs.length === 0 ? (
          <Card className="p-8 text-center">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">You haven't joined any clubs yet.</p>
            <Link to="/clubs" className="inline-block mt-3">
              <Button variant="outline" size="sm">Browse Clubs</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myClubs.map((club) => {
              const GRADIENTS: Record<string, string> = {
                Technical: "from-blue-500 to-indigo-600",
                Social: "from-green-400 to-teal-500",
                Sports: "from-orange-400 to-red-500",
                Arts: "from-pink-400 to-purple-500",
                Research: "from-cyan-500 to-blue-500",
                Business: "from-yellow-400 to-orange-500",
                default: "from-primary to-secondary",
              };
              const gradient = GRADIENTS[club.category] || GRADIENTS.default;

              return (
                <Card key={club.id} className="overflow-hidden hover:shadow-md transition-shadow flex flex-col">
                  <div className="relative h-28 flex-shrink-0">
                    {club.cover_url ? (
                      <img src={club.cover_url} alt={club.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                        <span className="text-white text-4xl font-bold opacity-25">{club.name[0]}</span>
                      </div>
                    )}
                    <div className="absolute top-2 right-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-black/50 text-white capitalize">
                        {club.my_role}
                      </span>
                    </div>
                    {club.my_status === "pending" && (
                      <div className="absolute top-2 left-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500 text-white">
                          Pending
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-4 flex flex-col flex-1">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-bold text-sm leading-tight flex-1 mr-2">{club.name}</h3>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{club.category}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3 flex-1">
                      {club.description}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
                      <Users className="w-3.5 h-3.5" />
                      <span>{club.member_count ?? 0} members</span>
                    </div>

                    <div className="flex gap-2">
                      <Link to={`/clubs/${club.id}`} className="flex-1">
                        <Button variant="outline" className="w-full text-xs py-1.5">View Club</Button>
                      </Link>
                      {club.my_role !== "president" && (
                        <Button
                          variant="outline"
                          className="text-xs py-1.5 text-red-500 border-red-200 hover:bg-red-50"
                          onClick={() => handleLeaveClub(club.id, club.name)}
                          disabled={leavingClubId === club.id}
                        >
                          {leavingClubId === club.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <LogOut className="w-3.5 h-3.5" />
                          }
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Leave Club Confirm Modal ── */}
      {leaveConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <LogOut className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="font-bold text-base">Leave Club</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to leave <span className="font-semibold text-foreground">"{leaveConfirm.name}"</span>? You can rejoin later.
            </p>
            <div className="flex gap-3">
              <Button onClick={confirmLeave} className="flex-1" style={{ background: "#ef4444" }}>
                Leave Club
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setLeaveConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {isEditing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl border border-border p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Edit Profile</h2>
              <button onClick={() => setIsEditing(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Full Name</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">University</label>
                <input
                  value={editForm.university}
                  onChange={(e) => setEditForm({ ...editForm, university: e.target.value })}
                  placeholder="e.g. Final International University"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Department</label>
                <input
                  value={editForm.department}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                  placeholder="e.g. Software Engineering"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Semester</label>
                <select
                  value={editForm.year}
                  onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select semester</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                    <option key={s} value={s}>Semester {s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Bio</label>
                <textarea
                  value={editForm.bio}
                  onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                  placeholder="Tell us about yourself..."
                  rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Skills <span className="text-muted-foreground font-normal">(comma separated)</span>
                </label>
                <input
                  value={editForm.skills}
                  onChange={(e) => setEditForm({ ...editForm, skills: e.target.value })}
                  placeholder="React, Python, TypeScript"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Current Courses <span className="text-muted-foreground font-normal">(comma separated)</span>
                </label>
                <input
                  value={editForm.courses}
                  onChange={(e) => setEditForm({ ...editForm, courses: e.target.value })}
                  placeholder="Data Structures, Web Development, Algorithms"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">GitHub URL</label>
                <input
                  value={editForm.github_url}
                  onChange={(e) => setEditForm({ ...editForm, github_url: e.target.value })}
                  placeholder="https://github.com/username"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">LinkedIn URL</label>
                <input
                  value={editForm.linkedin_url}
                  onChange={(e) => setEditForm({ ...editForm, linkedin_url: e.target.value })}
                  placeholder="https://linkedin.com/in/username"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                ) : (
                  "Save Changes"
                )}
              </Button>
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}