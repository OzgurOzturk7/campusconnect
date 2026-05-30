import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException, status, Depends, Request
from app.schemas.auth import (
    LoginRequest, LoginResponse, GoogleLoginRequest,
    UserPublic, UserUpdate, AIAnalysisResponse,
    ChangePasswordRequest, ForgotPasswordRequest, InviteUserRequest,
    AllowedDomainCreate, AllowedDomainUpdate,
)
from app.core.supabase import get_supabase, get_supabase_admin
from app.core.security import create_access_token, get_current_user, require_admin
from app.core.audit import log_audit, client_ip
from app.core.config import settings
from app.core.ratelimit import limiter
from app.services.email import send_email, EmailError
from app.services.email_templates import (
    welcome as welcome_email_template,
    password_reset_notice,
)
import os
import json
import secrets
import string
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


def _generate_temp_password(length: int = 14) -> str:
    """A reasonably memorable but unguessable temp password — letters + digits.
    Avoids ambiguous chars (0/O/1/l) to keep copy-from-email painless.
    """
    alphabet = (
        "ABCDEFGHJKLMNPQRSTUVWXYZ"
        "abcdefghijkmnopqrstuvwxyz"
        "23456789"
    )
    return "".join(secrets.choice(alphabet) for _ in range(length))

router = APIRouter()


def get_active_allowed_domains(admin) -> list[str]:
    """Active invite/login email domains.

    Reads the admin-managed `allowed_email_domains` table and falls back
    to the INVITE_ALLOWED_DOMAINS env value when the table has no active
    rows — so emptying the list in the admin UI can never lock everyone
    out of invites and Google sign-in.
    """
    domains: list[str] = []
    try:
        res = (
            admin.table("allowed_email_domains")
            .select("domain")
            .eq("is_active", True)
            .execute()
        )
        domains = [(r["domain"] or "").lower().lstrip("@").strip() for r in (res.data or [])]
        domains = [d for d in domains if d]
    except Exception as e:
        logger.error(f"ALLOWED DOMAINS FETCH ERROR: {e}")
    if not domains:
        domains = [
            d.lower().lstrip("@").strip()
            for d in (settings.INVITE_ALLOWED_DOMAINS or ["final.edu.tr"])
        ]
    return domains


