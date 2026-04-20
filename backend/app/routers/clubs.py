from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from app.schemas.clubs import ClubCreate, ClubUpdate, MembershipStatusUpdate, ClubRequestCreate, ClubRequestReview, AnnouncementCreate
from app.schemas.notifications import send_notification
from app.core.supabase import get_supabase_admin
from app.core.security import get_current_user
from pydantic import BaseModel

router = APIRouter()


class RoleUpdate(BaseModel):
    role: str


# ── Club listing ──────────────────────────────────────────────
@router.get("/")
def list_clubs(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("clubs").select("*").order("created_at", desc=True).execute()
    # Filter: show active clubs or clubs without status set (legacy)
    all_clubs = result.data or []
    clubs = [c for c in all_clubs if c.get("status") in ("active", None, "")]
    # Attach member count
    for club in clubs:
        try:
            c = supabase.table("club_memberships").select("id", count="exact").eq("club_id", club["id"]).eq("status", "approved").execute()
            club["member_count"] = c.count or 0
        except Exception:
            club["member_count"] = 0
    return clubs


@router.get("/my-memberships")
def my_memberships(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("club_memberships").select("club_id, status, role").eq("user_id", current_user["id"]).execute()
    return result.data or []


@router.get("/{club_id}")
def get_club(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("clubs").select("*").eq("id", club_id).maybe_single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Club not found")
    club = result.data
    try:
        c = supabase.table("club_memberships").select("id", count="exact").eq("club_id", club_id).eq("status", "approved").execute()
        club["member_count"] = c.count or 0
    except Exception:
        club["member_count"] = 0
    return club


# ── Admin: direct club create ─────────────────────────────────
@router.post("/", status_code=status.HTTP_201_CREATED)
def create_club(body: ClubCreate, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create clubs directly")

    supabase = get_supabase_admin()
    result = supabase.table("clubs").insert({
        "name": body.name,
        "description": body.description,
        "category": body.category,
        "is_open": body.is_open,
        "admin_user_id": current_user["id"],
        "status": "active",
    }).execute()

    club = result.data[0]
    supabase.table("club_memberships").insert({
        "club_id": club["id"],
        "user_id": current_user["id"],
        "role": "president",
        "status": "approved",
    }).execute()
    return club


# ── Club Creation Request (student) ──────────────────────────
@router.post("/request", status_code=status.HTTP_201_CREATED)
def request_club(body: ClubRequestCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("club_requests").insert({
        "requester_id": current_user["id"],
        "club_name": body.club_name,
        "category": body.category,
        "description": body.description,
        "status": "pending",
    }).execute()
    return result.data[0]


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
    result = supabase.table("club_requests").select("*").eq("requester_id", current_user["id"]).order("created_at", desc=True).execute()
    return result.data or []


@router.patch("/review-request/{request_id}")
def review_club_request(request_id: str, body: ClubRequestReview, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected")

    supabase = get_supabase_admin()
    req = supabase.table("club_requests").select("*").eq("id", request_id).single().execute()
    if not req.data:
        raise HTTPException(status_code=404, detail="Request not found")

    supabase.table("club_requests").update({
        "status": body.status,
        "reviewed_by": current_user["id"],
        "review_note": body.review_note,
    }).eq("id", request_id).execute()

    if body.status == "approved":
        # Create the club
        club_result = supabase.table("clubs").insert({
            "name": req.data["club_name"],
            "description": req.data["description"],
            "category": req.data["category"],
            "is_open": True,
            "admin_user_id": req.data["requester_id"],
            "status": "active",
        }).execute()
        club = club_result.data[0]
        # Make requester president
        supabase.table("club_memberships").insert({
            "club_id": club["id"],
            "user_id": req.data["requester_id"],
            "role": "president",
            "status": "approved",
        }).execute()
        send_notification(
            user_id=req.data["requester_id"],
            type="club_request_result",
            title=f"Club request approved: {req.data['club_name']}",
            body=f"Your club '{req.data['club_name']}' has been approved! You are now the club president.",
            link=f"/clubs/{club['id']}",
        )
    else:
        send_notification(
            user_id=req.data["requester_id"],
            type="club_request_result",
            title=f"Club request rejected: {req.data['club_name']}",
            body=body.review_note or f"Your request to create '{req.data['club_name']}' was not approved.",
            link="/clubs",
        )

    return {"status": body.status}


# ── Club update / delete ──────────────────────────────────────
@router.put("/{club_id}")
def update_club(club_id: str, body: ClubUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = supabase.table("clubs").update(update_data).eq("id", club_id).execute()
    return result.data[0]


@router.delete("/{club_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_club(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    supabase.table("clubs").delete().eq("id", club_id).execute()


# ── Membership ────────────────────────────────────────────────
@router.post("/{club_id}/join", status_code=status.HTTP_201_CREATED)
def join_club(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("*").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")

    existing = supabase.table("club_memberships").select("id, status").eq("club_id", club_id).eq("user_id", current_user["id"]).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Already a member or request pending")

    membership_status = "approved" if club.data["is_open"] else "pending"
    result = supabase.table("club_memberships").insert({
        "club_id": club_id,
        "user_id": current_user["id"],
        "role": "member",
        "status": membership_status,
    }).execute()

    if membership_status == "pending":
        send_notification(
            user_id=club.data["admin_user_id"],
            type="club_application",
            title="New membership request",
            body=f"{current_user['name']} requested to join {club.data['name']}.",
            link=f"/clubs/{club_id}",
        )

    return {"status": membership_status, "is_open": club.data["is_open"]}


@router.delete("/{club_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_club(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    supabase.table("club_memberships").delete().eq("club_id", club_id).eq("user_id", current_user["id"]).execute()


@router.get("/{club_id}/members")
def get_members(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    memberships = supabase.table("club_memberships").select("*").eq("club_id", club_id).execute()
    members = memberships.data or []
    # Enrich with user info
    for m in members:
        try:
            u = supabase.table("users").select("name, email, avatar_url, department, year").eq("id", m["user_id"]).single().execute()
            if u.data:
                m.update(u.data)
        except Exception:
            pass
    return members


@router.patch("/{club_id}/members/{user_id}")
def update_member_status(club_id: str, user_id: str, body: MembershipStatusUpdate, current_user: dict = Depends(get_current_user)):
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected")

    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("name, admin_user_id").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    result = supabase.table("club_memberships").update({"status": body.status}).eq("club_id", club_id).eq("user_id", user_id).execute()
    send_notification(
        user_id=user_id,
        type="club_application_result",
        title=f"Membership request {body.status}",
        body=f"Your request to join {club.data['name']} has been {body.status}.",
        link=f"/clubs/{club_id}",
    )
    return result.data[0]


@router.delete("/{club_id}/members/{user_id}/remove", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(club_id: str, user_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id, name").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    supabase.table("club_memberships").delete().eq("club_id", club_id).eq("user_id", user_id).execute()
    send_notification(
        user_id=user_id,
        type="club_application_result",
        title="Removed from club",
        body=f"You have been removed from {club.data['name']}.",
        link="/clubs",
    )


@router.patch("/{club_id}/members/{user_id}/role")
def update_member_role(club_id: str, user_id: str, body: RoleUpdate, current_user: dict = Depends(get_current_user)):
    if body.role not in ("member", "admin", "president"):
        raise HTTPException(status_code=400, detail="Role must be member, admin or president")

    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    result = supabase.table("club_memberships").update({"role": body.role}).eq("club_id", club_id).eq("user_id", user_id).execute()
    return result.data[0]


# ── Announcements ─────────────────────────────────────────────
@router.get("/{club_id}/announcements")
def get_announcements(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("club_announcements").select("*").eq("club_id", club_id).order("created_at", desc=True).execute()
    return result.data or []


@router.post("/{club_id}/announcements", status_code=status.HTTP_201_CREATED)
def create_announcement(club_id: str, body: AnnouncementCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id, name").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only club admins can post announcements")

    result = supabase.table("club_announcements").insert({
        "club_id": club_id,
        "author_id": current_user["id"],
        "title": body.title,
        "content": body.content,
    }).execute()

    # Notify all approved members
    members = supabase.table("club_memberships").select("user_id").eq("club_id", club_id).eq("status", "approved").execute()
    for m in (members.data or []):
        if m["user_id"] != current_user["id"]:
            send_notification(
                user_id=m["user_id"],
                type="club_announcement",
                title=f"New announcement: {body.title}",
                body=f"{club.data['name']}: {body.content[:100]}",
                link=f"/clubs/{club_id}",
            )
    return result.data[0]


@router.delete("/{club_id}/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(club_id: str, announcement_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    supabase.table("club_announcements").delete().eq("id", announcement_id).execute()


# ── Cover image upload ────────────────────────────────────────
@router.post("/{club_id}/upload-cover")
async def upload_cover(club_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    file_content = await file.read()
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    file_path = f"{club_id}/cover.{ext}"

    try:
        supabase.storage.from_("club-covers").remove([file_path])
    except Exception:
        pass

    supabase.storage.from_("club-covers").upload(
        path=file_path,
        file=file_content,
        file_options={"content-type": file.content_type, "upsert": "true"},
    )
    cover_url = supabase.storage.from_("club-covers").get_public_url(file_path)
    supabase.table("clubs").update({"cover_url": cover_url}).eq("id", club_id).execute()
    return {"cover_url": cover_url}


# ── Video upload ──────────────────────────────────────────────
@router.post("/{club_id}/upload-video")
async def upload_club_video(club_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    file_content = await file.read()
    file_path = f"{club_id}/intro.mp4"
    try:
        supabase.storage.from_("club-videos").remove([file_path])
    except Exception:
        pass

    supabase.storage.from_("club-videos").upload(
        path=file_path,
        file=file_content,
        file_options={"content-type": file.content_type, "upsert": "true"},
    )
    video_url = supabase.storage.from_("club-videos").get_public_url(file_path)
    supabase.table("clubs").update({"video_url": video_url}).eq("id", club_id).execute()
    return {"video_url": video_url}


@router.delete("/{club_id}/delete-video", status_code=status.HTTP_204_NO_CONTENT)
def delete_club_video(club_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    club = supabase.table("clubs").select("admin_user_id").eq("id", club_id).single().execute()
    if not club.data:
        raise HTTPException(status_code=404, detail="Club not found")
    if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        supabase.storage.from_("club-videos").remove([f"{club_id}/intro.mp4"])
    except Exception:
        pass
    supabase.table("clubs").update({"video_url": None}).eq("id", club_id).execute()