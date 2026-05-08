from supabase import create_client, Client
from app.core.config import settings

# Cached singletons. Recreating these per-request is reliable but adds ~50ms
# per request from TLS+TCP setup. Caching is much faster; we only refresh
# explicitly via reset_supabase_clients() if a transient network error happens.

_supabase: Client | None = None
_supabase_admin: Client | None = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    return _supabase


def get_supabase_admin() -> Client:
    global _supabase_admin
    if _supabase_admin is None:
        _supabase_admin = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
    return _supabase_admin


def reset_supabase_clients():
    """Drop cached clients (forces fresh connection on next call)."""
    global _supabase, _supabase_admin
    _supabase = None
    _supabase_admin = None
