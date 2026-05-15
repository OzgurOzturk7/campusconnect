from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from app.core.supabase import get_supabase, get_supabase_admin
from app.core.security import get_current_user

router = APIRouter()


class NotificationDeleteBody(BaseModel):
    # When `ids` is omitted or empty the endpoint deletes ALL of the
    # caller's notifications. When it's a list, only those rows are
    # deleted (and only when they belong to the caller — RLS is
    # enforced explicitly in the WHERE clause).
    ids: Optional[List[str]] = None


@router.get("/")
def get_notifications(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = (
        supabase.table("notifications")
        .select("*")
        .eq("user_id", current_user["id"])
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return result.data


@router.patch("/{notification_id}/read")
def mark_read(notification_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    supabase.table("notifications").update({"is_read": True}).eq("id", notification_id).eq("user_id", current_user["id"]).execute()
    return {"success": True}


@router.patch("/read-all")
def mark_all_read(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    supabase.table("notifications").update({"is_read": True}).eq("user_id", current_user["id"]).eq("is_read", False).execute()
    return {"success": True}


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(notification_id: str, current_user: dict = Depends(get_current_user)):
    """Hard-delete a single notification belonging to the caller."""
    supabase = get_supabase_admin()
    res = supabase.table("notifications").delete() \
        .eq("id", notification_id).eq("user_id", current_user["id"]).execute()
    # If nothing was deleted the row either doesn't exist or belongs to
    # someone else — both are 404 from the caller's perspective.
    if not res.data:
        raise HTTPException(status_code=404, detail="Notification not found")


@router.post("/delete")
def delete_notifications(body: NotificationDeleteBody, current_user: dict = Depends(get_current_user)):
    """Bulk delete. POST (not DELETE) because some HTTP clients refuse
    to send a body with DELETE.

    - `ids` empty/missing → wipe everything for this user (clear all).
    - `ids` provided      → delete just those rows, scoped to the user.
    """
    supabase = get_supabase_admin()
    q = supabase.table("notifications").delete().eq("user_id", current_user["id"])
    if body.ids:
        q = q.in_("id", body.ids)
    res = q.execute()
    return {"deleted": len(res.data or [])}


@router.get("/unread-count")
def unread_count(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = (
        supabase.table("notifications")
        .select("id", count="exact")
        .eq("user_id", current_user["id"])
        .eq("is_read", False)
        .execute()
    )
    return {"count": result.count}