@router.post("/login", response_model=LoginResponse)
# 5/minute is tight enough to make password brute-forcing impractical
# but loose enough that a typo-prone user isn't locked out.
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest):
    supabase = get_supabase()

    try:
        auth_response = supabase.auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception as e:
        logger.error(f"AUTH ERROR: {e}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not auth_response.user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    supabase_user_id = auth_response.user.id

    try:
        result = (
            supabase.table("users")
            .select("id, email, name, role, must_change_password")
            .eq("id", supabase_user_id)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        logger.error(f"DB ERROR: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    if not result or not result.data:
        raise HTTPException(status_code=404, detail="User profile not found. Contact admin.")

    user = result.data
    token = create_access_token(data={"sub": user["id"], "role": user["role"], "email": user["email"]})
    log_audit("login", user_id=user["id"], ip=client_ip(request))

    return LoginResponse(
        access_token=token,
        role=user["role"],
        user_id=user["id"],
        name=user["name"],
        email=user["email"],
        must_change_password=bool(user.get("must_change_password", False)),
    )


@router.post("/google")
@limiter.limit("10/minute")
def google_login(request: Request, body: GoogleLoginRequest):
    """Google ID token sign-in with two outcomes.

    Returns a discriminated dict:
      { "status": "session", "session": LoginResponse } — user exists, log them in
      { "status": "invited", "email": ..., "email_failed": bool }
        — first time we've seen this Google account. We:
          1. Create the auth.users + public.users rows
          2. Set must_change_password=True so /onboarding traps them on
             first sign-in
          3. Email them a temporary password (Resend)
          4. DO NOT issue a JWT — frontend shows a 'check your email' view
        Why not just log them in via Google? Because the product wants
        every account to have a real email+password as the primary
        credential. That way the user can sign in from any device, even
        ones without their Google session.

    Only emails on the admin-configured allowed-domains list pass the
    Google domain gate (falls back to the env default when unset).
    """
    google_client_id = settings.GOOGLE_CLIENT_ID or os.getenv("GOOGLE_CLIENT_ID", "")
    if not google_client_id:
        raise HTTPException(status_code=500, detail="Google sign-in not configured on server")

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as g_requests
    except ImportError as e:
        logger.error(f"GOOGLE AUTH IMPORT ERROR: {e}")
        raise HTTPException(status_code=500, detail=f"google-auth import failed: {e}")

    try:
        info = id_token.verify_oauth2_token(
            body.credential,
            g_requests.Request(),
            google_client_id,
            clock_skew_in_seconds=10,
        )
    except Exception as e:
        logger.error(f"GOOGLE TOKEN VERIFY ERROR: {repr(e)}")
        logger.error(f"USING CLIENT ID: {google_client_id}")
        raise HTTPException(status_code=401, detail=f"Invalid Google credential: {e}")

    email = (info.get("email") or "").lower()
    email_verified = info.get("email_verified", False)
    hd = info.get("hd")

    if not email or not email_verified:
        raise HTTPException(status_code=401, detail="Email not verified by Google")

    supabase = get_supabase_admin()

    # Domain restriction — admin-configurable list, matched against both
    # the Google `hd` claim and the email suffix.
    allowed = get_active_allowed_domains(supabase)
    hd_norm = (hd or "").lower()
    if hd_norm not in allowed and not any(email.endswith(f"@{d}") for d in allowed):
        rendered = " or ".join(f"@{d}" for d in allowed)
        raise HTTPException(
            status_code=403,
            detail=f"Only {rendered} accounts are allowed.",
        )

    name = info.get("name") or email.split("@")[0]
    avatar_url = info.get("picture")

    # ---- Existing user? Just log them in. ----
    try:
        result = (
            supabase.table("users")
            .select("id, email, name, role, must_change_password")
            .eq("email", email)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        logger.error(f"DB ERROR: {e}")
        raise HTTPException(status_code=500, detail="Database error")

    user = result.data if result and result.data else None

    if user:
        # Returning user — issue a session. If they still owe us a real
        # password (admin invite they never completed, or a previous
        # Google-triggered invite they ignored), ProtectedRoute will trap
        # them on /onboarding and force the swap.
        token = create_access_token(data={
            "sub": user["id"], "role": user["role"], "email": user["email"],
        })
        login = LoginResponse(
            access_token=token,
            role=user["role"],
            user_id=user["id"],
            name=user["name"],
            email=user["email"],
            must_change_password=bool(user.get("must_change_password", False)),
        )
        return {"status": "session", "session": login.model_dump()}

    # ---- First time — provision + email a temp password, no session. ----
    temp_password = _generate_temp_password()
    try:
        auth_user = supabase.auth.admin.create_user({
            "email": email,
            "password": temp_password,
            "email_confirm": True,
            "user_metadata": {
                "name": name,
                "avatar_url": avatar_url,
                "provider": "google",
            },
        })
        new_id = auth_user.user.id
    except Exception as e:
        # If the auth row already exists (orphaned from a half-failed
        # earlier attempt) recover by reading it back instead of giving up.
        logger.error(f"GOOGLE INVITE AUTH CREATE ERROR: {repr(e)}")
        try:
            listed = supabase.auth.admin.list_users()
            match = next((u for u in (listed or []) if (getattr(u, "email", "") or "").lower() == email), None)
            if not match:
                raise HTTPException(status_code=500, detail=f"Could not provision account: {e}")
            new_id = match.id
            # Reset the password to one we know, since we don't have the original.
            supabase.auth.admin.update_user_by_id(new_id, {"password": temp_password})
        except HTTPException:
            raise
        except Exception as e2:
            raise HTTPException(status_code=500, detail=f"Could not provision account: {e2}")

    try:
        insert_payload = {
            "id": new_id,
            "email": email,
            "name": name,
            "role": "student",
            "must_change_password": True,
        }
        if avatar_url:
            insert_payload["avatar_url"] = avatar_url
        supabase.table("users").insert(insert_payload).execute()
    except Exception as e:
        logger.error(f"GOOGLE INVITE PROFILE INSERT ERROR: {repr(e)}")
        try:
            supabase.auth.admin.delete_user(new_id)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Could not create profile: {e}")

    # Welcome email with the temp password. Failure is non-fatal here —
    # the account exists; in DEBUG we print the password to the server log
    # so the operator can still finish the test flow.
    frontend_origin = (settings.ALLOWED_ORIGINS or ["http://localhost:5173"])[0]
    subject, html, text = welcome_email_template(
        recipient_name=name,
        login_url=f"{frontend_origin}/login",
        temp_password=temp_password,
    )
    email_failed = False
    try:
        send_email(to=email, subject=subject, html=html, text=text)
    except EmailError as e:
        email_failed = True
        logger.error(f"GOOGLE INVITE EMAIL FAILED: {e}")
    except Exception as e:
        email_failed = True
        logger.error(f"GOOGLE INVITE EMAIL UNEXPECTED ERROR: {e}")
    if email_failed and settings.DEBUG:
        logger.warning(
            f"*** DEV ONLY *** GOOGLE-INVITE temp password for {email}: {temp_password}"
            " - REMOVE DEBUG=true BEFORE PRODUCTION"
        )

    # No JWT. Frontend renders the 'check your inbox' view.
    return {"status": "invited", "email": email, "email_failed": email_failed}


@router.get("/me", response_model=UserPublic)
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


@router.put("/profile")
@limiter.limit("30/minute")
def update_profile(request: Request, body: UserUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        result = (
            supabase.table("users")
            .update(update_data)
            .eq("id", current_user["id"])
            .execute()
        )
    except Exception as e:
        # Surface the real reason — column type mismatch, length overflow,
        # RLS policy, etc. Without this the user just sees a bare 500.
        logger.error(f"UPDATE PROFILE ERROR: {repr(e)} data={update_data}")
        msg = str(e)
        # Translate a couple of common Postgres failure codes into 400s
        # with operator-friendly copy.
        if "users_year_check" in msg or "23514" in msg:
            raise HTTPException(
                status_code=400,
                detail="Year of study must be between 1 and 12.",
            )
        if "value too long" in msg or "22001" in msg:
            raise HTTPException(
                status_code=400,
                detail="One of the fields is too long for the database.",
            )
        raise HTTPException(
            status_code=500,
            detail=f"Couldn't save profile: {type(e).__name__}",
        )
    if not result.data:
        # No row matched (id changed mid-flight? or RLS hid the row).
        raise HTTPException(status_code=500, detail="Update returned no row")
    return result.data[0]


@router.post("/logout")
def logout():
    return {"message": "Logged out successfully"}


@router.post("/change-password")
@limiter.limit("5/minute")
def change_password(
    request: Request,
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    """Authenticated user changes their own password.

    Step 1: re-authenticate the user against Supabase with the current
            password (proves the request really came from them, not just
            from a stolen JWT).
    Step 2: ask the admin API to set the new password.

    Both steps must succeed. We never store either password.
    """
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from the current one.",
        )

    supabase = get_supabase()
    try:
        auth_response = supabase.auth.sign_in_with_password(
            {"email": current_user["email"], "password": body.current_password}
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Current password is incorrect.")
    if not auth_response or not auth_response.user:
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    admin = get_supabase_admin()
    try:
        admin.auth.admin.update_user_by_id(
            current_user["id"], {"password": body.new_password}
        )
    except Exception as e:
        logger.error(f"PASSWORD UPDATE ERROR: {e}")
        raise HTTPException(status_code=500, detail="Couldn't update password. Try again.")

    # Onboarding: once they've picked a real password the temp-password
    # flag is gone. Idempotent — fine to set when it was already False.
    # Clear the temp-password flag and stamp token_valid_after, which makes
    # every session minted before now (other devices, stolen tokens) fail
    # auth. Back-dating 5s avoids a rounding race with the fresh token's iat
    # (JWT iat is whole-second).
    invalidate_before = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    try:
        admin.table("users").update({
            "must_change_password": False,
            "token_valid_after": invalidate_before,
        }).eq("id", current_user["id"]).execute()
    except Exception as e:
        # Non-fatal — password is updated, the flag is a UX hint.
        logger.error(f"CLEAR must_change_password / token_valid_after FAILED: {e}")

    # Mint a fresh token so THIS device stays signed in while the old ones drop.
    new_token = create_access_token(data={
        "sub": current_user["id"], "role": current_user["role"], "email": current_user["email"],
    })
    log_audit("password_change", user_id=current_user["id"], ip=client_ip(request))
    return {"ok": True, "access_token": new_token}


@router.post("/invite", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
def invite_user(
    request: Request,
    body: InviteUserRequest,
    current_user: dict = Depends(require_admin),
):
    """Admin onboards a new university member.

    Flow:
      1. Validate the email is on the allowed university domain.
      2. Generate a random temporary password (server never stores it).
      3. Create the auth.users row with email_confirm=True so the user
         doesn't have to click a verification link before logging in.
      4. Create the public.users profile row with must_change_password=True
         so the frontend forces them onto /onboarding on first sign-in.
      5. Email the temp password via Resend. If that fails we roll back
         the auth + profile rows so the admin can retry safely.
    """
    email = body.email.lower().strip()
    admin = get_supabase_admin()
    allowed = get_active_allowed_domains(admin)
    if not any(email.endswith(f"@{d}") for d in allowed):
        # Build a friendly message: "@final.edu.tr" or "@final.edu.tr or @gmail.com"
        rendered = " or ".join(f"@{d}" for d in allowed)
        raise HTTPException(
            status_code=400,
            detail=f"Only {rendered} emails can be invited.",
        )

    # Reject if someone with this email already exists in our profile table.
    try:
        existing = admin.table("users").select("id").eq("email", email).maybe_single().execute()
    except Exception as e:
        logger.error(f"INVITE EXISTING CHECK ERROR: {e}")
        existing = None
    if existing and existing.data:
        raise HTTPException(status_code=409, detail="A user with this email already exists.")

    temp_password = _generate_temp_password()

    # 1) Auth user
    try:
        auth_user = admin.auth.admin.create_user({
            "email": email,
            "password": temp_password,
            "email_confirm": True,
            "user_metadata": {"invited_by": current_user.get("id")},
        })
        new_id = auth_user.user.id
    except Exception as e:
        logger.error(f"INVITE AUTH CREATE ERROR: {repr(e)}")
        raise HTTPException(status_code=500, detail="Couldn't create the account. Try again.")

    # 2) Profile row — flagged so onboarding kicks in.
    try:
        admin.table("users").insert({
            "id": new_id,
            "email": email,
            "name": body.name.strip(),
            "role": body.role,
            "must_change_password": True,
        }).execute()
    except Exception as e:
        logger.error(f"INVITE PROFILE INSERT ERROR: {repr(e)}")
        # Roll back the auth user so an admin can retry without hitting
        # the "email already exists" check above.
        try:
            admin.auth.admin.delete_user(new_id)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Couldn't create the profile. Try again.")

    # 3) Welcome email with the temp password.
    frontend_origin = (settings.ALLOWED_ORIGINS or ["http://localhost:5173"])[0]
    login_url = f"{frontend_origin}/login"
    subject, html, text = welcome_email_template(
        recipient_name=body.name,
        login_url=login_url,
        temp_password=temp_password,
    )
    email_failed = False
    try:
        send_email(to=email, subject=subject, html=html, text=text)
    except EmailError as e:
        email_failed = True
        logger.error(f"INVITE EMAIL FAILED: {e}")
    except Exception as e:
        email_failed = True
        logger.error(f"INVITE EMAIL UNEXPECTED ERROR: {e}")

    if email_failed:
        # In dev, print the temp password to the server log so the operator
        # can finish testing the onboarding flow even when SMTP isn't wired
        # up yet. Strictly gated on DEBUG so this never leaks in production.
        if settings.DEBUG:
            logger.warning(
                f"*** DEV ONLY *** INVITE temp password for {email}: {temp_password}"
                " - REMOVE DEBUG=true BEFORE PRODUCTION"
            )
        # Surface to the admin so they know to act.
        raise HTTPException(
            status_code=502,
            detail="Account created but the welcome email failed to send. "
                   "Check the server log (DEBUG mode prints the temp password) "
                   "or send a password reset manually.",
        )

    log_audit(
        "invite",
        user_id=new_id,
        actor_id=current_user.get("id"),
        detail=f"email={email}; role={body.role}",
        ip=client_ip(request),
    )
    return {"ok": True, "user_id": new_id, "email": email}


# ---- Admin: manage the invite/login allowed-domain whitelist ----

@router.get("/allowed-domains")
def list_allowed_domains(current_user: dict = Depends(require_admin)):
    """All configured domains (active + inactive), oldest first."""
    admin = get_supabase_admin()
    try:
        res = (
            admin.table("allowed_email_domains")
            .select("*")
            .order("created_at", desc=False)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.error(f"LIST DOMAINS ERROR: {e}")
        raise HTTPException(status_code=500, detail="Couldn't load domains.")


@router.post("/allowed-domains", status_code=status.HTTP_201_CREATED)
def add_allowed_domain(body: AllowedDomainCreate, current_user: dict = Depends(require_admin)):
    domain = body.domain.lower().strip().lstrip("@")
    # Minimal sanity check — a real domain has a dot and no @ or whitespace.
    if "@" in domain or any(c.isspace() for c in domain) or "." not in domain:
        raise HTTPException(status_code=400, detail="Enter a valid domain like 'example.com'.")
    admin = get_supabase_admin()
    try:
        res = admin.table("allowed_email_domains").insert({
            "domain": domain,
            "is_active": True,
            "created_by": current_user["id"],
        }).execute()
    except Exception as e:
        msg = str(e).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            raise HTTPException(status_code=409, detail="That domain is already in the list.")
        logger.error(f"ADD DOMAIN ERROR: {e}")
        raise HTTPException(status_code=500, detail="Couldn't add the domain.")
    return res.data[0]


@router.patch("/allowed-domains/{domain_id}")
def toggle_allowed_domain(
    domain_id: str,
    body: AllowedDomainUpdate,
    current_user: dict = Depends(require_admin),
):
    admin = get_supabase_admin()
    try:
        res = (
            admin.table("allowed_email_domains")
            .update({"is_active": body.is_active})
            .eq("id", domain_id)
            .execute()
        )
    except Exception as e:
        logger.error(f"TOGGLE DOMAIN ERROR: {e}")
        raise HTTPException(status_code=500, detail="Couldn't update the domain.")
    if not res.data:
        raise HTTPException(status_code=404, detail="Domain not found.")
    return res.data[0]


@router.delete("/allowed-domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_allowed_domain(domain_id: str, current_user: dict = Depends(require_admin)):
    admin = get_supabase_admin()
    try:
        admin.table("allowed_email_domains").delete().eq("id", domain_id).execute()
    except Exception as e:
        logger.error(f"DELETE DOMAIN ERROR: {e}")
        raise HTTPException(status_code=500, detail="Couldn't delete the domain.")
    return None


def _send_password_reset_email_background(to: str, name: str, action_link: str) -> None:
    """Wrapper used by BackgroundTasks. Logs but never raises — there is
    nothing the caller can do with a failure once the response is on its
    way to the user, and forgot-password is intentionally non-enumerable
    so we don't surface delivery status either way.
    """
    try:
        subject, html, text = password_reset_notice(
            recipient_name=name or "",
            reset_url=action_link,
        )
        send_email(to=to, subject=subject, html=html, text=text)
    except EmailError as e:
        logger.warning("forgot_password background email failed: %s", e)
    except Exception:
        logger.exception("forgot_password background email crashed")


@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, background_tasks: BackgroundTasks):
    """Trigger a password-reset email via *our own* email pipeline.

    Why not just `supabase.auth.reset_password_for_email()`? That uses
    Supabase's built-in SMTP — which until you configure custom SMTP in
    the Supabase dashboard means the email comes from
    `noreply@mail.app.supabase.io` and is rate-limited 4/hour on free tier.
    By generating the recovery link via the admin API and sending the
    email ourselves we get:
      - One sender across invite/welcome/reset (currently Gmail SMTP)
      - One template/brand
      - Whatever rate limit our SMTP allows (Gmail = ~500/day)

    Returns 200 regardless of whether the email matches a user —
    standard anti-enumeration practice.
    """
    email = body.email.lower().strip()
    frontend = (settings.ALLOWED_ORIGINS or ["http://localhost:5173"])[0]
    redirect_to = f"{frontend}/reset-password"

    admin = get_supabase_admin()

    # Look up the profile row first — silently skip if the email doesn't
    # match a real user. We don't tell the caller either way.
    try:
        result = (
            admin.table("users")
            .select("name, email")
            .eq("email", email)
            .maybe_single()
            .execute()
        )
        user_row = result.data if result and result.data else None
    except Exception as e:
        logger.error(f"FORGOT PASSWORD LOOKUP ERROR: {e}")
        return {"ok": True}

    if not user_row:
        return {"ok": True}

    # Ask Supabase for the recovery action_link *without* sending its own
    # email. The link contains a one-time token that drops the user into a
    # recovery session when they click; our /reset-password page picks it
    # up via supabase-js's hash-fragment detector.
    action_link: str | None = None
    try:
        link_res = admin.auth.admin.generate_link({
            "type": "recovery",
            "email": email,
            "options": {"redirect_to": redirect_to},
        })
        # supabase-py varies the response shape across versions; check both.
        action_link = (
            getattr(link_res, "action_link", None)
            or getattr(getattr(link_res, "properties", None), "action_link", None)
        )
        # Dict-shaped responses (older SDKs / raw HTTP fallback).
        if not action_link and isinstance(link_res, dict):
            action_link = (
                link_res.get("action_link")
                or (link_res.get("properties") or {}).get("action_link")
            )
    except Exception as e:
        logger.error(f"FORGOT PASSWORD GENERATE LINK ERROR: {e}")
        return {"ok": True}

    if not action_link:
        logger.warning("FORGOT PASSWORD: generate_link returned no action_link")
        return {"ok": True}

    # Queue the actual email send for after the response is flushed.
    # The response is already "ok: True" regardless of delivery outcome
    # (anti-enumeration), so the user doesn't gain anything by waiting
    # for the SMTP round-trip to complete. Moving it to a background
    # task means a slow SMTP server can't stretch the request to 5+
    # seconds and make the UI look frozen.
    background_tasks.add_task(
        _send_password_reset_email_background,
        email,
        user_row.get("name") or "",
        action_link,
    )

    return {"ok": True}


@router.get("/search-users")
def search_users(q: str, current_user: dict = Depends(get_current_user)):
    """Search users by name (used by chat new-conversation modal)."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    supabase = get_supabase_admin()
    try:
        result = (
            supabase.table("users")
            .select("id, name, avatar_url, department, email")
            .ilike("name", f"%{q}%")
            .neq("id", current_user["id"])
            .limit(20)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error(f"USER SEARCH ERROR: {e}")
        raise HTTPException(status_code=500, detail="Search failed")


def score_club_match(club: dict, user_skills: list, user_courses: list, user_dept: str) -> int:
    """Score how well a club matches the user. Higher = better match."""
    score = 0
    club_text = f"{club.get('name','')} {club.get('category','')} {club.get('description','')}".lower()

    for skill in user_skills:
        if skill and skill.lower() in club_text:
            score += 3

    for course in user_courses:
        if course and course.lower() in club_text:
            score += 2

    if user_dept and user_dept.lower() in club_text:
        score += 4

    # category-based matching
    category = (club.get("category") or "").lower()
    tech_keywords = ["programming", "coding", "software", "computer", "developer", "python", "java", "react"]
    if category in ("technical", "research") and any(kw in " ".join(user_skills).lower() for kw in tech_keywords):
        score += 2

    return score


@router.post("/ai-analysis", response_model=AIAnalysisResponse)
# AI calls hit the OpenAI API which is metered — tight cap keeps cost
# predictable even if a client refresh-loops the endpoint.
@limiter.limit("5/hour")
async def ai_profile_analysis(request: Request, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    # 24h cache check
    cached_at = current_user.get("ai_analysis_updated_at")
    cached_result = current_user.get("ai_analysis_cache")
    if cached_at and cached_result:
        try:
            updated = datetime.fromisoformat(cached_at.replace("Z", "+00:00"))
            if datetime.now(updated.tzinfo) - updated < timedelta(hours=24):
                return AIAnalysisResponse(**json.loads(cached_result))
        except Exception:
            pass

    # Fetch real clubs and events
    try:
        clubs_result = supabase.table("clubs").select("id, name, category, description").execute()
        real_clubs = clubs_result.data or []
    except Exception as e:
        logger.error(f"Clubs fetch error: {e}")
        real_clubs = []

    try:
        events_result = supabase.table("events").select("id, title, description").execute()
        real_events = events_result.data or []
    except Exception as e:
        logger.error(f"Events fetch error: {e}")
        real_events = []

    # Profile summary
    profile_summary = {
        "department": current_user.get("department", "") or "",
        "year": current_user.get("year", "") or "",
        "skills": current_user.get("skills") or [],
        "courses": current_user.get("courses") or [],
        "github_url": current_user.get("github_url", "") or "",
        "bio": current_user.get("bio", "") or "",
    }

    missing_fields = []
    if not profile_summary["department"]: missing_fields.append("department")
    if not profile_summary["year"]: missing_fields.append("year")
    if not profile_summary["skills"]: missing_fields.append("skills")
    if not profile_summary["courses"]: missing_fields.append("courses")
    if not profile_summary["github_url"]: missing_fields.append("github_url")
    if not profile_summary["bio"]: missing_fields.append("bio")

    tips = []
    club_suggestions = []
    event_suggestions = []

    openai_api_key = os.getenv("OPENAI_API_KEY", "")

    # Try OpenAI first
    if openai_api_key and (real_clubs or real_events):
        try:
            import httpx
            clubs_text = "\n".join([f"- {c['name']} ({c.get('category','')}: {c.get('description','')})" for c in real_clubs[:20]])
            events_text = "\n".join([f"- {e['title']} ({e.get('description','')})" for e in real_events[:20]])

            prompt = f"""You are an academic advisor AI for CampusConnect.

Student Profile:
- Department: {profile_summary['department'] or 'Not specified'}
- Year: {profile_summary['year'] or 'Not specified'}
- Skills: {', '.join(profile_summary['skills']) if profile_summary['skills'] else 'None'}
- Courses: {', '.join(profile_summary['courses']) if profile_summary['courses'] else 'None'}
- Bio: {profile_summary['bio'] or 'Not written'}

Available Clubs:
{clubs_text or 'No clubs available'}

Available Events:
{events_text or 'No events available'}

Suggest ONLY clubs and events that genuinely match the student's skills, department, or interests.
If no good matches exist, return empty arrays — do NOT pad with random clubs.

Respond ONLY with a JSON object (no markdown):
{{
  "tips": ["tip1", "tip2", "tip3"],
  "club_suggestions": ["Exact Club Name from list"],
  "event_suggestions": ["Exact Event Title from list"]
}}
Max 3 clubs and 3 events. Use exact names from the lists."""

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openai_api_key}"},
                    json={
                        "model": "gpt-4o",
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 500,
                        "temperature": 0.3,
                    },
                    timeout=15.0,
                )
            if response.status_code == 200:
                content = response.json()["choices"][0]["message"]["content"].strip()
                parsed = json.loads(content)
                tips = parsed.get("tips", [])
                club_suggestions = parsed.get("club_suggestions", [])
                event_suggestions = parsed.get("event_suggestions", [])
        except Exception as e:
            logger.error(f"OpenAI error: {e}")

    # Fallback: skill-based matching with scoring
    if not club_suggestions and real_clubs:
        user_skills = profile_summary["skills"]
        user_courses = profile_summary["courses"]
        user_dept = profile_summary["department"]

        scored = [(score_club_match(club, user_skills, user_courses, user_dept), club) for club in real_clubs]
        scored = [s for s in scored if s[0] > 0]
        scored.sort(key=lambda x: x[0], reverse=True)

        club_suggestions = [c["name"] for _, c in scored[:3]]
        # If no matches found by score, leave empty (don't pad with random)

    if not event_suggestions and real_events:
        # only suggest events if user has interests, otherwise leave empty
        if profile_summary["skills"] or profile_summary["courses"]:
            event_suggestions = [e["title"] for e in real_events[:3]]

    if not tips:
        if "skills" in missing_fields:
            tips.append("Add your skills to get matched with relevant clubs and events.")
        if "github_url" in missing_fields:
            tips.append("Link your GitHub profile to showcase your work.")
        if "bio" in missing_fields:
            tips.append("Write a short bio to introduce yourself to the community.")
        if "courses" in missing_fields:
            tips.append("Add your current courses to find relevant study groups.")
        if not tips:
            tips = ["Your profile is well-rounded! Keep it updated as you grow."]

    result = AIAnalysisResponse(
        missing_fields=missing_fields,
        tips=tips,
        club_suggestions=club_suggestions,
        event_suggestions=event_suggestions,
    )

    # Cache
    try:
        supabase.table("users").update({
            "ai_analysis_cache": json.dumps(result.model_dump()),
            "ai_analysis_updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", current_user["id"]).execute()
    except Exception as e:
        logger.error(f"Cache save error: {e}")

    return result