from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File, Query, Request
from typing import Optional
from app.schemas.chats import (
    ChatCreate, ChatUpdate, MessageCreate, MessageEdit,
    ReactionToggle, MemberAdd, MuteUpdate, MarkReadUpdate,
)
from app.schemas.notifications import send_notification
from app.core.supabase import get_supabase_admin
from app.core.security import get_current_user
from app.core.ratelimit import limiter
from datetime import datetime, timezone
import uuid
import mimetypes
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

CHAT_BUCKET = "chat-media"

ALLOWED_MIME_PREFIXES = ("image/", "video/", "audio/")
ALLOWED_MIME_EXACT = {
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "text/markdown",
}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

# Per-message mention cap. Stops a client from notifying the whole
# membership of a large group in one shot ("mention spam"). The chat
# UI doesn't expose a bulk-mention affordance, so legitimate users
# never hit this; only a custom client could.
MAX_MENTIONS_PER_MESSAGE = 10


# ============================================================
# Helpers
# ============================================================
def _ensure_member(supabase, chat_id: str, user_id: str) -> dict:
    res = supabase.table("chat_members").select("*") \
        .eq("chat_id", chat_id).eq("user_id", user_id).maybe_single().execute()
    if not res or not res.data:
        raise HTTPException(status_code=403, detail="You are not a member of this chat")
    return res.data


def _ensure_admin(supabase, chat_id: str, user_id: str):
    m = _ensure_member(supabase, chat_id, user_id)
    if m["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")


def _detect_attachment_type(filename: str) -> str:
    mt, _ = mimetypes.guess_type(filename or "")
    if not mt:
        return "file"
    if mt.startswith("image/"): return "image"
    if mt.startswith("video/"): return "video"
    if mt.startswith("audio/"): return "audio"
    return "file"


def _hydrate_users(supabase, user_ids):
    user_ids = list(set([u for u in user_ids if u]))
    if not user_ids:
        return {}
    res = supabase.table("users").select("id, name, avatar_url").in_("id", user_ids).execute()
    return {u["id"]: u for u in (res.data or [])}


def _hydrate_message(supabase, msg, users_map=None):
    """Attach sender info and reactions count to a message dict."""
    if users_map is None:
        users_map = _hydrate_users(supabase, [msg["sender_id"]])
    msg["sender"] = users_map.get(msg["sender_id"])
    # reactions grouped
    rx = supabase.table("message_reactions").select("emoji, user_id").eq("message_id", msg["id"]).execute()
    grouped = {}
    for r in (rx.data or []):
        grouped.setdefault(r["emoji"], []).append(r["user_id"])
    msg["reactions"] = [{"emoji": k, "user_ids": v, "count": len(v)} for k, v in grouped.items()]
    return msg


# ============================================================
# CHATS
# ============================================================
@router.get("/unread-total")
def get_total_unread(current_user: dict = Depends(get_current_user)):
    """Single number: total unread messages across all of the user's chats.
    Used by Sidebar to show a badge next to "Chats".

    Muted chats are excluded from this count — they don't trigger notifications
    by design. The chat-list view still shows their per-chat unread count, but
    the global badge stays quiet.
    """
    supabase = get_supabase_admin()
    memberships = supabase.table("chat_members").select("chat_id, last_read_at, is_muted") \
        .eq("user_id", current_user["id"]).execute()
    total = 0
    for m in (memberships.data or []):
        if m.get("is_muted"):
            continue
        last_read = m.get("last_read_at")
        if not last_read:
            continue
        cnt = supabase.table("messages").select("id", count="exact") \
            .eq("chat_id", m["chat_id"]).gt("created_at", last_read) \
            .neq("sender_id", current_user["id"]).is_("deleted_at", "null").execute()
        total += cnt.count or 0
    return {"count": total}


