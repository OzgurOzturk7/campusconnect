from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime, timezone
from app.core.security import get_current_user, require_admin
from app.core.supabase import get_supabase_admin
from app.schemas.reports import ReportCreate, ReportStatusUpdate

router = APIRouter()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_report(body: ReportCreate, current_user: dict = Depends(get_current_user)):
    """Any authenticated user can flag content for admin review."""
    admin = get_supabase_admin()
    payload = {
        "reporter_id": current_user["id"],
        "content_type": body.content_type,
        "content_id": body.content_id,
        "reason": body.reason.strip(),
        "content_preview": body.content_preview,
        "reported_user_id": body.reported_user_id,
        "chat_id": body.chat_id,
    }
    try:
        res = admin.table("content_reports").insert(payload).execute()
    except Exception as e:
        print("CREATE REPORT ERROR:", e)
        raise HTTPException(status_code=500, detail="Couldn't submit the report.")
    return res.data[0] if res.data else {"ok": True}


@router.get("")
def list_reports(current_user: dict = Depends(require_admin)):
    """Admin view: all reports, newest first, with reporter / reported names."""
    admin = get_supabase_admin()
    try:
        res = admin.table("content_reports").select("*").order("created_at", desc=True).execute()
        reports = res.data or []
    except Exception as e:
        print("LIST REPORTS ERROR:", e)
        raise HTTPException(status_code=500, detail="Couldn't load reports.")

    # Hydrate the reporter and reported-user display names in one query.
    ids = set()
    for r in reports:
        if r.get("reporter_id"):
            ids.add(r["reporter_id"])
        if r.get("reported_user_id"):
            ids.add(r["reported_user_id"])
    name_map = {}
    if ids:
        try:
            users = admin.table("users").select("id, name").in_("id", list(ids)).execute()
            name_map = {u["id"]: u["name"] for u in (users.data or [])}
        except Exception as e:
            print("LIST REPORTS hydrate error:", e)
    for r in reports:
        r["reporter_name"] = name_map.get(r.get("reporter_id"))
        r["reported_user_name"] = name_map.get(r.get("reported_user_id"))
    return reports


@router.patch("/{report_id}")
def update_report(
    report_id: str,
    body: ReportStatusUpdate,
    current_user: dict = Depends(require_admin),
):
    admin = get_supabase_admin()
    update = {
        "status": body.status,
        "reviewed_by": current_user["id"],
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        res = admin.table("content_reports").update(update).eq("id", report_id).execute()
    except Exception as e:
        print("UPDATE REPORT ERROR:", e)
        raise HTTPException(status_code=500, detail="Couldn't update the report.")
    if not res.data:
        raise HTTPException(status_code=404, detail="Report not found.")
    return res.data[0]
