from fastapi import APIRouter, Depends
from app.core.security import require_admin
from app.core.supabase import get_supabase_admin
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/stats")
def admin_stats(current_user: dict = Depends(require_admin)):
    """Platform-wide counts for the admin dashboard. Each count is fetched
    defensively so one failing table doesn't blank the whole panel."""
    admin = get_supabase_admin()

    def _count(table: str, **filters) -> int:
        try:
            q = admin.table(table).select("id", count="exact")
            for key, value in filters.items():
                q = q.eq(key, value)
            return q.execute().count or 0
        except Exception as e:
            logger.error(f"ADMIN STATS ERROR ({table}): {e}")
            return 0

    return {
        "users": _count("users"),
        "clubs": _count("clubs"),
        "events": _count("events"),
        "projects": _count("projects"),
        "pending_requests": _count("club_requests", status="pending"),
    }