@router.get("/")
def list_my_chats(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    memberships = supabase.table("chat_members").select(
        "chat_id, last_read_at, is_muted, role, hidden_at, pinned_at"
    ).eq("user_id", current_user["id"]).execute()
    # Filter out chats the user has hidden (per-user delete on direct chats)
    membership_rows = [m for m in (memberships.data or []) if not m.get("hidden_at")]
    if not membership_rows:
        return []

    chat_ids = [m["chat_id"] for m in membership_rows]
    chats = supabase.table("chats").select("*").in_("id", chat_ids).order("updated_at", desc=True).execute()
    chat_rows = chats.data or []
    membership_map = {m["chat_id"]: m for m in membership_rows}

    # Pinned chats float to the top, newest pin first. Within each
    # group (pinned / unpinned) we preserve the updated_at desc order
    # that PostgREST already applied.
    chat_rows.sort(
        key=lambda c: (
            membership_map.get(c["id"], {}).get("pinned_at") or "",
        ),
        reverse=True,
    )
    chat_rows.sort(
        key=lambda c: bool(membership_map.get(c["id"], {}).get("pinned_at")),
        reverse=True,
    )

    # Batch members + users for all chats in two queries instead of
    # 2 × N. Output shape per chat is unchanged.
    all_members_res = supabase.table("chat_members") \
        .select("chat_id, user_id, role") \
        .in_("chat_id", chat_ids).execute()
    all_members = all_members_res.data or []
    members_by_chat: dict[str, list[dict]] = {}
    for mr in all_members:
        members_by_chat.setdefault(mr["chat_id"], []).append(mr)
    all_user_ids = list({mr["user_id"] for mr in all_members})
    users_map = _hydrate_users(supabase, all_user_ids)

    out = []
    for c in chat_rows:
        m = membership_map.get(c["id"], {})
        last_read_at = m.get("last_read_at")

        # last_message and unread_count still per-chat — batching these
        # cleanly requires a Postgres RPC (window function per chat),
        # which is the next optimisation pass.
        last_msg_res = supabase.table("messages").select(
            "id, sender_id, body, attachment_type, created_at, deleted_at"
        ).eq("chat_id", c["id"]).is_("deleted_at", "null") \
         .order("created_at", desc=True).limit(1).execute()
        last_msg = last_msg_res.data[0] if last_msg_res.data else None

        unread = 0
        if last_read_at:
            cnt = supabase.table("messages").select("id", count="exact") \
                .eq("chat_id", c["id"]).gt("created_at", last_read_at) \
                .neq("sender_id", current_user["id"]) \
                .is_("deleted_at", "null").execute()
            unread = cnt.count or 0

        members = []
        for mr in members_by_chat.get(c["id"], []):
            u = users_map.get(mr["user_id"])
            if u:
                members.append({**u, "role": mr["role"]})

        out.append({
            **c,
            "members": members,
            "last_message": last_msg,
            "unread_count": unread,
            "is_muted": m.get("is_muted", False),
            "my_role": m.get("role", "member"),
            "pinned_at": m.get("pinned_at"),
        })

    return out


def _create_or_get_direct_chat(supabase, user_a: str, user_b: str) -> dict:
    """Idempotent direct-chat resolver.

    Returns the existing 1-1 chat between two users, or creates one and
    returns it. Handles the race where two concurrent requests both
    insert: the deterministic-winner cleanup keeps the smaller chat id
    and drops the loser (only if it has no messages).

    Extracted from ``create_chat`` so the ``/direct/with/{other}`` helper
    endpoint can reuse it without re-entering the FastAPI route (which
    would otherwise require building a Request object for the rate-limit
    decorator and passing the ChatCreate body manually).
    """
    existing = _find_existing_direct_chat(supabase, user_a, user_b)
    if existing:
        return existing

    new_chat = supabase.table("chats").insert({
        "type": "direct",
        "title": None,
        "created_by": user_a,
    }).execute().data[0]

    rows = [
        {"chat_id": new_chat["id"], "user_id": user_a, "role": "admin"},
        {"chat_id": new_chat["id"], "user_id": user_b, "role": "member"},
    ]
    supabase.table("chat_members").insert(rows).execute()

    # Race-recovery look-up — see create_chat for the full rationale.
    a_chats = supabase.table("chat_members").select("chat_id") \
        .eq("user_id", user_a).execute()
    a_ids = [r["chat_id"] for r in (a_chats.data or [])]
    b_in_same = supabase.table("chat_members").select("chat_id") \
        .eq("user_id", user_b).in_("chat_id", a_ids).execute()
    candidate_ids = []
    for r in (b_in_same.data or []):
        ct = supabase.table("chats").select("id, type, created_at") \
            .eq("id", r["chat_id"]).maybe_single().execute()
        if ct and ct.data and ct.data.get("type") == "direct":
            candidate_ids.append(ct.data["id"])
    if len(candidate_ids) > 1:
        winner = min(candidate_ids)
        losers = [cid for cid in candidate_ids if cid != winner]
        for loser in losers:
            msg_count = supabase.table("messages").select("id", count="exact") \
                .eq("chat_id", loser).limit(1).execute()
            if (msg_count.count or 0) == 0:
                supabase.table("chat_members").delete().eq("chat_id", loser).execute()
                supabase.table("chats").delete().eq("id", loser).execute()
        win_row = supabase.table("chats").select("*").eq("id", winner).single().execute()
        return win_row.data

    return new_chat


def _find_existing_direct_chat(supabase, user_a: str, user_b: str):
    """Return the existing direct chat row between two users, or None.

    Pulled out of create_chat so we can call it twice — once at the
    start (the optimistic happy path) and once after a failed insert
    (the race recovery path). Same SELECT logic both times.
    """
    a_chats = supabase.table("chat_members").select("chat_id").eq("user_id", user_a).execute()
    a_ids = [r["chat_id"] for r in (a_chats.data or [])]
    if not a_ids:
        return None
    b_in_same = supabase.table("chat_members").select("chat_id") \
        .eq("user_id", user_b).in_("chat_id", a_ids).execute()
    for r in (b_in_same.data or []):
        cid = r["chat_id"]
        ct = supabase.table("chats").select("*").eq("id", cid).maybe_single().execute()
        if ct and ct.data and ct.data.get("type") == "direct":
            return ct.data
    return None


@router.post("/", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
def create_chat(request: Request, body: ChatCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    if body.type not in ("direct", "group"):
        raise HTTPException(status_code=400, detail="Type must be 'direct' or 'group'")

    member_ids = list({uid for uid in body.member_ids if uid != current_user["id"]})
    if not member_ids:
        raise HTTPException(status_code=400, detail="At least one other member is required")

    if body.type == "direct":
        if len(member_ids) != 1:
            raise HTTPException(status_code=400, detail="Direct chats need exactly one other member")
        return _create_or_get_direct_chat(supabase, current_user["id"], member_ids[0])

    # Group chat — straightforward.
    new_chat = supabase.table("chats").insert({
        "type": body.type,
        "title": body.title,
        "created_by": current_user["id"],
    }).execute().data[0]

    rows = [{"chat_id": new_chat["id"], "user_id": current_user["id"], "role": "admin"}]
    for uid in member_ids:
        rows.append({"chat_id": new_chat["id"], "user_id": uid, "role": "member"})
    supabase.table("chat_members").insert(rows).execute()

    return new_chat


@router.get("/{chat_id}")
def get_chat(chat_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])

    chat = supabase.table("chats").select("*").eq("id", chat_id).single().execute().data
    members_res = supabase.table("chat_members").select("user_id, role, joined_at").eq("chat_id", chat_id).execute()
    user_ids = [m["user_id"] for m in (members_res.data or [])]
    users_res = supabase.table("users").select("id, name, avatar_url, department").in_("id", user_ids).execute() if user_ids else None
    users_map = {u["id"]: u for u in ((users_res.data if users_res else []) or [])}
    members = []
    for mr in (members_res.data or []):
        u = users_map.get(mr["user_id"])
        if u:
            members.append({**u, "role": mr["role"], "joined_at": mr["joined_at"]})
    chat["members"] = members
    return chat


@router.patch("/{chat_id}")
def update_chat(chat_id: str, body: ChatUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_admin(supabase, chat_id, current_user["id"])
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    supabase.table("chats").update(update).eq("id", chat_id).execute()
    return {"ok": True}


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def leave_or_delete_chat(chat_id: str, current_user: dict = Depends(get_current_user)):
    """Per-user remove:
    - Direct chat: hides for me only (other side keeps it)
    - Group chat: leaves the group (other members keep it)
    - Project chat: not allowed (tied to project membership)
    """
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    chat = supabase.table("chats").select("type").eq("id", chat_id).single().execute().data
    if chat["type"] == "project":
        raise HTTPException(status_code=400, detail="Cannot leave a project chat manually.")

    if chat["type"] == "direct":
        # Soft-hide for this user only
        supabase.table("chat_members").update({"hidden_at": datetime.now(timezone.utc).isoformat()}) \
            .eq("chat_id", chat_id).eq("user_id", current_user["id"]).execute()
        return

    # Group: leave (delete membership row)
    membership = supabase.table("chat_members").select("role").eq("chat_id", chat_id).eq("user_id", current_user["id"]).single().execute().data
    supabase.table("chat_members").delete().eq("chat_id", chat_id).eq("user_id", current_user["id"]).execute()
    remaining = supabase.table("chat_members").select("user_id, role").eq("chat_id", chat_id).execute()
    if not remaining.data:
        supabase.table("chats").delete().eq("id", chat_id).execute()
    elif membership and membership.get("role") == "admin" and not any(r["role"] == "admin" for r in remaining.data):
        supabase.table("chat_members").update({"role": "admin"}) \
            .eq("chat_id", chat_id).eq("user_id", remaining.data[0]["user_id"]).execute()


@router.delete("/{chat_id}/full", status_code=status.HTTP_204_NO_CONTENT)
def full_delete_chat(chat_id: str, current_user: dict = Depends(get_current_user)):
    """Permanently delete a group chat for everyone. Only:
    - The platform admin (current_user.role == 'admin'), OR
    - The chat's owner (creator) — chat_members.role == 'admin'
    can do this. Direct chats: each user uses /hide instead.
    """
    supabase = get_supabase_admin()
    chat = supabase.table("chats").select("type").eq("id", chat_id).single().execute().data
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if chat["type"] == "direct":
        raise HTTPException(status_code=400, detail="For direct chats, use the per-user delete instead.")
    if chat["type"] == "project":
        raise HTTPException(status_code=400, detail="Project chats are deleted with the project.")

    is_platform_admin = current_user.get("role") == "admin"
    is_group_admin = False
    if not is_platform_admin:
        m = supabase.table("chat_members").select("role").eq("chat_id", chat_id).eq("user_id", current_user["id"]).maybe_single().execute()
        if m and m.data and m.data.get("role") == "admin":
            is_group_admin = True
    if not (is_platform_admin or is_group_admin):
        raise HTTPException(status_code=403, detail="Only the group owner or a platform admin can fully delete this chat.")

    supabase.table("chats").delete().eq("id", chat_id).execute()


@router.get("/{chat_id}/files")
def list_chat_files(chat_id: str, current_user: dict = Depends(get_current_user)):
    """All messages in this chat that have an attachment, newest first.
    Powers the in-chat 'Files' panel (sent + received media archive)."""
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    res = supabase.table("messages").select(
        "id, sender_id, body, attachment_url, attachment_type, attachment_name, created_at"
    ).eq("chat_id", chat_id).is_("deleted_at", "null") \
     .not_.is_("attachment_url", "null") \
     .order("created_at", desc=True).limit(200).execute()
    msgs = res.data or []
    user_ids = list({m["sender_id"] for m in msgs})
    users_map = _hydrate_users(supabase, user_ids)
    for m in msgs:
        m["sender"] = users_map.get(m["sender_id"])
    return msgs


# ============================================================
# MEMBERS
# ============================================================
@router.post("/{chat_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(chat_id: str, body: MemberAdd, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_admin(supabase, chat_id, current_user["id"])
    chat = supabase.table("chats").select("type").eq("id", chat_id).single().execute().data
    if chat["type"] == "direct":
        raise HTTPException(status_code=400, detail="Cannot add members to a direct chat")

    exists = supabase.table("chat_members").select("user_id") \
        .eq("chat_id", chat_id).eq("user_id", body.user_id).maybe_single().execute()
    if exists and exists.data:
        raise HTTPException(status_code=400, detail="User is already a member")

    supabase.table("chat_members").insert({
        "chat_id": chat_id, "user_id": body.user_id, "role": "member",
    }).execute()
    return {"ok": True}


@router.delete("/{chat_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(chat_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_admin(supabase, chat_id, current_user["id"])
    chat = supabase.table("chats").select("type").eq("id", chat_id).single().execute().data
    if chat["type"] == "direct":
        raise HTTPException(status_code=400, detail="Cannot remove members from a direct chat")
    supabase.table("chat_members").delete().eq("chat_id", chat_id).eq("user_id", user_id).execute()


@router.patch("/{chat_id}/mute")
def toggle_mute(chat_id: str, body: MuteUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    supabase.table("chat_members").update({"is_muted": body.is_muted}) \
        .eq("chat_id", chat_id).eq("user_id", current_user["id"]).execute()
    return {"ok": True, "is_muted": body.is_muted}


@router.patch("/{chat_id}/pin")
def toggle_pin(chat_id: str, current_user: dict = Depends(get_current_user)):
    """Flip the pinned state for the current user. Per-user — only my
    own chat list ordering changes. Body is empty; the server decides
    whether this becomes a pin (set to NOW) or an unpin (set to NULL)
    based on the existing value so the client doesn't have to track it.
    """
    supabase = get_supabase_admin()
    row = _ensure_member(supabase, chat_id, current_user["id"])
    new_value = None if row.get("pinned_at") else datetime.now(timezone.utc).isoformat()
    supabase.table("chat_members").update({"pinned_at": new_value}) \
        .eq("chat_id", chat_id).eq("user_id", current_user["id"]).execute()
    return {"ok": True, "pinned_at": new_value}


@router.patch("/{chat_id}/read")
def mark_read(chat_id: str, body: MarkReadUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    ts = body.last_read_at or datetime.now(timezone.utc).isoformat()
    supabase.table("chat_members").update({"last_read_at": ts}) \
        .eq("chat_id", chat_id).eq("user_id", current_user["id"]).execute()
    return {"ok": True, "last_read_at": ts}


# ============================================================
# MESSAGES
# ============================================================
@router.get("/{chat_id}/messages")
def list_messages(
    chat_id: str,
    before: Optional[str] = None,
    limit: int = Query(50, le=100),
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])

    q = supabase.table("messages").select("*").eq("chat_id", chat_id) \
        .is_("deleted_at", "null").order("created_at", desc=True).limit(limit)
    if before:
        q = q.lt("created_at", before)
    res = q.execute()
    msgs = list(reversed(res.data or []))  # oldest first

    user_ids = [m["sender_id"] for m in msgs]
    users_map = _hydrate_users(supabase, user_ids)

    # batch reactions
    msg_ids = [m["id"] for m in msgs]
    rx_map = {}
    if msg_ids:
        rx = supabase.table("message_reactions").select("message_id, emoji, user_id").in_("message_id", msg_ids).execute()
        for r in (rx.data or []):
            rx_map.setdefault(r["message_id"], {}).setdefault(r["emoji"], []).append(r["user_id"])

    for m in msgs:
        m["sender"] = users_map.get(m["sender_id"])
        grouped = rx_map.get(m["id"], {})
        m["reactions"] = [{"emoji": k, "user_ids": v, "count": len(v)} for k, v in grouped.items()]

    return msgs


@router.post("/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
# 60/minute is one message per second on average — plenty for normal
# conversation, hard cap on bot-style flooding.
@limiter.limit("60/minute")
def send_message(request: Request, chat_id: str, body: MessageCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])

    if not body.body and not body.attachment_url:
        raise HTTPException(status_code=400, detail="Message must have body or attachment")

    payload = {
        "chat_id": chat_id,
        "sender_id": current_user["id"],
        "body": body.body,
        "attachment_url": body.attachment_url,
        "attachment_type": body.attachment_type,
        "attachment_name": body.attachment_name,
        "reply_to_id": body.reply_to_id,
    }
    msg = supabase.table("messages").insert(payload).execute().data[0]
    # If anyone hid this chat, unhide it for them — a new message brings it back
    try:
        supabase.table("chat_members").update({"hidden_at": None}) \
            .eq("chat_id", chat_id).neq("user_id", current_user["id"]).not_.is_("hidden_at", "null").execute()
    except Exception:
        pass

    # Mention notifications — only fire for user ids that are (1) not the
    # sender themselves and (2) actually members of this chat. The membership
    # check defends against a client tagging arbitrary user ids to spam them.
    if body.mentions:
        try:
            unique_targets = {uid for uid in body.mentions if uid != current_user["id"]}
            # Cap to MAX_MENTIONS_PER_MESSAGE. Set ordering isn't
            # deterministic but we don't need fairness here — any
            # subset is a refusal, not a partial success.
            if len(unique_targets) > MAX_MENTIONS_PER_MESSAGE:
                unique_targets = set(list(unique_targets)[:MAX_MENTIONS_PER_MESSAGE])
            if unique_targets:
                members = supabase.table("chat_members").select("user_id") \
                    .eq("chat_id", chat_id).in_("user_id", list(unique_targets)).execute()
                valid_ids = [m["user_id"] for m in (members.data or [])]
                if valid_ids:
                    chat_row = supabase.table("chats").select("title, type") \
                        .eq("id", chat_id).single().execute().data or {}
                    chat_label = chat_row.get("title") or (
                        "a direct chat" if chat_row.get("type") == "direct" else "a group chat"
                    )
                    snippet = (body.body or "").strip()
                    if len(snippet) > 140:
                        snippet = snippet[:137] + "..."
                    for uid in valid_ids:
                        send_notification(
                            user_id=uid,
                            type="chat_mention",
                            title=f"{current_user['name']} mentioned you",
                            body=f"In {chat_label}: {snippet}" if snippet else f"In {chat_label}",
                            link=f"/chats?chatId={chat_id}",
                        )
        except Exception as e:
            # Don't fail the send if the notification pass blew up.
            logger.error(f"MENTION NOTIFICATION ERROR: {e}")

    return _hydrate_message(supabase, msg)


@router.patch("/{chat_id}/messages/{message_id}")
def edit_message(chat_id: str, message_id: str, body: MessageEdit, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    msg = supabase.table("messages").select("sender_id, deleted_at").eq("id", message_id).single().execute().data
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["sender_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Only sender can edit")
    if msg.get("deleted_at"):
        raise HTTPException(status_code=400, detail="Cannot edit deleted message")
    supabase.table("messages").update({
        "body": body.body, "edited_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", message_id).execute()
    return {"ok": True}


@router.delete("/{chat_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(chat_id: str, message_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    membership = _ensure_member(supabase, chat_id, current_user["id"])
    msg = supabase.table("messages").select("sender_id").eq("id", message_id).single().execute().data
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["sender_id"] != current_user["id"] and membership["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    supabase.table("messages").update({"deleted_at": datetime.now(timezone.utc).isoformat()}).eq("id", message_id).execute()


# ============================================================
# REACTIONS
# ============================================================
@router.post("/{chat_id}/messages/{message_id}/reactions")
def toggle_reaction(chat_id: str, message_id: str, body: ReactionToggle, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    existing = supabase.table("message_reactions").select("*") \
        .eq("message_id", message_id).eq("user_id", current_user["id"]).eq("emoji", body.emoji).maybe_single().execute()
    if existing and existing.data:
        supabase.table("message_reactions").delete() \
            .eq("message_id", message_id).eq("user_id", current_user["id"]).eq("emoji", body.emoji).execute()
        return {"ok": True, "added": False}
    supabase.table("message_reactions").insert({
        "message_id": message_id, "user_id": current_user["id"], "emoji": body.emoji,
    }).execute()
    return {"ok": True, "added": True}


# ============================================================
# PIN
# ============================================================
@router.patch("/{chat_id}/messages/{message_id}/pin")
def toggle_pin(chat_id: str, message_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    msg = supabase.table("messages").select("is_pinned").eq("id", message_id).single().execute().data
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    new_state = not msg["is_pinned"]
    supabase.table("messages").update({"is_pinned": new_state}).eq("id", message_id).execute()
    return {"ok": True, "is_pinned": new_state}


@router.get("/{chat_id}/pinned")
def list_pinned(chat_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    res = supabase.table("messages").select("*").eq("chat_id", chat_id) \
        .eq("is_pinned", True).is_("deleted_at", "null").order("created_at", desc=True).execute()
    msgs = res.data or []
    users_map = _hydrate_users(supabase, [m["sender_id"] for m in msgs])
    for m in msgs:
        m["sender"] = users_map.get(m["sender_id"])
    return msgs


# ============================================================
# SEARCH
# ============================================================
@router.get("/{chat_id}/search")
def search_messages(chat_id: str, q: str = Query(..., min_length=1), current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])
    res = supabase.table("messages").select("*").eq("chat_id", chat_id) \
        .is_("deleted_at", "null").ilike("body", f"%{q}%").order("created_at", desc=True).limit(50).execute()
    msgs = res.data or []
    users_map = _hydrate_users(supabase, [m["sender_id"] for m in msgs])
    for m in msgs:
        m["sender"] = users_map.get(m["sender_id"])
    return msgs


# ============================================================
# MEDIA UPLOAD
# ============================================================
@router.post("/{chat_id}/upload")
# Uploads are 25 MB max each — 20/min still allows half a gigabyte
# per minute, but stops a runaway client from hammering storage.
@limiter.limit("20/minute")
async def upload_attachment(request: Request, chat_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _ensure_member(supabase, chat_id, current_user["id"])

    # MIME type whitelist (rejects executables, scripts, etc.)
    content_type = (file.content_type or "").lower()
    if not (
        any(content_type.startswith(p) for p in ALLOWED_MIME_PREFIXES)
        or content_type in ALLOWED_MIME_EXACT
    ):
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed: {content_type or 'unknown'}",
        )

    safe_name = (file.filename or "file").replace("/", "_").replace("\\", "_")[:200]
    object_path = f"{chat_id}/{uuid.uuid4().hex}_{safe_name}"

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024*1024)} MB)")
    try:
        supabase.storage.from_(CHAT_BUCKET).upload(
            object_path, contents,
            {"content-type": file.content_type or "application/octet-stream"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    # Generate a long-lived signed URL (7 days)
    try:
        signed = supabase.storage.from_(CHAT_BUCKET).create_signed_url(object_path, 60 * 60 * 24 * 7)
        url = signed.get("signedURL") or signed.get("signed_url") or signed.get("signedUrl")
    except Exception as e:
        logger.error(f"SIGN URL ERROR: {e}")
        raise HTTPException(status_code=500, detail="Could not generate signed URL")

    return {
        "url": url,
        "name": safe_name,
        "type": _detect_attachment_type(safe_name),
        "path": object_path,
    }


# ============================================================
# DM lookup helper (used by frontend "Message" button on profile, etc.)
# ============================================================
@router.get("/direct/with/{other_user_id}")
def get_or_create_direct(other_user_id: str, current_user: dict = Depends(get_current_user)):
    """Return the 1-1 chat between the caller and `other_user_id`, creating
    it if it doesn't exist yet. Used by the 'Message' button on profile
    pages — the frontend doesn't have to know whether a chat already
    exists.
    """
    if other_user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")
    supabase = get_supabase_admin()
    return _create_or_get_direct_chat(supabase, current_user["id"], other_user_id)
