import { useState, useEffect, useRef, useMemo, KeyboardEvent } from "react";
import { useLocation } from "react-router";
import {
  Search, Send, Paperclip, Smile, Reply as ReplyIcon, X, Plus, Loader2,
  Bell, BellOff, Pin, Trash2, Check, CheckCheck, Users as UsersIcon,
  FileText, MessageCircle, ArrowLeft, Hash, Folder, MoreVertical, LogOut,
} from "lucide-react";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { apiFetch } from "../lib/api";
import { useAuth, getStoredToken } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

type ChatType = "direct" | "group" | "project";

interface ChatMember {
  id: string;
  name: string;
  avatar_url?: string;
  department?: string;
  role: "admin" | "member";
  joined_at?: string;
}

interface ChatMessageReaction { emoji: string; user_ids: string[]; count: number; }

interface ChatMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  body?: string;
  attachment_url?: string;
  attachment_type?: "image" | "video" | "audio" | "file";
  attachment_name?: string;
  reply_to_id?: string;
  is_pinned?: boolean;
  edited_at?: string;
  deleted_at?: string;
  created_at: string;
  sender?: { id: string; name: string; avatar_url?: string };
  reactions?: ChatMessageReaction[];
}

interface ChatSummary {
  id: string;
  type: ChatType;
  title?: string;
  avatar_url?: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
  members: ChatMember[];
  last_message: ChatMessage | null;
  unread_count: number;
  is_muted: boolean;
  my_role: "admin" | "member";
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// ================================================================
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function chatDisplayTitle(chat: ChatSummary, currentUserId: string): string {
  if (chat.type === "direct") {
    const other = chat.members.find((m) => m.id !== currentUserId);
    return other?.name || chat.title || "Direct Message";
  }
  return chat.title || "Group Chat";
}

function chatDisplayAvatar(chat: ChatSummary, currentUserId: string): { name: string; url?: string } {
  if (chat.type === "direct") {
    const other = chat.members.find((m) => m.id !== currentUserId);
    return { name: other?.name || "?", url: other?.avatar_url };
  }
  return { name: chat.title || "Group", url: chat.avatar_url };
}

// ================================================================
export function Chat() {
  const { user } = useAuth();
  const { error: toastError } = useToast();
  const { confirm: confirmDialog } = useConfirm();
  const location = useLocation();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<ChatSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingChats, setIsLoadingChats] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [chatListSearch, setChatListSearch] = useState("");
  const [inChatSearch, setInChatSearch] = useState("");
  const [showInChatSearch, setShowInChatSearch] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "leave" | "full" } | null>(null);
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<{ id: string; name: string }[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesChannelRef = useRef<RealtimeChannel | null>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const reactionsChannelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  // Initial load
  useEffect(() => { fetchChats(); }, []);

  // Deep-link: ?chatId=<id> navigates directly into a chat once list is loaded
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const deepChatId = params.get("chatId");
    if (!deepChatId || !chats.length) return;
    if (chats.find((c) => c.id === deepChatId)) setActiveChatId(deepChatId);
  }, [location.search, chats.length]);

  // When active chat changes, load messages + subscribe to realtime
  useEffect(() => {
    if (!activeChatId) {
      setActiveChat(null);
      setMessages([]);
      setReplyTo(null);
      setInChatSearch("");
      setShowInChatSearch(false);
      setShowPinned(false);
      setTypingUsers([]);
      return;
    }
    loadChat(activeChatId);
    loadMessages(activeChatId);
    markRead(activeChatId);
    return setupRealtime(activeChatId);
  }, [activeChatId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (showInChatSearch || showPinned) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeChatId]);

  // ----------- Data ops -----------
  async function fetchChats() {
    try {
      setIsLoadingChats(true);
      const data = await apiFetch("/api/chats/");
      setChats(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingChats(false);
    }
  }

  async function loadChat(chatId: string) {
    try {
      const data = await apiFetch(`/api/chats/${chatId}`);
      setActiveChat({
        ...data,
        last_message: null,
        unread_count: 0,
        is_muted: chats.find((c) => c.id === chatId)?.is_muted ?? false,
        my_role: chats.find((c) => c.id === chatId)?.my_role ?? "member",
      });
    } catch (e) { console.error(e); }
  }

  async function loadMessages(chatId: string) {
    try {
      setIsLoadingMessages(true);
      const data = await apiFetch(`/api/chats/${chatId}/messages?limit=80`);
      setMessages(data || []);
    } catch (e) { console.error(e); }
    finally { setIsLoadingMessages(false); }
  }

  async function markRead(chatId: string) {
    try {
      await apiFetch(`/api/chats/${chatId}/read`, { method: "PATCH", body: JSON.stringify({}) });
      setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, unread_count: 0 } : c));
      window.dispatchEvent(new Event("chat-unread-updated"));
    } catch {}
  }

  // ----------- Realtime -----------
  function setupRealtime(chatId: string) {
    // 1) Messages
    const msgsCh = supabase.channel(`chat-msgs-${chatId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        async (payload) => {
          const m = payload.new as ChatMessage;
          // Skip if it's already in our list (we appended it optimistically via REST)
          setMessages((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev;
            return [...prev, { ...m, sender: m.sender_id === user?.user_id ? { id: user!.user_id, name: user!.name } : undefined, reactions: [] }];
          });
          // Hydrate sender if missing (best effort)
          if (m.sender_id !== user?.user_id) {
            try {
              const { data: u } = await supabase.from("users").select("id, name, avatar_url").eq("id", m.sender_id).single();
              if (u) setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, sender: u } : x));
            } catch {}
          }
          if (m.sender_id !== user?.user_id) markRead(chatId);
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const m = payload.new as ChatMessage;
          setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, ...m } : x));
        })
      .subscribe();
    messagesChannelRef.current = msgsCh;

    // 2) Reactions — surgical state update (no full refetch)
    const rxCh = supabase.channel(`chat-rx-${chatId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, (payload) => {
        const r = payload.new as { message_id: string; user_id: string; emoji: string };
        setMessages((prev) => prev.map((m) => {
          if (m.id !== r.message_id) return m;
          const reactions = [...(m.reactions || [])];
          const idx = reactions.findIndex((x) => x.emoji === r.emoji);
          if (idx >= 0) {
            if (reactions[idx].user_ids.includes(r.user_id)) return m;
            reactions[idx] = { ...reactions[idx], user_ids: [...reactions[idx].user_ids, r.user_id], count: reactions[idx].count + 1 };
          } else {
            reactions.push({ emoji: r.emoji, user_ids: [r.user_id], count: 1 });
          }
          return { ...m, reactions };
        }));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (payload) => {
        const r = payload.old as { message_id: string; user_id: string; emoji: string };
        setMessages((prev) => prev.map((m) => {
          if (m.id !== r.message_id) return m;
          const reactions = (m.reactions || [])
            .map((rx) => rx.emoji === r.emoji
              ? { ...rx, user_ids: rx.user_ids.filter((u) => u !== r.user_id), count: rx.count - 1 }
              : rx)
            .filter((rx) => rx.count > 0);
          return { ...m, reactions };
        }));
      })
      .subscribe();
    reactionsChannelRef.current = rxCh;

    // 3) Typing (broadcast)
    const typingCh = supabase.channel(`typing-${chatId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (msg: any) => {
        const { user_id, name } = msg.payload || {};
        if (!user_id || user_id === user?.user_id) return;
        setTypingUsers((prev) => {
          const without = prev.filter((u) => u.id !== user_id);
          return [...without, { id: user_id, name }];
        });
        // auto-remove after 3s
        window.setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u.id !== user_id));
        }, 3000);
      })
      .subscribe();
    typingChannelRef.current = typingCh;

    return () => {
      supabase.removeChannel(msgsCh);
      supabase.removeChannel(rxCh);
      supabase.removeChannel(typingCh);
    };
  }

  // ----------- Sending -----------
  async function sendMessage() {
    if (!activeChatId) return;
    const text = input.trim();
    if (!text && !pendingFile) return;

    const file = pendingFile;
    const replyId = replyTo?.id;

    // Optimistic clear
    setInput("");
    setReplyTo(null);
    if (file) clearPendingFile();

    try {
      if (file) {
        await uploadAndSend(file, text || null, replyId);
      } else {
        const m = await apiFetch(`/api/chats/${activeChatId}/messages`, {
          method: "POST",
          body: JSON.stringify({ body: text, reply_to_id: replyId }),
        });
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
        setChats((prev) => {
          const c = prev.find((x) => x.id === activeChatId);
          if (!c) return prev;
          const updated = { ...c, last_message: m, updated_at: new Date().toISOString() };
          return [updated, ...prev.filter((x) => x.id !== activeChatId)];
        });
      }
    } catch (e: any) {
      toastError(e?.message || "Failed to send message");
    }
  }

  function broadcastTyping() {
    if (!typingChannelRef.current || !user) return;
    typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: user.user_id, name: user.name },
    });
  }

  function handleInputChange(v: string) {
    setInput(v);
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    } else {
      broadcastTyping();
    }
    typingTimeoutRef.current = window.setTimeout(() => {
      typingTimeoutRef.current = null;
    }, 2500);
  }

  function handleInputKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // ----------- Files -----------
  function pickFile(file: File) {
    if (file.size > 25 * 1024 * 1024) { toastError("Max file size is 25MB"); return; }
    setPendingFile(file);
    if (file.type.startsWith("image/")) {
      setPendingPreviewUrl(URL.createObjectURL(file));
    } else {
      setPendingPreviewUrl(null);
    }
  }

  function clearPendingFile() {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
  }

  async function uploadAndSend(file: File, body: string | null, replyId?: string) {
    if (!activeChatId) return;
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getStoredToken();
      const res = await fetch(`${API_BASE}/api/chats/${activeChatId}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
      const { url, name, type } = await res.json();
      const m = await apiFetch(`/api/chats/${activeChatId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          attachment_url: url, attachment_name: name, attachment_type: type,
          body: body || null, reply_to_id: replyId,
        }),
      });
      setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
    } finally {
      setUploadingFile(false);
    }
  }

  // ----------- Reactions -----------
  async function toggleReaction(msg: ChatMessage, emoji: string) {
    if (!activeChatId || !user) return;
    setEmojiPickerFor(null);
    const myId = user.user_id;

    // Optimistic update — apply locally before the network round-trip so the
    // user sees instant feedback. Realtime event will be a no-op (handler
    // checks for duplicates) or correct any drift.
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      const reactions = [...(m.reactions || [])];
      const idx = reactions.findIndex((r) => r.emoji === emoji);
      if (idx >= 0 && reactions[idx].user_ids.includes(myId)) {
        // Remove my reaction
        const newUserIds = reactions[idx].user_ids.filter((u) => u !== myId);
        if (newUserIds.length === 0) reactions.splice(idx, 1);
        else reactions[idx] = { ...reactions[idx], user_ids: newUserIds, count: newUserIds.length };
      } else if (idx >= 0) {
        reactions[idx] = { ...reactions[idx], user_ids: [...reactions[idx].user_ids, myId], count: reactions[idx].count + 1 };
      } else {
        reactions.push({ emoji, user_ids: [myId], count: 1 });
      }
      return { ...m, reactions };
    }));

    try {
      await apiFetch(`/api/chats/${activeChatId}/messages/${msg.id}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
    } catch (e: any) {
      toastError(e?.message || "Failed");
      // Revert on error
      loadMessages(activeChatId);
    }
  }

  // ----------- Pin / mute / delete -----------
  async function togglePin(msg: ChatMessage) {
    if (!activeChatId) return;
    // Optimistic toggle
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_pinned: !m.is_pinned } : m));
    try {
      const result = await apiFetch(`/api/chats/${activeChatId}/messages/${msg.id}/pin`, { method: "PATCH" });
      // Sync with server response
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_pinned: result?.is_pinned ?? !m.is_pinned } : m));
    } catch (e: any) {
      // Revert
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, is_pinned: msg.is_pinned } : m));
      toastError(e?.message || "Failed to pin");
    }
  }

  async function toggleMute() {
    if (!activeChatId || !activeChat) return;
    const next = !activeChat.is_muted;
    await apiFetch(`/api/chats/${activeChatId}/mute`, {
      method: "PATCH",
      body: JSON.stringify({ is_muted: next }),
    });
    setActiveChat({ ...activeChat, is_muted: next });
    setChats((prev) => prev.map((c) => c.id === activeChatId ? { ...c, is_muted: next } : c));
  }

  async function deleteMessage(msg: ChatMessage) {
    if (!activeChatId) return;
    const ok = await confirmDialog({
      title: "Delete this message?",
      description: "This action can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/chats/${activeChatId}/messages/${msg.id}`, { method: "DELETE" });
      setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, deleted_at: new Date().toISOString() } : m));
    } catch (e: any) {
      toastError(e?.message || "Couldn't delete the message");
    }
  }

  // Per-user remove (direct: hide; group: leave)
  async function leaveOrHideChat() {
    if (!activeChatId) return;
    try {
      await apiFetch(`/api/chats/${activeChatId}`, { method: "DELETE" });
      setChats((prev) => prev.filter((c) => c.id !== activeChatId));
      setActiveChatId(null);
      setActiveChat(null);
      setConfirmDelete(null);
    } catch (e: any) {
      toastError(e?.message || "Action failed");
    }
  }

  // Permanent group delete (only group owner + platform admin)
  async function fullDeleteChat() {
    if (!activeChatId) return;
    try {
      await apiFetch(`/api/chats/${activeChatId}/full`, { method: "DELETE" });
      setChats((prev) => prev.filter((c) => c.id !== activeChatId));
      setActiveChatId(null);
      setActiveChat(null);
      setConfirmDelete(null);
    } catch (e: any) {
      toastError(e?.message || "Could not delete chat");
    }
  }

  // ----------- Files archive -----------
  const [chatFiles, setChatFiles] = useState<ChatMessage[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  async function loadFiles() {
    if (!activeChatId) return;
    setFilesLoading(true);
    try {
      const data = await apiFetch(`/api/chats/${activeChatId}/files`);
      setChatFiles(data || []);
    } catch (e: any) {
      toastError(e?.message || "Could not load files");
    } finally {
      setFilesLoading(false);
    }
  }

  useEffect(() => {
    if (showFiles && activeChatId) loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFiles, activeChatId]);

  // Close chat menu on outside click / Esc
  useEffect(() => {
    if (!showChatMenu) return;
    const close = () => setShowChatMenu(false);
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onEsc);
    };
  }, [showChatMenu]);

  // ----------- New chat -----------
  // Filtered chat list
  const filteredChats = useMemo(() => {
    if (!chatListSearch.trim()) return chats;
    const q = chatListSearch.toLowerCase();
    return chats.filter((c) => {
      const title = chatDisplayTitle(c, user?.user_id || "").toLowerCase();
      return title.includes(q);
    });
  }, [chats, chatListSearch, user?.user_id]);

  // In-chat search results
  const searchResults = useMemo(() => {
    if (!inChatSearch.trim()) return [];
    const q = inChatSearch.toLowerCase();
    return messages.filter((m) => (m.body || "").toLowerCase().includes(q));
  }, [messages, inChatSearch]);

  const pinnedMessages = useMemo(() => messages.filter((m) => m.is_pinned && !m.deleted_at), [messages]);

  // Group messages by day
  const groupedMessages = useMemo(() => {
    const groups: { day: string; items: ChatMessage[] }[] = [];
    messages.forEach((m) => {
      const day = new Date(m.created_at).toDateString();
      const last = groups[groups.length - 1];
      if (!last || last.day !== day) groups.push({ day, items: [m] });
      else last.items.push(m);
    });
    return groups;
  }, [messages]);

  return (
    <div className="flex bg-card border border-border rounded-xl overflow-hidden" style={{ height: "calc(100vh - 8rem)" }}>
      {/* ========== LEFT: chat list ========== */}
      <aside className={`${activeChatId ? "hidden md:flex" : "flex"} w-full md:w-80 lg:w-96 flex-col border-r border-border`}>
        <div className="p-4 border-b border-border flex items-center gap-2">
          <h2 className="font-bold text-lg flex-1">Chats</h2>
          <button
            onClick={() => setShowNewChat(true)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="New chat"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={chatListSearch}
              onChange={(e) => setChatListSearch(e.target.value)}
              placeholder="Search chats..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted rounded-lg border border-transparent focus:border-primary focus:outline-none transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoadingChats ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : filteredChats.length === 0 ? (
            <div className="px-6 py-12 text-center text-muted-foreground text-sm">
              <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-40" />
              {chatListSearch ? "No chats found." : "No chats yet. Start a new one!"}
            </div>
          ) : (
            filteredChats.map((c) => {
              const title = chatDisplayTitle(c, user?.user_id || "");
              const av = chatDisplayAvatar(c, user?.user_id || "");
              const isActive = activeChatId === c.id;
              const lastBody = c.last_message?.body
                || (c.last_message?.attachment_type === "image" ? "📷 Image"
                  : c.last_message?.attachment_type === "video" ? "🎬 Video"
                  : c.last_message?.attachment_type === "file" ? "📎 File"
                  : c.last_message?.attachment_type === "audio" ? "🎤 Audio"
                  : "");
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveChatId(c.id)}
                  className={`w-full px-3 py-3 flex items-start gap-3 text-left border-b border-border/40 transition-colors ${
                    isActive ? "bg-accent" : "hover:bg-muted/60"
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    {c.type === "project" ? (
                      <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                        <Hash className="w-5 h-5" />
                      </div>
                    ) : c.type === "group" ? (
                      <div className="w-12 h-12 rounded-full bg-secondary/15 text-secondary flex items-center justify-center">
                        <UsersIcon className="w-5 h-5" />
                      </div>
                    ) : (
                      <Avatar name={av.name} src={av.url} size="md" />
                    )}
                    {c.is_muted && (
                      <BellOff className="absolute -bottom-1 -right-1 w-4 h-4 p-0.5 rounded-full bg-card text-muted-foreground border border-border" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${c.unread_count > 0 ? "font-bold" : "font-semibold"}`}>{title}</span>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {c.last_message ? timeAgo(c.last_message.created_at) : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs truncate flex-1 ${c.unread_count > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {lastBody || <em className="opacity-60">No messages yet</em>}
                      </span>
                      {c.unread_count > 0 && (
                        <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-2 py-0.5 min-w-[20px] text-center">
                          {c.unread_count > 9 ? "9+" : c.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ========== RIGHT: active chat ========== */}
      <section className={`${activeChatId ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
        {!activeChatId ? (
          <div className="flex-1 flex items-center justify-center text-center px-8">
            <div>
              <MessageCircle className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-40" />
              <h3 className="text-lg font-semibold mb-1">Select a chat</h3>
              <p className="text-sm text-muted-foreground">Pick a conversation from the list — or start a new one.</p>
            </div>
          </div>
        ) : !activeChat ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* Header */}
            <header className="px-4 py-3 border-b border-border flex items-center gap-3">
              <button onClick={() => setActiveChatId(null)} className="md:hidden p-2 -ml-2 rounded-lg hover:bg-muted">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div onClick={() => setShowMembers(true)} className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                {activeChat.type === "project" ? (
                  <div className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                    <Hash className="w-5 h-5" />
                  </div>
                ) : activeChat.type === "group" ? (
                  <div className="w-10 h-10 rounded-full bg-secondary/15 text-secondary flex items-center justify-center flex-shrink-0">
                    <UsersIcon className="w-5 h-5" />
                  </div>
                ) : (
                  <Avatar
                    name={chatDisplayAvatar(activeChat, user?.user_id || "").name}
                    src={chatDisplayAvatar(activeChat, user?.user_id || "").url}
                    size="md"
                  />
                )}
                <div className="min-w-0">
                  <div className="font-semibold truncate">{chatDisplayTitle(activeChat, user?.user_id || "")}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {activeChat.type === "direct"
                      ? activeChat.members.find((m) => m.id !== user?.user_id)?.department || "Direct message"
                      : `${activeChat.members.length} members`}
                  </div>
                </div>
              </div>
              <button onClick={() => setShowInChatSearch((v) => !v)} className="p-2 rounded-lg hover:bg-muted" title="Search in chat">
                <Search className="w-5 h-5" />
              </button>
              <button onClick={() => { setShowPinned((v) => !v); setShowFiles(false); }} className="p-2 rounded-lg hover:bg-muted" title="Pinned messages">
                <Pin className={`w-5 h-5 ${pinnedMessages.length > 0 ? "text-primary" : ""}`} />
              </button>
              <button onClick={() => { setShowFiles((v) => !v); setShowPinned(false); }} className="p-2 rounded-lg hover:bg-muted" title="Files & media">
                <Folder className="w-5 h-5" />
              </button>
              <button onClick={toggleMute} className="p-2 rounded-lg hover:bg-muted" title={activeChat.is_muted ? "Unmute" : "Mute"}>
                {activeChat.is_muted ? <BellOff className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
              </button>

              {/* Three-dots menu: leave / hide / delete */}
              {activeChat.type !== "project" && (
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setShowChatMenu((v) => !v)} className="p-2 rounded-lg hover:bg-muted" title="More">
                    <MoreVertical className="w-5 h-5" />
                  </button>
                  {showChatMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl py-1 z-50 min-w-[200px]">
                      <button
                        onClick={() => { setShowChatMenu(false); setConfirmDelete({ kind: "leave" }); }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted text-left transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        {activeChat.type === "direct" ? "Delete chat" : "Leave group"}
                      </button>
                      {activeChat.type === "group" &&
                        (activeChat.my_role === "admin" || user?.role === "admin") && (
                        <button
                          onClick={() => { setShowChatMenu(false); setConfirmDelete({ kind: "full" }); }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-destructive/10 text-destructive text-left transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete entire group
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </header>

            {/* In-chat search bar */}
            {showInChatSearch && (
              <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <input
                  autoFocus
                  value={inChatSearch}
                  onChange={(e) => setInChatSearch(e.target.value)}
                  placeholder="Search in this chat..."
                  className="flex-1 bg-transparent text-sm outline-none"
                />
                {inChatSearch && (
                  <span className="text-xs text-muted-foreground">{searchResults.length} match{searchResults.length === 1 ? "" : "es"}</span>
                )}
                <button onClick={() => { setShowInChatSearch(false); setInChatSearch(""); }} className="p-1 hover:bg-muted rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Pinned panel */}
            {showPinned && (
              <div className="px-4 py-2 border-b border-border bg-muted/30 max-h-40 overflow-y-auto">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pinned</span>
                  <button onClick={() => setShowPinned(false)} className="p-1 hover:bg-muted rounded"><X className="w-3 h-3" /></button>
                </div>
                {pinnedMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No pinned messages.</p>
                ) : (
                  pinnedMessages.map((m) => (
                    <div key={m.id} className="text-xs py-1.5 border-l-2 border-primary pl-2 mb-1">
                      <span className="font-semibold">{m.sender?.name || "Unknown"}: </span>
                      <span className="text-muted-foreground">{m.body || "[attachment]"}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Files panel — sent + received attachments */}
            {showFiles && (
              <div className="px-4 py-2 border-b border-border bg-muted/30 max-h-72 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Folder className="w-3.5 h-3.5" /> Files & Media
                  </span>
                  <button onClick={() => setShowFiles(false)} className="p-1 hover:bg-muted rounded"><X className="w-3 h-3" /></button>
                </div>
                {filesLoading ? (
                  <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                ) : chatFiles.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No files shared yet.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5">
                    {chatFiles.map((m) => (
                      <a key={m.id} href={m.attachment_url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-xs">
                        <span className="flex-shrink-0">
                          {m.attachment_type === "image" ? "🖼️" :
                            m.attachment_type === "video" ? "🎬" :
                              m.attachment_type === "audio" ? "🎤" : "📎"}
                        </span>
                        <span className="truncate flex-1 font-medium">{m.attachment_name || "File"}</span>
                        <span className="text-muted-foreground flex-shrink-0">{m.sender?.name || "?"}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-gradient-to-b from-background/50 to-background">
              {isLoadingMessages ? (
                <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No messages yet. Say hi 👋
                </div>
              ) : (showInChatSearch && inChatSearch ? searchResults : messages).length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No messages match your search.
                </div>
              ) : (
                groupedMessages.map(({ day, items }) => (
                  <div key={day}>
                    <div className="text-center my-3">
                      <span className="inline-block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/60 rounded-full px-3 py-1">
                        {formatDayLabel(items[0].created_at)}
                      </span>
                    </div>
                    {items.map((m, idx) => {
                      if (showInChatSearch && inChatSearch && !(m.body || "").toLowerCase().includes(inChatSearch.toLowerCase())) return null;
                      const mine = m.sender_id === user?.user_id;
                      const prev = items[idx - 1];
                      const sameSenderAsPrev = prev && prev.sender_id === m.sender_id &&
                        new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;
                      const replyMsg = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
                      const otherMembers = activeChat.members.filter((x) => x.id !== user?.user_id);
                      const allOthersRead = otherMembers.length > 0 && otherMembers.every(() => true); // simplified — see below
                      const isReadByOthers = mine && otherMembers.length > 0 ? Boolean(allOthersRead) : false;

                      return (
                        <div key={m.id} className={`group flex gap-2 ${mine ? "justify-end" : "justify-start"} ${sameSenderAsPrev ? "mt-0.5" : "mt-3"}`}>
                          {!mine && !sameSenderAsPrev && (
                            <Avatar name={m.sender?.name || "?"} src={m.sender?.avatar_url} size="sm" />
                          )}
                          {!mine && sameSenderAsPrev && <div className="w-8" />}

                          <div className={`max-w-[75%] flex flex-col ${mine ? "items-end" : "items-start"}`}>
                            {!mine && !sameSenderAsPrev && activeChat.type !== "direct" && (
                              <span className="text-[11px] font-semibold text-primary mb-0.5 px-2">{m.sender?.name}</span>
                            )}

                            {/* Bubble */}
                            <div className={`relative rounded-2xl px-3 py-2 break-words ${
                              mine ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"
                            } ${m.deleted_at ? "italic opacity-60" : ""}`}>
                              {/* Reply preview */}
                              {replyMsg && !m.deleted_at && (
                                <div className={`text-xs rounded-md px-2 py-1 mb-1 border-l-2 ${
                                  mine ? "bg-primary-foreground/15 border-primary-foreground/40" : "bg-card border-primary"
                                }`}>
                                  <div className="font-semibold opacity-80">{replyMsg.sender?.name || "Unknown"}</div>
                                  <div className="opacity-80 line-clamp-1">{replyMsg.body || "[attachment]"}</div>
                                </div>
                              )}

                              {m.deleted_at ? (
                                <span className="text-sm">This message was deleted</span>
                              ) : (
                                <>
                                  {m.attachment_url && m.attachment_type === "image" && (
                                    <a href={m.attachment_url} target="_blank" rel="noopener noreferrer">
                                      <img src={m.attachment_url} alt={m.attachment_name || ""} className="rounded-lg max-h-64 mb-1" />
                                    </a>
                                  )}
                                  {m.attachment_url && m.attachment_type === "video" && (
                                    <video src={m.attachment_url} controls className="rounded-lg max-h-64 mb-1" />
                                  )}
                                  {m.attachment_url && m.attachment_type === "file" && (
                                    <a href={m.attachment_url} target="_blank" rel="noopener noreferrer"
                                       className={`flex items-center gap-2 rounded-lg px-2 py-1.5 mb-1 ${
                                         mine ? "bg-primary-foreground/15" : "bg-card border border-border"
                                       }`}>
                                      <FileText className="w-4 h-4" />
                                      <span className="text-sm truncate">{m.attachment_name || "File"}</span>
                                    </a>
                                  )}
                                  {m.attachment_url && m.attachment_type === "audio" && (
                                    <audio src={m.attachment_url} controls className="mb-1" />
                                  )}
                                  {m.body && <div className="text-sm whitespace-pre-wrap">{m.body}</div>}
                                </>
                              )}

                              {/* Time + status */}
                              <div className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] ${
                                mine ? "text-primary-foreground/70" : "text-muted-foreground"
                              }`}>
                                {m.is_pinned && <Pin className="w-2.5 h-2.5" />}
                                {m.edited_at && <span className="italic">edited</span>}
                                <span>{formatTime(m.created_at)}</span>
                                {mine && !m.deleted_at && (isReadByOthers ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />)}
                              </div>
                            </div>

                            {/* Reactions */}
                            {(m.reactions || []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1 px-1">
                                {(m.reactions || []).map((r) => {
                                  const mineRx = r.user_ids.includes(user?.user_id || "");
                                  return (
                                    <button
                                      key={r.emoji}
                                      onClick={() => toggleReaction(m, r.emoji)}
                                      className={`text-xs rounded-full px-2 py-0.5 border ${
                                        mineRx ? "bg-primary/15 border-primary/40" : "bg-card border-border"
                                      }`}
                                    >
                                      {r.emoji} {r.count}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Hover actions */}
                            {!m.deleted_at && (
                              <div className={`flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${mine ? "flex-row-reverse" : ""}`}>
                                <button onClick={() => setEmojiPickerFor(emojiPickerFor === m.id ? null : m.id)} className="p-1 rounded hover:bg-muted" title="React"><Smile className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setReplyTo(m)} className="p-1 rounded hover:bg-muted" title="Reply"><ReplyIcon className="w-3.5 h-3.5" /></button>
                                <button onClick={() => togglePin(m)} className="p-1 rounded hover:bg-muted" title={m.is_pinned ? "Unpin" : "Pin"}><Pin className="w-3.5 h-3.5" /></button>
                                {(mine || activeChat.my_role === "admin") && (
                                  <button onClick={() => deleteMessage(m)} className="p-1 rounded hover:bg-muted text-destructive" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                                )}
                              </div>
                            )}

                            {emojiPickerFor === m.id && (
                              <div className={`mt-1 bg-card border border-border rounded-full shadow-lg flex gap-1 px-2 py-1 ${mine ? "self-end" : "self-start"}`}>
                                {QUICK_REACTIONS.map((emoji) => (
                                  <button key={emoji} onClick={() => toggleReaction(m, emoji)} className="text-lg hover:scale-125 transition-transform">{emoji}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="px-4 py-1.5 text-xs text-muted-foreground italic flex items-center gap-2 border-t border-border/40">
                <span className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
                {typingUsers.length === 1
                  ? `${typingUsers[0].name} is typing...`
                  : `${typingUsers.length} people are typing...`}
              </div>
            )}

            {/* Pending file preview */}
            {pendingFile && (
              <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center gap-3">
                {pendingPreviewUrl ? (
                  <img src={pendingPreviewUrl} alt="" className="w-12 h-12 object-cover rounded-md flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-card border border-border flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0 text-xs">
                  <div className="font-semibold truncate">{pendingFile.name}</div>
                  <div className="text-muted-foreground">
                    {(pendingFile.size / 1024).toFixed(0)} KB · Add a caption (optional) and press send
                  </div>
                </div>
                <button onClick={clearPendingFile} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
              </div>
            )}

            {/* Reply preview */}
            {replyTo && (
              <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-start gap-2">
                <ReplyIcon className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0 text-xs">
                  <div className="font-semibold text-primary">Replying to {replyTo.sender?.name || "..."}</div>
                  <div className="text-muted-foreground truncate">{replyTo.body || "[attachment]"}</div>
                </div>
                <button onClick={() => setReplyTo(null)} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
              </div>
            )}

            {/* Composer */}
            <div className="px-3 py-3 border-t border-border bg-card flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
                title="Attach file"
              >
                {uploadingFile ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
              </button>
              <textarea
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleInputKey}
                placeholder="Type a message..."
                rows={1}
                className="flex-1 px-3 py-2 text-sm bg-muted rounded-2xl border border-transparent focus:border-primary focus:outline-none transition-colors resize-none max-h-32"
                style={{ minHeight: "40px" }}
              />
              <button
                onClick={sendMessage}
                disabled={(!input.trim() && !pendingFile) || uploadingFile}
                className="p-2.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
                title="Send"
              >
                {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </>
        )}
      </section>

      {/* New chat modal */}
      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onCreated={(chatId) => {
            setShowNewChat(false);
            fetchChats();
            setActiveChatId(chatId);
          }}
        />
      )}

      {/* Members modal */}
      {showMembers && activeChat && (
        <MembersModal
          chat={activeChat}
          currentUserId={user?.user_id || ""}
          onClose={() => setShowMembers(false)}
          onUpdated={fetchChats}
        />
      )}

      {/* Confirm delete / leave modal */}
      {confirmDelete && activeChat && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl border border-border p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                {confirmDelete.kind === "full" ? <Trash2 className="w-5 h-5 text-destructive" /> : <LogOut className="w-5 h-5 text-destructive" />}
              </div>
              <h3 className="font-bold text-base">
                {confirmDelete.kind === "full"
                  ? "Delete entire group"
                  : activeChat.type === "direct" ? "Delete chat" : "Leave group"}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              {confirmDelete.kind === "full"
                ? `This will permanently delete "${chatDisplayTitle(activeChat, user?.user_id || "")}" for everyone. This cannot be undone.`
                : activeChat.type === "direct"
                  ? "This chat will be removed from your list. The other person can still see it; if they send a new message it will reappear."
                  : `You'll leave "${chatDisplayTitle(activeChat, user?.user_id || "")}" and stop receiving its messages.`}
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button
                className="flex-1"
                style={{ background: "#ef4444" }}
                onClick={() => confirmDelete.kind === "full" ? fullDeleteChat() : leaveOrHideChat()}
              >
                {confirmDelete.kind === "full" ? "Delete forever" : (activeChat.type === "direct" ? "Delete" : "Leave")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =================================================================
// New chat modal — search users, create DM or group
// =================================================================
function NewChatModal({ onClose, onCreated }: { onClose: () => void; onCreated: (chatId: string) => void }) {
  const { user } = useAuth();
  const { error: toastError } = useToast();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; avatar_url?: string; department?: string }[]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string }[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (search.trim().length < 2) { setResults([]); return; }
      setIsSearching(true);
      try {
        const data = await apiFetch(`/api/auth/search-users?q=${encodeURIComponent(search.trim())}`);
        setResults(data || []);
      } catch (e) { console.error(e); }
      finally { setIsSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [search, user?.user_id]);

  function toggle(u: any) {
    setSelected((prev) =>
      prev.some((x) => x.id === u.id) ? prev.filter((x) => x.id !== u.id) : [...prev, { id: u.id, name: u.name }]
    );
  }

  async function create() {
    if (selected.length === 0) return;
    setIsCreating(true);
    try {
      const isGroup = selected.length > 1;
      const chat = await apiFetch("/api/chats/", {
        method: "POST",
        body: JSON.stringify({
          type: isGroup ? "group" : "direct",
          title: isGroup ? (groupTitle.trim() || `${user?.name?.split(" ")[0]} & ${selected.length} others`) : null,
          member_ids: selected.map((s) => s.id),
        }),
      });
      onCreated(chat.id);
    } catch (e: any) {
      toastError({
        title: "Couldn't start chat",
        body: e?.message || "Something went wrong while creating the chat.",
        hint: "Please try again in a moment.",
      });
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col" style={{ maxHeight: "80vh" }}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold">New Chat</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-3 border-b border-border space-y-2">
          {selected.length > 1 && (
            <input
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Group name (optional)"
              className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((s) => (
                <span key={s.id} className="bg-primary/15 text-primary text-xs px-2 py-1 rounded-full flex items-center gap-1">
                  {s.name}
                  <button onClick={() => setSelected((p) => p.filter((x) => x.id !== s.id))}><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students by name..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted rounded-lg border border-transparent focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {isSearching ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : search.trim().length < 2 ? (
            <p className="text-center text-xs text-muted-foreground py-6">Type at least 2 characters to search.</p>
          ) : results.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-6">No users found.</p>
          ) : (
            results.map((u) => {
              const isSelected = selected.some((s) => s.id === u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => toggle(u)}
                  className={`w-full px-5 py-2 flex items-center gap-3 text-left transition-colors ${isSelected ? "bg-accent" : "hover:bg-muted"}`}
                >
                  <Avatar name={u.name} src={u.avatar_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{u.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{u.department || ""}</div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-primary" />}
                </button>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={create} disabled={selected.length === 0 || isCreating}>
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : selected.length > 1 ? "Create Group" : "Start Chat"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =================================================================
// Members modal — read-only for members; owner sees Add / Remove
// =================================================================
function MembersModal({
  chat,
  currentUserId,
  onClose,
  onUpdated,
}: {
  chat: ChatSummary;
  currentUserId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { error: toastError, success: toastOk } = useToast();
  const { confirm: confirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const isOwner = chat.my_role === "admin";
  const canManage = chat.type === "group" && isOwner;

  async function removeMember(memberId: string, name: string) {
    const ok = await confirmDialog({
      title: `Remove ${name}?`,
      description: `${name} will lose access to this group.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setBusyId(memberId);
      await apiFetch(`/api/chats/${chat.id}/members/${memberId}`, { method: "DELETE" });
      toastOk(`${name} removed`);
      onUpdated();
      onClose();
    } catch (e: any) {
      toastError(e?.message || "Couldn't remove member");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col" style={{ maxHeight: "80vh" }}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-bold">{chat.type === "direct" ? "Profile" : "Members"}</h3>
            <p className="text-xs text-muted-foreground">{chat.members.length} {chat.members.length === 1 ? "person" : "people"}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-4 h-4" /></button>
        </div>

        {canManage && !showAdd && (
          <div className="px-5 py-2 border-b border-border">
            <button
              onClick={() => setShowAdd(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add member
            </button>
          </div>
        )}

        {canManage && showAdd && (
          <AddMemberPanel
            chatId={chat.id}
            existingMemberIds={chat.members.map((m) => m.id)}
            onCancel={() => setShowAdd(false)}
            onAdded={() => { setShowAdd(false); onUpdated(); onClose(); }}
          />
        )}

        <div className="flex-1 overflow-y-auto py-2">
          {chat.members.map((m) => (
            <div key={m.id} className="px-5 py-2 flex items-center gap-3">
              <Avatar name={m.name} src={m.avatar_url} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {m.name} {m.id === currentUserId && <span className="text-xs text-muted-foreground">(you)</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{m.department || ""}</div>
              </div>
              {m.role === "admin" && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">Owner</span>
              )}
              {canManage && m.id !== currentUserId && m.role !== "admin" && (
                <button
                  onClick={() => removeMember(m.id, m.name)}
                  disabled={busyId === m.id}
                  aria-label={`Remove ${m.name}`}
                  className="p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors"
                >
                  {busyId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddMemberPanel({
  chatId,
  existingMemberIds,
  onCancel,
  onAdded,
}: {
  chatId: string;
  existingMemberIds: string[];
  onCancel: () => void;
  onAdded: () => void;
}) {
  const { error: toastError } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; avatar_url?: string; department?: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.trim().length < 2) { setResults([]); return; }
      setIsSearching(true);
      try {
        const data = await apiFetch(`/api/auth/search-users?q=${encodeURIComponent(query.trim())}`);
        setResults((data || []).filter((u: any) => !existingMemberIds.includes(u.id)));
      } catch {
        // silent — user can retry
      } finally {
        setIsSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, existingMemberIds]);

  async function add(userId: string) {
    try {
      setAdding(userId);
      await apiFetch(`/api/chats/${chatId}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      });
      onAdded();
    } catch (e: any) {
      toastError(e?.message || "Couldn't add member");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="px-5 py-3 border-b border-border space-y-2 bg-muted/30">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users to add..."
          className="flex-1 bg-transparent text-sm outline-none"
        />
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:underline">Cancel</button>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {isSearching && <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>}
        {!isSearching && query.trim().length >= 2 && results.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">No matches.</p>
        )}
        {results.map((u) => (
          <button
            key={u.id}
            onClick={() => add(u.id)}
            disabled={adding === u.id}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-card disabled:opacity-50 transition-colors text-left"
          >
            <Avatar name={u.name} src={u.avatar_url} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{u.name}</p>
              {u.department && <p className="text-xs text-muted-foreground truncate">{u.department}</p>}
            </div>
            {adding === u.id ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            ) : (
              <Plus className="w-4 h-4 text-primary" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
