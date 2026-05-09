import { useState, useEffect, useRef } from "react";
import { Avatar } from "../components/Avatar";
import {
  Search, FileText, Send, Upload, Plus, X,
  Loader2, LogOut, BookOpen, Trash2, Pencil, Download,
  MessageCircle, Lock, Globe, Check, Clock, Users, Bell
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { getStoredToken } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface StudyGroup {
  id: string;
  course_name: string;
  course_code?: string;
  description?: string;
  creator_id: string;
  is_active: boolean;
  is_private: boolean;
}

interface Message {
  id: string;
  group_id: string;
  sender_id: string;
  content?: string;
  file_url?: string;
  file_name?: string;
  created_at: string;
  users?: { id: string; name: string; avatar_url?: string };
}

interface Member {
  id: string;
  user_id: string;
  status: string;
  users?: { id: string; name: string; avatar_url?: string };
}

type ModalType = "create" | "edit" | "members" | null;

export function StudyGroups() {
  const { user } = useAuth();
  const { success, error: toastError, info } = useToast();
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [membershipMap, setMembershipMap] = useState<Record<string, string>>({});
  const [selectedGroup, setSelectedGroup] = useState<StudyGroup | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMsgLoading, setIsMsgLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "my">("all");
  const [modal, setModal] = useState<ModalType>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [createForm, setCreateForm] = useState({ course_name: "", course_code: "", description: "", is_private: false });
  const [editForm, setEditForm] = useState({ course_name: "", course_code: "", description: "", is_private: false });

  useEffect(() => { fetchGroups(); }, []);

  useEffect(() => {
    if (!selectedGroup) return;
    const myStatus = membershipMap[selectedGroup.id];
    if (myStatus === "approved") {
      fetchMessages(selectedGroup.id);
    } else {
      setMessages([]);
    }
    fetchMembers(selectedGroup.id);

    const channel = supabase
      .channel(`study-${selectedGroup.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public",
        table: "study_messages",
        filter: `group_id=eq.${selectedGroup.id}`
      }, async (payload) => {
        const data = await apiFetch(`/api/study-groups/${selectedGroup.id}/messages`).catch(() => []);
        const found = data.find((m: Message) => m.id === (payload.new as Message).id);
        if (found) setMessages(prev => prev.some(m => m.id === found.id) ? prev : [...prev, found]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedGroup, membershipMap]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchGroups() {
    try {
      setIsLoading(true);
      const data = await apiFetch("/api/study-groups/");
      setGroups(data);
      const map: Record<string, string> = {};
      for (const group of data) {
        const membersData = await apiFetch(`/api/study-groups/${group.id}/members`).catch(() => []);
        const me = membersData.find((m: Member) => m.user_id === user?.user_id);
        if (me) map[group.id] = me.status;
      }
      setMembershipMap(map);
    } catch { console.error("Failed to load groups"); }
    finally { setIsLoading(false); }
  }

  async function fetchMessages(groupId: string) {
    try {
      setIsMsgLoading(true);
      const data = await apiFetch(`/api/study-groups/${groupId}/messages`);
      setMessages(data);
    } catch { setMessages([]); }
    finally { setIsMsgLoading(false); }
  }

  async function fetchMembers(groupId: string) {
    try {
      const data = await apiFetch(`/api/study-groups/${groupId}/members`);
      setMembers(data);
    } catch { console.error("Failed to load members"); }
  }

  async function handleCreate() {
    try {
      setIsSubmitting(true);
      const data = await apiFetch("/api/study-groups/", {
        method: "POST",
        body: JSON.stringify({ ...createForm, course_code: createForm.course_code || null })
      });
      setGroups(prev => [data, ...prev]);
      setMembershipMap(prev => ({ ...prev, [data.id]: "approved" }));
      setModal(null);
      setCreateForm({ course_name: "", course_code: "", description: "", is_private: false });
      setSelectedGroup(data);
      success("Study group created!");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed to create group"); }
    finally { setIsSubmitting(false); }
  }

  async function handleEdit() {
    if (!selectedGroup) return;
    try {
      setIsSubmitting(true);
      await apiFetch(`/api/study-groups/${selectedGroup.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...editForm, course_code: editForm.course_code || null })
      });
      const updated = { ...selectedGroup, ...editForm };
      setSelectedGroup(updated);
      setGroups(prev => prev.map(g => g.id === selectedGroup.id ? { ...g, ...editForm } : g));
      setModal(null);
      success("Group updated!");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed to update group"); }
    finally { setIsSubmitting(false); }
  }

  async function handleDelete(groupId: string) {
    if (!window.confirm("Delete this group? All messages will be lost.")) return;
    try {
      await apiFetch(`/api/study-groups/${groupId}`, { method: "DELETE" });
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setMembershipMap(prev => { const n = { ...prev }; delete n[groupId]; return n; });
      if (selectedGroup?.id === groupId) setSelectedGroup(null);
      success("Group deleted.");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed to delete group"); }
  }

  async function handleJoin(groupId: string) {
    try {
      await apiFetch(`/api/study-groups/${groupId}/join`, { method: "POST" });
      const group = groups.find(g => g.id === groupId);
      const newStatus = group?.is_private ? "pending" : "approved";
      setMembershipMap(prev => ({ ...prev, [groupId]: newStatus }));
      fetchMembers(groupId);
      if (newStatus === "pending") info("Join request sent! Waiting for approval.");
      else success("Joined successfully!");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed to join group"); }
  }

  async function handleLeave(groupId: string) {
    if (!window.confirm("Leave this group?")) return;
    try {
      await apiFetch(`/api/study-groups/${groupId}/leave`, { method: "DELETE" });
      setMembershipMap(prev => { const n = { ...prev }; delete n[groupId]; return n; });
      if (selectedGroup?.id === groupId) setSelectedGroup(null);
      success("Left the group.");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed to leave group"); }
  }

  async function handleApprove(groupId: string, userId: string) {
    try {
      await apiFetch(`/api/study-groups/${groupId}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved" })
      });
      fetchMembers(groupId);
      success("Member approved!");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed"); }
  }

  async function handleReject(groupId: string, userId: string) {
    try {
      await apiFetch(`/api/study-groups/${groupId}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "rejected" })
      });
      fetchMembers(groupId);
      info("Request rejected.");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed"); }
  }

  async function handleSendMessage() {
    if (!messageText.trim() || !selectedGroup) return;
    try {
      setIsSending(true);
      await apiFetch(`/api/study-groups/${selectedGroup.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: messageText }),
      });
      setMessageText("");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed to send message"); }
    finally { setIsSending(false); }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedGroup) return;
    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      const token = getStoredToken();
      const response = await fetch(`${API_BASE}/api/study-groups/${selectedGroup.id}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { file_url, file_name } = await response.json();
      await apiFetch(`/api/study-groups/${selectedGroup.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ file_url, file_name }),
      });
      fetchMessages(selectedGroup.id);
      success("File uploaded!");
    } catch (err: unknown) { toastError(err instanceof Error ? err.message : "Failed to upload"); }
    finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownload(url: string, fileName: string) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName || "file";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch { toastError("Download failed"); }
  }

  const approvedMembers = members.filter(m => m.status === "approved");
  const pendingMembers = members.filter(m => m.status === "pending");

  const filtered = groups.filter(g => {
    const matchSearch = g.course_name.toLowerCase().includes(search.toLowerCase()) ||
      (g.course_code || "").toLowerCase().includes(search.toLowerCase());
    return matchSearch && (activeTab === "all" || membershipMap[g.id] === "approved");
  });

  const myStatus = selectedGroup ? membershipMap[selectedGroup.id] : null;
  const isApproved = myStatus === "approved";
  const isPending = myStatus === "pending";
  const isCreator = selectedGroup?.creator_id === user?.user_id;

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-8 bg-background">

      {/* LEFT SIDEBAR */}
      <div className="w-80 flex-shrink-0 flex flex-col border-r border-border bg-card">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-bold">Study Groups</h1>
            <button
              onClick={() => setModal("create")}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search groups..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted rounded-lg border border-transparent focus:border-primary focus:outline-none transition-colors"
            />
          </div>
          <div className="flex gap-1 mt-3">
            {(["all", "my"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}>
                {tab === "all" ? `All (${groups.length})` : `Joined (${Object.values(membershipMap).filter(s => s === "approved").length})`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No groups found</p>
            </div>
          ) : filtered.map(group => {
            const status = membershipMap[group.id];
            const isSelected = selectedGroup?.id === group.id;
            return (
              <div key={group.id} onClick={() => setSelectedGroup(group)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-border/50 ${
                  isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-muted/50"
                }`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 ${
                  group.is_private ? "bg-gradient-to-br from-purple-500 to-indigo-600" : "bg-gradient-to-br from-primary to-teal-500"
                }`}>
                  {group.course_name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm truncate">{group.course_name}</p>
                    {group.is_private ? <Lock className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">
                      {group.course_code && <span className="font-medium text-primary">{group.course_code} · </span>}
                      {group.description || (group.is_private ? "Private group" : "Open group")}
                    </p>
                    {status === "pending" && <span className="text-xs text-orange-500 font-medium flex-shrink-0 ml-1">Pending</span>}
                    {status === "approved" && <Check className="w-3 h-3 text-green-500 flex-shrink-0 ml-1" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT CHAT */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedGroup ? (
          <div className="flex-1 flex items-center justify-center bg-muted/20">
            <div className="text-center text-muted-foreground">
              <MessageCircle className="w-20 h-20 mx-auto mb-4 opacity-10" />
              <p className="text-lg font-medium">Select a study group</p>
              <p className="text-sm mt-1">Choose from the sidebar to start chatting</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b border-border bg-card flex items-center gap-3 flex-shrink-0">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 ${
                selectedGroup.is_private ? "bg-gradient-to-br from-purple-500 to-indigo-600" : "bg-gradient-to-br from-primary to-teal-500"
              }`}>
                {selectedGroup.course_name[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold truncate">{selectedGroup.course_name}</h2>
                  {selectedGroup.course_code && (
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full flex-shrink-0">
                      {selectedGroup.course_code}
                    </span>
                  )}
                  {selectedGroup.is_private
                    ? <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    : <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground">
                  {approvedMembers.length} members
                  {pendingMembers.length > 0 && isCreator && (
                    <span className="text-orange-500 ml-2">· {pendingMembers.length} pending</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {isCreator && pendingMembers.length > 0 && (
                  <button onClick={() => setModal("members")}
                    className="relative p-2 rounded-lg hover:bg-muted transition-colors text-orange-500">
                    <Bell className="w-5 h-5" />
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                      {pendingMembers.length}
                    </span>
                  </button>
                )}
                <button onClick={() => setModal("members")}
                  className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                  <Users className="w-5 h-5" />
                </button>
                {isCreator && (
                  <>
                    <button onClick={() => {
                      setEditForm({ course_name: selectedGroup.course_name, course_code: selectedGroup.course_code || "", description: selectedGroup.description || "", is_private: selectedGroup.is_private });
                      setModal("edit");
                    }} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(selectedGroup.id)}
                      className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                {!isCreator && isApproved && (
                  <button onClick={() => handleLeave(selectedGroup.id)}
                    className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-destructive">
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Body */}
            {!myStatus ? (
              <div className="flex-1 flex items-center justify-center bg-muted/10">
                <div className="text-center max-w-sm px-6">
                  <div className={`w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center ${selectedGroup.is_private ? "bg-purple-100" : "bg-primary/10"}`}>
                    {selectedGroup.is_private ? <Lock className="w-8 h-8 text-purple-500" /> : <Globe className="w-8 h-8 text-primary" />}
                  </div>
                  <h3 className="text-lg font-bold mb-2">{selectedGroup.course_name}</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    {selectedGroup.is_private
                      ? "This is a private group. The creator will approve your request."
                      : "Join this group to participate in discussions and access shared files."}
                  </p>
                  <button onClick={() => handleJoin(selectedGroup.id)}
                    className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors">
                    {selectedGroup.is_private ? "Request to Join" : "Join Group"}
                  </button>
                </div>
              </div>
            ) : isPending ? (
              <div className="flex-1 flex items-center justify-center bg-muted/10">
                <div className="text-center max-w-sm px-6">
                  <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center bg-orange-100">
                    <Clock className="w-8 h-8 text-orange-500" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">Request Pending</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    Your request to join <strong>{selectedGroup.course_name}</strong> is waiting for approval.
                  </p>
                  <button onClick={() => handleLeave(selectedGroup.id)}
                    className="px-6 py-2.5 text-destructive border border-destructive rounded-xl font-medium hover:bg-destructive/10 transition-colors text-sm">
                    Cancel Request
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{
                backgroundImage: "radial-gradient(circle at 1px 1px, var(--border) 1px, transparent 0)",
                backgroundSize: "24px 24px",
              }}>
                {isMsgLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-sm text-muted-foreground bg-card/80 inline-block px-4 py-2 rounded-full">
                      No messages yet. Say hello! 👋
                    </p>
                  </div>
                ) : messages.map((message, idx) => {
                  const isOwn = message.sender_id === user?.user_id;
                  const senderName = message.users?.name || "Unknown";
                  const prevMsg = messages[idx - 1];
                  const showAvatar = !isOwn && (!prevMsg || prevMsg.sender_id !== message.sender_id);
                  return (
                    <div key={message.id} className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""} ${showAvatar ? "mt-3" : "mt-0.5"}`}>
                      <div className="w-8 flex-shrink-0">
                        {showAvatar && !isOwn && <Avatar name={senderName} src={message.users?.avatar_url} size="sm" />}
                      </div>
                      <div className={`max-w-[70%] ${isOwn ? "flex flex-col items-end" : ""}`}>
                        {showAvatar && !isOwn && (
                          <p className="text-xs font-semibold text-primary mb-1 ml-1">{senderName}</p>
                        )}
                        {message.content && (
                          <div className={`px-3.5 py-2 rounded-2xl text-sm shadow-sm ${
                            isOwn ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card text-foreground rounded-tl-sm border border-border"
                          }`}>
                            <p className="leading-relaxed">{message.content}</p>
                            <p className={`text-xs mt-1 text-right ${isOwn ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                              {formatTime(message.created_at)}
                            </p>
                          </div>
                        )}
                        {message.file_url && message.file_name && (
                          <div className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl shadow-sm border ${
                            isOwn ? "bg-primary/15 border-primary/20 rounded-tr-sm" : "bg-card border-border rounded-tl-sm"
                          }`}>
                            <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                              <FileText className="w-4 h-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{message.file_name}</p>
                              <p className="text-xs text-muted-foreground">{formatTime(message.created_at)}</p>
                            </div>
                            <button onClick={() => handleDownload(message.file_url!, message.file_name!)}
                              className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors">
                              <Download className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}

            {isApproved && (
              <div className="px-4 py-3 border-t border-border bg-card flex-shrink-0">
                <div className="flex items-center gap-2">
                  <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden"
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.zip" />
                  <button onClick={() => fileInputRef.current?.click()} disabled={isUploading}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 text-muted-foreground transition-colors flex-shrink-0">
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 flex items-center bg-muted rounded-full px-4 py-2.5">
                    <input type="text" value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 text-sm bg-transparent focus:outline-none" />
                  </div>
                  <button onClick={handleSendMessage} disabled={isSending || !messageText.trim()}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex-shrink-0">
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* MEMBERS MODAL */}
      {modal === "members" && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-bold text-lg">Group Members</h2>
              <button onClick={() => setModal(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            {isCreator && pendingMembers.length > 0 && (
              <div className="px-5 py-3 bg-orange-50 border-b border-orange-100">
                <p className="text-xs font-semibold text-orange-600 mb-2">Pending Requests ({pendingMembers.length})</p>
                <div className="space-y-2">
                  {pendingMembers.map(m => (
                    <div key={m.id} className="flex items-center gap-3">
                      <Avatar name={m.users?.name || "?"} size="sm" />
                      <p className="flex-1 text-sm font-medium">{m.users?.name || "Unknown"}</p>
                      <button onClick={() => handleApprove(selectedGroup.id, m.user_id)}
                        className="p-1.5 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 transition-colors">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleReject(selectedGroup.id, m.user_id)}
                        className="p-1.5 rounded-lg bg-red-100 text-red-500 hover:bg-red-200 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="px-5 py-3 max-h-64 overflow-y-auto">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Members ({approvedMembers.length})</p>
              <div className="space-y-3">
                {approvedMembers.map(m => (
                  <div key={m.id} className="flex items-center gap-3">
                    <Avatar name={m.users?.name || "?"} src={m.users?.avatar_url} size="sm" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{m.users?.name || "Unknown"}</p>
                      {m.user_id === selectedGroup.creator_id && <p className="text-xs text-primary">Creator</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE MODAL */}
      {modal === "create" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-xl font-bold">New Study Group</h2>
              <button onClick={() => setModal(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Course Name <span className="text-destructive">*</span></label>
                <input value={createForm.course_name} onChange={e => setCreateForm({ ...createForm, course_name: e.target.value })}
                  placeholder="e.g. Data Structures and Algorithms"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Course Code <span className="text-muted-foreground text-xs">(optional)</span></label>
                <input value={createForm.course_code} onChange={e => setCreateForm({ ...createForm, course_code: e.target.value })}
                  placeholder="e.g. CS301"
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Description <span className="text-muted-foreground text-xs">(optional)</span></label>
                <textarea value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="What will this group focus on?" rows={2}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${createForm.is_private ? "bg-purple-100" : "bg-primary/10"}`}>
                  {createForm.is_private ? <Lock className="w-5 h-5 text-purple-500" /> : <Globe className="w-5 h-5 text-primary" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{createForm.is_private ? "Private Group" : "Public Group"}</p>
                  <p className="text-xs text-muted-foreground">{createForm.is_private ? "Members need approval to join" : "Anyone can join instantly"}</p>
                </div>
                <button onClick={() => setCreateForm(f => ({ ...f, is_private: !f.is_private }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${createForm.is_private ? "bg-purple-500" : "bg-muted-foreground/30"}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${createForm.is_private ? "left-5" : "left-0.5"}`} />
                </button>
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={handleCreate} disabled={isSubmitting || !createForm.course_name}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Group"}
              </button>
              <button onClick={() => setModal(null)}
                className="px-4 py-2.5 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {modal === "edit" && selectedGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-xl font-bold">Edit Group</h2>
              <button onClick={() => setModal(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Course Name</label>
                <input value={editForm.course_name} onChange={e => setEditForm({ ...editForm, course_name: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Course Code <span className="text-muted-foreground text-xs">(optional)</span></label>
                <input value={editForm.course_code} onChange={e => setEditForm({ ...editForm, course_code: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Description</label>
                <textarea value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  rows={2} className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
              </div>
              <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${editForm.is_private ? "bg-purple-100" : "bg-primary/10"}`}>
                  {editForm.is_private ? <Lock className="w-5 h-5 text-purple-500" /> : <Globe className="w-5 h-5 text-primary" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{editForm.is_private ? "Private Group" : "Public Group"}</p>
                  <p className="text-xs text-muted-foreground">{editForm.is_private ? "Members need approval to join" : "Anyone can join instantly"}</p>
                </div>
                <button onClick={() => setEditForm(f => ({ ...f, is_private: !f.is_private }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${editForm.is_private ? "bg-purple-500" : "bg-muted-foreground/30"}`}>
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${editForm.is_private ? "left-5" : "left-0.5"}`} />
                </button>
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={handleEdit} disabled={isSubmitting}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
              </button>
              <button onClick={() => setModal(null)}
                className="px-4 py-2.5 bg-muted text-foreground rounded-xl font-medium hover:bg-muted/80 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}