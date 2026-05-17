import re
from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File, Request
from app.schemas.clubs import ClubCreate, ClubUpdate, MembershipStatusUpdate, ClubRequestCreate, ClubRequestReview, AnnouncementCreate
from app.schemas.notifications import send_notification
from app.core.supabase import get_supabase_admin
from app.core.security import get_current_user
from app.core.ratelimit import limiter
from pydantic import BaseModel

router = APIRouter()


class RoleUpdate(BaseModel):
    role: str


def get_club_or_404(supabase, club_id: str) -> dict:
    result = supabase.table("clubs").select("*").eq("id", club_id).maybe_single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Club not found")
    return result.data


def get_member_role(supabase, club_id: str, user_id: str) -> str | None:
    result = supabase.table("club_memberships").select("role, status") \
        .eq("club_id", club_id).eq("user_id", user_id).eq("status", "approved").execute()
    if result.data:
        return result.data[0]["role"]
    return None


def is_club_manager(supabase, club: dict, current_user: dict) -> bool:
    if current_user["role"] == "admin":
        return True
    if club["admin_user_id"] == current_user["id"]:
        return True
    role = get_member_role(supabase, club["id"], current_user["id"])
    return role == "president"


def notify_platform_admins(supabase, *, type: str, title: str, body: str, link: str | None = None):
    """Send a notification to every platform admin user."""
    try:
        admins = supabase.table("users").select("id").eq("role", "admin").execute()
        for a in (admins.data or []):
            send_notification(user_id=a["id"], type=type, title=title, body=body, link=link)
    except Exception as e:
        print("notify_platform_admins error:", e)


def require_club_manager(supabase, club_id: str, current_user: dict) -> dict:
    club = get_club_or_404(supabase, club_id)
    if not is_club_manager(supabase, club, current_user):
        raise HTTPException(status_code=403, detail="Club manager access required")
    return club


