from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from app.schemas.events import EventCreate, EventUpdate
from app.schemas.notifications import send_notification
from app.core.supabase import get_supabase_admin
from app.core.security import get_current_user

router = APIRouter()


def _with_attendee_count(supabase, events: list) -> list:
    for event in events:
        try:
            c = supabase.table("event_attendees").select("id", count="exact").eq("event_id", event["id"]).execute()
            event["attendee_count"] = c.count or 0
        except Exception:
            event["attendee_count"] = 0
    return events


@router.get("/")
def list_events(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("events").select("*").order("event_date").execute()
    all_events = result.data or []

    # Get clubs the user is a member of
    memberships = supabase.table("club_memberships").select("club_id").eq("user_id", current_user["id"]).eq("status", "approved").execute()
    my_club_ids = {m["club_id"] for m in (memberships.data or [])}

    # Filter: show event if:
    # - not members_only (visible to all)
    # - members_only but user is a member of that club
    # - user is admin (sees everything)
    visible = []
    for e in all_events:
        if current_user["role"] == "admin":
            visible.append(e)
        elif e.get("is_members_only") and e.get("club_id") not in my_club_ids:
            continue  # hide members-only event from non-members
        else:
            visible.append(e)

    return _with_attendee_count(supabase, visible)


@router.get("/my-attending")
def my_attending(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("event_attendees").select("event_id").eq("user_id", current_user["id"]).execute()
    return result.data


@router.get("/{event_id}")
def get_event(event_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("events").select("*").eq("id", event_id).maybe_single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Event not found")
    event = result.data
    try:
        c = supabase.table("event_attendees").select("id", count="exact").eq("event_id", event_id).execute()
        event["attendee_count"] = c.count or 0
    except Exception:
        event["attendee_count"] = 0
    return event


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_event(body: EventCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    if body.is_school_wide and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create school-wide events")

    if body.club_id:
        club = supabase.table("clubs").select("admin_user_id, name").eq("id", body.club_id).single().execute()
        if not club.data:
            raise HTTPException(status_code=404, detail="Club not found")
        if club.data["admin_user_id"] != current_user["id"] and current_user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only club admins can create club events")

    result = supabase.table("events").insert({
        "title": body.title,
        "description": body.description,
        "club_id": body.club_id,
        "created_by": current_user["id"],
        "event_date": body.event_date.isoformat(),
        "location": body.location,
        "capacity": body.capacity,
        "is_school_wide": body.is_school_wide,
        "is_members_only": body.is_members_only,
    }).execute()

    event = result.data[0]

    # Notify all students for school-wide events
    if body.is_school_wide:
        users = supabase.table("users").select("id").eq("role", "student").execute()
        for user in (users.data or []):
            send_notification(
                user_id=user["id"],
                type="new_school_event",
                title=f"New school event: {body.title}",
                body=f"{body.title} on {body.event_date.strftime('%b %d')} at {body.location}.",
                link=f"/events/{event['id']}",
            )

    # Notify club members for club events
    if body.club_id:
        members = supabase.table("club_memberships").select("user_id").eq("club_id", body.club_id).eq("status", "approved").execute()
        for member in (members.data or []):
            if member["user_id"] != current_user["id"]:
                send_notification(
                    user_id=member["user_id"],
                    type="new_club_event",
                    title=f"New event: {body.title}",
                    body=f"Your club has a new event on {body.event_date.strftime('%b %d')} at {body.location}.",
                    link=f"/events/{event['id']}",
                )

    return event


@router.put("/{event_id}")
def update_event(event_id: str, body: EventUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    event = supabase.table("events").select("created_by").eq("id", event_id).single().execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.data["created_by"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "event_date" in update_data:
        update_data["event_date"] = update_data["event_date"].isoformat()

    result = supabase.table("events").update(update_data).eq("id", event_id).execute()
    return result.data[0]


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    event = supabase.table("events").select("created_by").eq("id", event_id).single().execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.data["created_by"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    supabase.table("events").delete().eq("id", event_id).execute()


@router.post("/{event_id}/attend", status_code=status.HTTP_201_CREATED)
def attend_event(event_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    event = supabase.table("events").select("*").eq("id", event_id).single().execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    existing = supabase.table("event_attendees").select("id").eq("event_id", event_id).eq("user_id", current_user["id"]).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Already attending")

    result = supabase.table("event_attendees").insert({
        "event_id": event_id,
        "user_id": current_user["id"],
    }).execute()
    return result.data[0]


@router.delete("/{event_id}/attend", status_code=status.HTTP_204_NO_CONTENT)
def cancel_attendance(event_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    supabase.table("event_attendees").delete().eq("event_id", event_id).eq("user_id", current_user["id"]).execute()


@router.get("/{event_id}/attendees")
def get_attendees(event_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("event_attendees").select("*").eq("event_id", event_id).execute()
    return result.data


@router.post("/{event_id}/upload-cover")
async def upload_event_cover(event_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    event = supabase.table("events").select("created_by").eq("id", event_id).single().execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.data["created_by"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    file_content = await file.read()
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    file_path = f"{event_id}/cover.{ext}"

    try:
        supabase.storage.from_("event-covers").remove([file_path])
    except Exception:
        pass

    supabase.storage.from_("event-covers").upload(
        path=file_path,
        file=file_content,
        file_options={"content-type": file.content_type, "upsert": "true"},
    )
    cover_url = supabase.storage.from_("event-covers").get_public_url(file_path)
    supabase.table("events").update({"cover_url": cover_url}).eq("id", event_id).execute()
    return {"cover_url": cover_url}