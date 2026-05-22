from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.core.supabase import get_supabase_admin

router = APIRouter()


@router.get("")
def global_search(q: str = "", current_user: dict = Depends(get_current_user)):
    """Unified search across clubs, events, projects and users.

    Returns up to 5 matches per category. Only public-facing name/title
    fields are queried — every authenticated user is allowed to see these,
    so no extra ownership scoping is needed. Each category is fetched
    defensively: one failing table never blanks the whole response.
    """
    query = (q or "").strip()
    if len(query) < 2:
        return {"clubs": [], "events": [], "projects": [], "users": []}

    admin = get_supabase_admin()
    like = f"%{query}%"

    def _safe(fn):
        try:
            return fn() or []
        except Exception as e:
            print("SEARCH ERROR:", e)
            return []

    clubs = _safe(lambda: admin.table("clubs")
                  .select("id, name, category")
                  .ilike("name", like).limit(5).execute().data)
    events = _safe(lambda: admin.table("events")
                   .select("id, title, event_date")
                   .ilike("title", like).limit(5).execute().data)
    projects = _safe(lambda: admin.table("projects")
                     .select("id, title, status")
                     .ilike("title", like).limit(5).execute().data)
    users = _safe(lambda: admin.table("users")
                  .select("id, name, avatar_url, department")
                  .ilike("name", like)
                  .neq("id", current_user["id"]).limit(5).execute().data)

    return {"clubs": clubs, "events": events, "projects": projects, "users": users}
