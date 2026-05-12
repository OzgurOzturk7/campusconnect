"""
Supabase client factory.

Two cached clients:
  * `get_supabase()`       — anon-key client, used for read paths gated by RLS.
  * `get_supabase_admin()` — service-role client, used by mutating endpoints
                              that need to bypass RLS (chats, notifications, etc).

The project lives in Frankfurt (eu-central-1) — low latency from Turkey, no
need for the HTTP/1.1 fallback that previous Sydney deploys required.
"""
from supabase import create_client, Client
from app.core.config import settings

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
