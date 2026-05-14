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
    result = supabase.table("events").select("*, event_attendees(count)").order("event_date").execute()
    all_events = result.data or []

    # Get clubs the user is a member of
    memberships = supabase.table("club_memberships").select("club_id") \
        .eq("user_id", current_user["id"]).eq("status", "approved").execute()
    my_club_ids = {m["club_id"] for m in (memberships.data or [])}

    visible = []
    for e in all_events:
        attendees = e.pop("event_attendees", [])
        e["attendee_count"] = attendees[0]["count"] if attendees else 0
        if current_user["role"] == "admin":
            visible.append(e)
        elif e.get("is_members_only") and e.get("club_id") not in my_club_ids:
            continue
        else:
            visible.append(e)

    return visible


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
        # Check if user is platform admin, club creator, or club president/admin
        is_manager = current_user["role"] == "admin" or club.data["admin_user_id"] == current_user["id"]
        if not is_manager:
            member = supabase.table("club_memberships").select("role").eq("club_id", body.club_id).eq("user_id", current_user["id"]).eq("status", "approved").execute()
            if member.data and member.data[0]["role"] in ("president", "admin"):
                is_manager = True
        if not is_manager:
            raise HTTPException(status_code=403, detail="Only club managers can create club events")

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
    event = supabase.table("events").select("created_by, club_id").eq("id", event_id).single().execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    is_authorized = (
        current_user["role"] == "admin" or
        event.data["created_by"] == current_user["id"]
    )
    # Also allow club president/admin to delete their club's events
    if not is_authorized and event.data.get("club_id"):
        member = supabase.table("club_memberships").select("role") \
            .eq("club_id", event.data["club_id"]) \
            .eq("user_id", current_user["id"]) \
            .eq("status", "approved").execute()
        if member.data and member.data[0]["role"] in ("president", "admin"):
            is_authorized = True

    if not is_authorized:
        raise HTTPException(status_code=403, detail="Not authorized")
    supabase.table("events").delete().eq("id", event_id).execute()


def _is_event_manager(supabase, event_row: dict, current_user: dict) -> bool:
    """True if the user can see/manage attendees for this event.

    Eligible: platform admin, event creator, or president of the linked
    club. Other club members (regular, vice president if we add one) are
    explicitly NOT included — only the elected president gets the list.
    """
    if current_user.get("role") == "admin":
        return True
    if event_row.get("created_by") == current_user["id"]:
        return True
    club_id = event_row.get("club_id")
    if not club_id:
        return False
    try:
        mem = (
            supabase.table("club_memberships")
            .select("role, status")
            .eq("club_id", club_id)
            .eq("user_id", current_user["id"])
            .maybe_single()
            .execute()
        )
        if mem and mem.data and mem.data.get("role") == "president" and mem.data.get("status") == "approved":
            return True
    except Exception:
        pass
    return False


@router.post("/{event_id}/attend", status_code=status.HTTP_201_CREATED)
def attend_event(event_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    event = supabase.table("events").select("*").eq("id", event_id).single().execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")

    existing = supabase.table("event_attendees").select("id").eq("event_id", event_id).eq("user_id", current_user["id"]).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Already attending")

    # Capacity enforcement — capacity NULL means uncapped (legacy behaviour).
    capacity = event.data.get("capacity")
    if capacity is not None and isinstance(capacity, int) and capacity > 0:
        try:
            count_res = (
                supabase.table("event_attendees")
                .select("id", count="exact")
                .eq("event_id", event_id)
                .execute()
            )
            current = count_res.count or 0
        except Exception:
            current = 0
        if current >= capacity:
            raise HTTPException(
                status_code=409,
                detail="This event is full. Try another one or check back if a spot opens up.",
            )

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
    """List attendees for an event with hydrated user info.

    Restricted to platform admins, the event creator, and the linked
    club's president. Other students can't enumerate the list — that's
    personally identifiable info and only the people running the event
    have a reason to see it.
    """
    supabase = get_supabase_admin()
    event = supabase.table("events").select("id, created_by, club_id, title").eq("id", event_id).single().execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")
    if not _is_event_manager(supabase, event.data, current_user):
        raise HTTPException(status_code=403, detail="Only the event organiser can view the attendee list.")

    rows = (
        supabase.table("event_attendees")
        .select("id, user_id, created_at")
        .eq("event_id", event_id)
        .order("created_at", desc=False)
        .execute()
    )
    raw = rows.data or []
    if not raw:
        return []

    user_ids = list({r["user_id"] for r in raw if r.get("user_id")})
    users_map: dict = {}
    try:
        u_res = (
            supabase.table("users")
            .select("id, name, email, department, year, avatar_url")
            .in_("id", user_ids)
            .execute()
        )
        users_map = {u["id"]: u for u in (u_res.data or [])}
    except Exception:
        users_map = {}

    return [
        {
            **r,
            "user": users_map.get(r["user_id"]),
        }
        for r in raw
    ]


@router.get("/{event_id}/attendees/export")
def export_attendees_csv(event_id: str, current_user: dict = Depends(get_current_user)):
    """CSV download of the attendee list. Same authorisation as the JSON
    listing — admin / event creator / club president only.

    Columns: Name, Email, Department, Year, RSVP'd At.
    """
    import csv
    import io
    from datetime import datetime
    from fastapi.responses import StreamingResponse

    supabase = get_supabase_admin()
    event = supabase.table("events").select("id, created_by, club_id, title").eq("id", event_id).single().execute()
    if not event.data:
        raise HTTPException(status_code=404, detail="Event not found")
    if not _is_event_manager(supabase, event.data, current_user):
        raise HTTPException(status_code=403, detail="Only the event organiser can export the attendee list.")

    rows = (
        supabase.table("event_attendees")
        .select("user_id, created_at")
        .eq("event_id", event_id)
        .order("created_at", desc=False)
        .execute()
    )
    raw = rows.data or []

    users_map: dict = {}
    if raw:
        try:
            u_res = (
                supabase.table("users")
                .select("id, name, email, department, year")
                .in_("id", [r["user_id"] for r in raw if r.get("user_id")])
                .execute()
            )
            users_map = {u["id"]: u for u in (u_res.data or [])}
        except Exception:
            users_map = {}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Name", "Email", "Department", "Year", "RSVP'd At"])
    for r in raw:
        u = users_map.get(r["user_id"]) or {}
        writer.writerow([
            u.get("name") or "",
            u.get("email") or "",
            u.get("department") or "",
            u.get("year") if u.get("year") is not None else "",
            r.get("created_at") or "",
        ])

    safe_title = "".join(
        c for c in (event.data.get("title") or "event") if c.isalnum() or c in (" ", "-", "_")
    ).strip().replace(" ", "_") or "event"
    filename = f"{safe_title}_attendees_{datetime.utcnow().strftime('%Y%m%d')}.csv"

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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