@router.get("/")
def list_clubs(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    # Filter active clubs at the database layer. The previous version
    # fetched every row (including rejected/pending) then discarded most
    # in Python. We still need a defensive Python filter for legacy rows
    # whose `status` is NULL or "" — those should still show up.
    result = (
        supabase.table("clubs")
        .select("*, club_memberships(count)")
        .or_("status.eq.active,status.is.null,status.eq.")
        .order("created_at", desc=True)
        .execute()
    )
    clubs = result.data or []
    # Extract member count from joined data
    for club in clubs:
        memberships = club.pop("club_memberships", [])
        club["member_count"] = memberships[0]["count"] if memberships else 0
    return clubs


@router.get("/my-memberships")
def my_memberships(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("club_memberships").select("club_id, status, role") \
        .eq("user_id", current_user["id"]).execute()
    return result.data or []


@router.get("/admin-requests")
def list_club_requests(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    supabase = get_supabase_admin()
    result = supabase.table("club_requests").select("*").order("created_at", desc=True).execute()
    return result.data or []


@router.get("/my-requests")
def my_club_requests(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("club_requests").select("*") \
        .eq("requester_id", current_user["id"]).order("created_at", desc=True).execute()
    return result.data or []


@router.get("/{club_id}")
def get_club(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = get_club_or_404(supabase, club_id)
    try:
        c = supabase.table("club_memberships").select("id", count="exact") \
            .eq("club_id", club_id).eq("status", "approved").execute()
        club["member_count"] = c.count or 0
    except Exception:
        club["member_count"] = 0
    return club


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_club(body: ClubCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create clubs directly")
    supabase = get_supabase_admin()
    result = supabase.table("clubs").insert({
        "name": body.name, "description": body.description,
        "category": body.category, "is_open": body.is_open,
        "admin_user_id": current_user["id"], "status": "active",
    }).execute()
    club = result.data[0]
    supabase.table("club_memberships").insert({
        "club_id": club["id"], "user_id": current_user["id"],
        "role": "president", "status": "approved",
    }).execute()
    return club


@router.post("/request", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
def request_club(request: Request, body: ClubRequestCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    # Reject if user already has a pending request — prevents notification spam
    existing = (
        supabase.table("club_requests")
        .select("id")
        .eq("requester_id", current_user["id"])
        .eq("status", "pending")
        .execute()
    )
    if existing.data and len(existing.data) >= 3:
        raise HTTPException(
            status_code=429,
            detail="You already have 3 pending club requests. Please wait for them to be reviewed.",
        )

    result = supabase.table("club_requests").insert({
        "requester_id": current_user["id"],
        "club_name": body.club_name,
        "category": body.category,
        "description": body.description,
        "motivation": body.motivation,
        "is_open": body.is_open,
        "status": "pending",
    }).execute()
    # Notify all platform admins
    notify_platform_admins(
        supabase,
        type="club_request",
        title="New club request",
        body=f"{current_user['name']} requested a new club: \"{body.club_name}\".",
        link="/clubs?tab=requests",
    )
    return result.data[0]


@router.patch("/review-request/{request_id}")
def review_club_request(request_id: str, body: ClubRequestReview, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected")
    # Rejection without a reason is bad UX — the requester deserves to know
    # why. Mirror the same rule we use on project application rejections.
    if body.status == "rejected" and not (body.review_note and body.review_note.strip()):
        raise HTTPException(
            status_code=400,
            detail="A rejection reason is required.",
        )

    supabase = get_supabase_admin()
    req = supabase.table("club_requests").select("*").eq("id", request_id).single().execute()
    if not req.data:
        raise HTTPException(status_code=404, detail="Request not found")
    supabase.table("club_requests").update({
        "status": body.status, "reviewed_by": current_user["id"], "review_note": body.review_note,
    }).eq("id", request_id).execute()
    if body.status == "approved":
        # Carry the requester's is_open preference into the created club.
        # Defaults to True for legacy rows that don't have the column set.
        is_open = req.data.get("is_open")
        if is_open is None:
            is_open = True
        club_result = supabase.table("clubs").insert({
            "name": req.data["club_name"], "description": req.data["description"],
            "category": req.data["category"], "is_open": is_open,
            "admin_user_id": req.data["requester_id"], "status": "active",
        }).execute()
        club = club_result.data[0]
        supabase.table("club_memberships").insert({
            "club_id": club["id"], "user_id": req.data["requester_id"],
            "role": "president", "status": "approved",
        }).execute()
        send_notification(user_id=req.data["requester_id"], type="club_request_result",
            title=f"Club request approved: {req.data['club_name']}",
            body=f"Your club '{req.data['club_name']}' has been approved! You are now the club president.",
            link=f"/clubs/{club['id']}")
    else:
        notif_body = f"Your request to create '{req.data['club_name']}' was rejected."
        if body.review_note:
            notif_body += f" Reason: {body.review_note}"
        send_notification(user_id=req.data["requester_id"], type="club_request_result",
            title=f"Club request rejected: {req.data['club_name']}",
            body=notif_body,
            link="/clubs")
    return {"status": body.status}


@router.put("/{club_id}")
def update_club(club_id: str, body: ClubUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    require_club_manager(supabase, club_id, current_user)
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = supabase.table("clubs").update(update_data).eq("id", club_id).execute()
    return result.data[0]


@router.delete("/{club_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_club(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = get_club_or_404(supabase, club_id)
    if current_user["role"] != "admin" and club["admin_user_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Only platform admin can delete clubs")
    supabase.table("clubs").delete().eq("id", club_id).execute()


@router.post("/{club_id}/join", status_code=status.HTTP_201_CREATED)
# 20/minute is comfortable for genuine browsing; blocks click-spam.
@limiter.limit("20/minute")
def join_club(request: Request, club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = get_club_or_404(supabase, club_id)
    existing = supabase.table("club_memberships").select("id, status") \
        .eq("club_id", club_id).eq("user_id", current_user["id"]).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Already a member or request pending")
    membership_status = "approved" if club["is_open"] else "pending"
    result = supabase.table("club_memberships").insert({
        "club_id": club_id, "user_id": current_user["id"],
        "role": "member", "status": membership_status,
    }).execute()
    if membership_status == "pending":
        send_notification(user_id=club["admin_user_id"], type="club_application",
            title="New membership request",
            body=f"{current_user['name']} requested to join {club['name']}.",
            link=f"/clubs/{club_id}")
    return {"status": membership_status, "is_open": club["is_open"]}


@router.delete("/{club_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_club(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    supabase.table("club_memberships").delete() \
        .eq("club_id", club_id).eq("user_id", current_user["id"]).execute()


@router.get("/{club_id}/members")
def get_members(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    # Single query with user join
    memberships = supabase.table("club_memberships").select("*, users(name, email, avatar_url, department, year)") \
        .eq("club_id", club_id).execute()
    members = memberships.data or []
    for m in members:
        user_data = m.pop("users", None)
        if user_data:
            m.update(user_data)
    return members


@router.patch("/{club_id}/members/{user_id}")
def update_member_status(club_id: str, user_id: str, body: MembershipStatusUpdate,
                         current_user: dict = Depends(get_current_user)):
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected")
    supabase = get_supabase_admin()
    club = require_club_manager(supabase, club_id, current_user)
    result = supabase.table("club_memberships").update({"status": body.status}) \
        .eq("club_id", club_id).eq("user_id", user_id).execute()
    send_notification(user_id=user_id, type="club_application_result",
        title=f"Membership request {body.status}",
        body=f"Your request to join {club['name']} has been {body.status}.",
        link=f"/clubs/{club_id}")
    return result.data[0]


@router.delete("/{club_id}/members/{user_id}/remove", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(club_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = require_club_manager(supabase, club_id, current_user)
    supabase.table("club_memberships").delete() \
        .eq("club_id", club_id).eq("user_id", user_id).execute()
    send_notification(user_id=user_id, type="club_application_result",
        title="Removed from club", body=f"You have been removed from {club['name']}.",
        link="/clubs")


@router.patch("/{club_id}/members/{user_id}/role")
def update_member_role(club_id: str, user_id: str, body: RoleUpdate,
                       current_user: dict = Depends(get_current_user)):
    """Allowed roles: 'member' or 'president'.
    - Setting someone to 'president' atomically demotes the previous president
      to 'member' (a club has exactly one president).
    - Only platform admins (or the club president) can change roles.
    """
    if body.role not in ("member", "president"):
        raise HTTPException(status_code=400, detail="Role must be 'member' or 'president'")
    supabase = get_supabase_admin()
    club = require_club_manager(supabase, club_id, current_user)

    # If promoting to president → demote current president to member first
    if body.role == "president":
        # Only platform admin can transfer presidency
        if current_user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only platform admin can transfer presidency")
        existing_president = supabase.table("club_memberships").select("user_id") \
            .eq("club_id", club_id).eq("role", "president").execute()
        for p in (existing_president.data or []):
            if p["user_id"] != user_id:
                supabase.table("club_memberships").update({"role": "member"}) \
                    .eq("club_id", club_id).eq("user_id", p["user_id"]).execute()
                # Notify the demoted president
                send_notification(user_id=p["user_id"], type="club_application_result",
                    title=f"You are no longer president of {club['name']}",
                    body=f"A platform admin has transferred the presidency.",
                    link=f"/clubs/{club_id}")
        # Update club admin_user_id to point to new president
        supabase.table("clubs").update({"admin_user_id": user_id}).eq("id", club_id).execute()
        # Notify the new president
        send_notification(user_id=user_id, type="club_application_result",
            title=f"You are now the president of {club['name']}",
            body=f"You have been assigned as the president of {club['name']}.",
            link=f"/clubs/{club_id}")

    result = supabase.table("club_memberships").update({"role": body.role}) \
        .eq("club_id", club_id).eq("user_id", user_id).execute()
    return result.data[0] if result.data else {"role": body.role}


@router.get("/{club_id}/announcements")
def get_announcements(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("club_announcements").select("*") \
        .eq("club_id", club_id).order("created_at", desc=True).execute()
    return result.data or []


@router.post("/{club_id}/announcements", status_code=status.HTTP_201_CREATED)
# Announcements fan out to every member as a notification — 10/min is
# generous for legitimate posting, prevents spam-blast.
@limiter.limit("10/minute")
def create_announcement(request: Request, club_id: str, body: AnnouncementCreate,
                        current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = require_club_manager(supabase, club_id, current_user)
    result = supabase.table("club_announcements").insert({
        "club_id": club_id, "author_id": current_user["id"],
        "title": body.title, "content": body.content,
    }).execute()
    members = supabase.table("club_memberships").select("user_id") \
        .eq("club_id", club_id).eq("status", "approved").execute()
    for m in (members.data or []):
        if m["user_id"] != current_user["id"]:
            send_notification(user_id=m["user_id"], type="club_announcement",
                title=f"New announcement: {body.title}",
                body=f"{club['name']}: {body.content[:100]}",
                link=f"/clubs/{club_id}")
    return result.data[0]


@router.delete("/{club_id}/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(club_id: str, announcement_id: str,
                        current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    require_club_manager(supabase, club_id, current_user)
    supabase.table("club_announcements").delete().eq("id", announcement_id).execute()


# Upload size + MIME guards. Without these the endpoints below would
# happily accept a 1 GB binary file from any club manager — both a
# storage-cost and a DoS surface.
MAX_COVER_BYTES = 8 * 1024 * 1024     # 8 MB — generous for any photo
MAX_VIDEO_BYTES = 100 * 1024 * 1024   # 100 MB — short intro clip
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_VIDEO_MIMES = {"video/mp4", "video/webm", "video/quicktime"}
SAFE_EXT_PATTERN = re.compile(r"^[A-Za-z0-9]{1,8}$")


def _validated_ext(filename: str, fallback: str) -> str:
    """Strip a clean extension off `filename`. Falls back to a known-safe
    default so a missing/exotic extension can't yield `cover.` or
    `cover.PHP`-style storage keys."""
    if "." in (filename or ""):
        candidate = filename.rsplit(".", 1)[-1].lower()
        if SAFE_EXT_PATTERN.match(candidate):
            return candidate
    return fallback


@router.post("/{club_id}/upload-cover")
@limiter.limit("10/minute")
async def upload_cover(request: Request, club_id: str, file: UploadFile = File(...),
                       current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    require_club_manager(supabase, club_id, current_user)

    if (file.content_type or "").lower() not in ALLOWED_IMAGE_MIMES:
        raise HTTPException(status_code=415, detail="Cover must be a JPG, PNG, WebP or GIF image.")
    file_content = await file.read()
    if not file_content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_content) > MAX_COVER_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Cover image too large. Max {MAX_COVER_BYTES // (1024 * 1024)} MB.",
        )

    ext = _validated_ext(file.filename or "", "jpg")
    file_path = f"{club_id}/cover.{ext}"
    try:
        supabase.storage.from_("club-covers").remove([file_path])
    except Exception:
        pass
    supabase.storage.from_("club-covers").upload(
        path=file_path, file=file_content,
        file_options={"content-type": file.content_type, "upsert": "true"})
    cover_url = supabase.storage.from_("club-covers").get_public_url(file_path)
    supabase.table("clubs").update({"cover_url": cover_url}).eq("id", club_id).execute()
    return {"cover_url": cover_url}


@router.post("/{club_id}/upload-video")
# Video uploads are up to 100 MB; 5/min cap is a hard ceiling.
@limiter.limit("5/minute")
async def upload_club_video(request: Request, club_id: str, file: UploadFile = File(...),
                            current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    require_club_manager(supabase, club_id, current_user)

    if (file.content_type or "").lower() not in ALLOWED_VIDEO_MIMES:
        raise HTTPException(status_code=415, detail="Intro video must be MP4, WebM, or MOV.")
    file_content = await file.read()
    if not file_content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_content) > MAX_VIDEO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Video too large. Max {MAX_VIDEO_BYTES // (1024 * 1024)} MB.",
        )

    file_path = f"{club_id}/intro.mp4"
    try:
        supabase.storage.from_("club-videos").remove([file_path])
    except Exception:
        pass
    supabase.storage.from_("club-videos").upload(
        path=file_path, file=file_content,
        file_options={"content-type": file.content_type, "upsert": "true"})
    video_url = supabase.storage.from_("club-videos").get_public_url(file_path)
    supabase.table("clubs").update({"video_url": video_url}).eq("id", club_id).execute()
    return {"video_url": video_url}


@router.delete("/{club_id}/delete-video", status_code=status.HTTP_204_NO_CONTENT)
def delete_club_video(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    require_club_manager(supabase, club_id, current_user)
    try:
        supabase.storage.from_("club-videos").remove([f"{club_id}/intro.mp4"])
    except Exception:
        pass
    supabase.table("clubs").update({"video_url": None}).eq("id", club_id).execute()