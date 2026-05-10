"""
Supabase client factory.

The supabase-py library uses httpx under the hood with HTTP/2 enabled.
HTTP/2 keep-alive connections are flaky across long-distance regions
(e.g. Turkey ↔ Sydney): idle multiplexed streams get reset and the next
request hangs / errors with `RemoteProtocolError: Server disconnected`.

To make the backend resilient we:
1. Cache one anon-key client and one service-role client (no per-request setup overhead).
2. Force HTTP/1.1 on the underlying postgrest httpx session — it's a
   single connection per request with simple keep-alive, much more stable
   over high-latency links.
"""
from supabase import create_client, Client
from app.core.config import settings
import httpx

_supabase: Client | None = None
_supabase_admin: Client | None = None


def _force_http1(client: Client) -> Client:
    """Replace postgrest's httpx session with an HTTP/1.1-only one.
    Called immediately after create_client(). No-op if the internal layout
    changes in a future supabase-py release."""
    try:
        old = client.postgrest.session  # type: ignore[attr-defined]
        new = httpx.Client(
            base_url=str(old.base_url),
            headers=dict(old.headers),
            timeout=old.timeout,
            http2=False,
            follow_redirects=True,
        )
        client.postgrest.session = new  # type: ignore[attr-defined]
    except Exception as e:
        print(f"[supabase] could not force HTTP/1.1, falling back to defaults: {e}")
    return client


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        _supabase = _force_http1(
            create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
        )
    return _supabase


def get_supabase_admin() -> Client:
    global _supabase_admin
    if _supabase_admin is None:
        _supabase_admin = _force_http1(
            create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
        )
    return _supabase_admin


def reset_supabase_clients():
    """Drop cached clients (forces fresh connection on next call)."""
    global _supabase, _supabase_admin
    _supabase = None
    _supabase_admin = None
