"""Security audit logging.

Records security-relevant events (login, password change, invite, role
change) into the `security_audit_log` table. Every write is best-effort:
a failure here must never block or break the action that triggered it.
"""
from typing import Optional
from app.core.supabase import get_supabase_admin


def log_audit(
    event_type: str,
    *,
    user_id: Optional[str] = None,
    actor_id: Optional[str] = None,
    detail: Optional[str] = None,
    ip: Optional[str] = None,
) -> None:
    try:
        admin = get_supabase_admin()
        admin.table("security_audit_log").insert({
            "event_type": event_type,
            "user_id": user_id,
            "actor_id": actor_id,
            "detail": detail,
            "ip_address": ip,
        }).execute()
    except Exception as e:
        # Never let auditing break the real request.
        print(f"AUDIT LOG ERROR ({event_type}):", e)


def client_ip(request) -> Optional[str]:
    """Best-effort client IP, honouring a reverse-proxy X-Forwarded-For."""
    try:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
        return request.client.host if request.client else None
    except Exception:
        return None
