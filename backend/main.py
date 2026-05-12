from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.routers import auth, projects, notifications, clubs, events, chats, workspaces
from app.core.config import settings
from app.core.supabase import get_supabase_admin, reset_supabase_clients
from app.core.ratelimit import limiter
from app.schemas.notifications import send_notification
from datetime import datetime, timedelta
import asyncio
import logging

logger = logging.getLogger(__name__)

app = FastAPI(
    title="CampusConnect API",
    description="Backend API for CampusConnect academic social platform",
    version="1.0.0",
)

# Rate limiting (slowapi)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _cors_headers(request: Request) -> dict:
    """Build CORS headers mirroring CORSMiddleware so manual responses don't fail CORS."""
    origin = request.headers.get("origin", "")
    if origin in settings.ALLOWED_ORIGINS:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return {}


@app.middleware("http")
async def supabase_retry_middleware(request: Request, call_next):
    """Catches everything the route layer raises and makes sure the client
    gets a response with CORS headers attached.

    Starlette's BaseHTTPMiddleware (which this decorator uses) skips the
    CORSMiddleware flow when the inner app raises — without the header the
    browser hides the real status behind a generic "CORS policy" error.

    Three buckets:
      * Transient httpx/Supabase glitch  → 503 + reset cached clients
      * FastAPI HTTPException             → let it propagate (the framework
                                            handler already attaches CORS)
      * Anything else                     → 500 with the real detail
    """
    try:
        return await call_next(request)
    except HTTPException:
        # FastAPI's exception handler chain produces a proper response with
        # CORS headers; we mustn't swallow it here.
        raise
    except Exception as e:
        msg = repr(e).lower()
        if any(x in msg for x in ("remoteprotocolerror", "server disconnected", "broken pipe")):
            logger.warning(f"Transient supabase network error, resetting clients: {e}")
            reset_supabase_clients()
            return JSONResponse(
                status_code=503,
                content={"detail": "Network glitch — please retry."},
                headers=_cors_headers(request),
            )
        # Unhandled error in a route. Log with traceback for the operator,
        # return a short detail to the client + CORS headers so the browser
        # surfaces the real status code instead of a misleading CORS error.
        logger.exception(f"Unhandled error in {request.method} {request.url.path}")
        return JSONResponse(
            status_code=500,
            content={"detail": f"Internal server error: {type(e).__name__}"},
            headers=_cors_headers(request),
        )

app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(clubs.router, prefix="/api/clubs", tags=["Clubs"])
app.include_router(events.router, prefix="/api/events", tags=["Events"])
app.include_router(chats.router, prefix="/api/chats", tags=["Chats"])
app.include_router(workspaces.router, prefix="/api/workspaces", tags=["Workspaces"])


async def send_event_reminders():
    """
    Runs every hour. Finds events starting in the next 24-25 hours
    and sends reminder notifications to attendees who haven't been notified yet.
    """
    while True:
        try:
            supabase = get_supabase_admin()
            now = datetime.utcnow()
            window_start = (now + timedelta(hours=24)).isoformat()
            window_end = (now + timedelta(hours=25)).isoformat()

            # Find events in the 24-25h window
            upcoming = supabase.table("events").select("id, title, location, event_date") \
                .gte("event_date", window_start) \
                .lte("event_date", window_end) \
                .execute()

            for event in (upcoming.data or []):
                # Get attendees
                attendees = supabase.table("event_attendees").select("user_id") \
                    .eq("event_id", event["id"]).execute()

                event_time = datetime.fromisoformat(event["event_date"].replace("Z", ""))
                formatted_time = event_time.strftime("%b %d at %H:%M")

                for att in (attendees.data or []):
                    # Check if already notified
                    existing = supabase.table("notifications").select("id") \
                        .eq("user_id", att["user_id"]) \
                        .eq("type", "event_reminder") \
                        .like("link", f"%/events/{event['id']}%") \
                        .execute()
                    if not existing.data:
                        send_notification(
                            user_id=att["user_id"],
                            type="event_reminder",
                            title=f"Reminder: {event['title']} is tomorrow",
                            body=f"{event['title']} starts {formatted_time} at {event['location']}.",
                            link=f"/events/{event['id']}",
                        )
        except Exception as e:
            logger.error(f"Event reminder error: {e}")

        await asyncio.sleep(3600)  # Run every hour


@app.on_event("startup")
async def startup_event():
    asyncio.create_task(send_event_reminders())
    logger.info("Event reminder scheduler started.")


@app.get("/")
def root():
    return {"message": "CampusConnect API is running", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "ok"}