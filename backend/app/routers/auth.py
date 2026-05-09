from fastapi import APIRouter, HTTPException, status, Depends, Request
from app.schemas.auth import LoginRequest, LoginResponse, GoogleLoginRequest, UserPublic, UserUpdate, AIAnalysisResponse
from app.core.supabase import get_supabase, get_supabase_admin
from app.core.security import create_access_token, get_current_user
from app.core.config import settings
from app.core.ratelimit import limiter
import os
import json
from datetime import datetime, timedelta

router = APIRouter()

ALLOWED_GOOGLE_DOMAIN = "final.edu.tr"


@router.post("/login", response_model=LoginResponse)
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest):
    supabase = get_supabase()

    try:
        auth_response = supabase.auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception as e:
        print("AUTH ERROR:", e)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not auth_response.user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    supabase_user_id = auth_response.user.id

    try:
        result = (
            supabase.table("users")
            .select("id, email, name, role")
            .eq("id", supabase_user_id)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        print("DB ERROR:", e)
        raise HTTPException(status_code=500, detail="Database error")

    if not result or not result.data:
        raise HTTPException(status_code=404, detail="User profile not found. Contact admin.")

    user = result.data
    token = create_access_token(data={"sub": user["id"], "role": user["role"], "email": user["email"]})

    return LoginResponse(
        access_token=token,
        role=user["role"],
        user_id=user["id"],
        name=user["name"],
        email=user["email"],
    )


@router.post("/google", response_model=LoginResponse)
@limiter.limit("10/minute")
def google_login(request: Request, body: GoogleLoginRequest):
    """
    Verify a Google ID token (credential) from Google Identity Services.
    Only @final.edu.tr accounts are allowed.
    The user must already exist in the `users` table — this endpoint does not create accounts.
    """
    google_client_id = settings.GOOGLE_CLIENT_ID or os.getenv("GOOGLE_CLIENT_ID", "")
    if not google_client_id:
        raise HTTPException(status_code=500, detail="Google sign-in not configured on server")

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as g_requests
    except ImportError as e:
        print("GOOGLE AUTH IMPORT ERROR:", e)
        raise HTTPException(status_code=500, detail=f"google-auth import failed: {e}")

    try:
        info = id_token.verify_oauth2_token(
            body.credential,
            g_requests.Request(),
            google_client_id,
            clock_skew_in_seconds=10,
        )
    except Exception as e:
        print("GOOGLE TOKEN VERIFY ERROR:", repr(e))
        print("USING CLIENT ID:", google_client_id)
        raise HTTPException(status_code=401, detail=f"Invalid Google credential: {e}")

    email = (info.get("email") or "").lower()
    email_verified = info.get("email_verified", False)
    hd = info.get("hd")

    if not email or not email_verified:
        raise HTTPException(status_code=401, detail="Email not verified by Google")

    # Domain restriction — both `hd` claim and email suffix
    if hd != ALLOWED_GOOGLE_DOMAIN and not email.endswith(f"@{ALLOWED_GOOGLE_DOMAIN}"):
        raise HTTPException(
            status_code=403,
            detail=f"Only @{ALLOWED_GOOGLE_DOMAIN} accounts are allowed.",
        )

    name = info.get("name") or email.split("@")[0]
    avatar_url = info.get("picture")

    supabase = get_supabase_admin()

    # 1) Check if user already exists in public.users
    try:
        result = (
            supabase.table("users")
            .select("id, email, name, role")
            .eq("email", email)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        print("DB ERROR:", e)
        raise HTTPException(status_code=500, detail="Database error")

    user = result.data if result and result.data else None

    # 2) Auto-provision on first sign-in
    if not user:
        try:
            # Create Supabase Auth user (foreign key target for public.users.id)
            auth_user = supabase.auth.admin.create_user({
                "email": email,
                "email_confirm": True,
                "user_metadata": {
                    "name": name,
                    "avatar_url": avatar_url,
                    "provider": "google",
                },
            })
            new_id = auth_user.user.id
        except Exception as e:
            # If user already exists in auth but not in public.users, try to fetch it
            print("AUTH CREATE ERROR:", repr(e))
            try:
                listed = supabase.auth.admin.list_users()
                match = next((u for u in (listed or []) if (getattr(u, "email", "") or "").lower() == email), None)
                if not match:
                    raise HTTPException(status_code=500, detail=f"Could not provision account: {e}")
                new_id = match.id
            except HTTPException:
                raise
            except Exception as e2:
                raise HTTPException(status_code=500, detail=f"Could not provision account: {e2}")

        # Insert profile row
        try:
            insert_payload = {
                "id": new_id,
                "email": email,
                "name": name,
                "role": "student",
            }
            if avatar_url:
                insert_payload["avatar_url"] = avatar_url

            inserted = supabase.table("users").insert(insert_payload).execute()
            user = inserted.data[0] if inserted.data else insert_payload
        except Exception as e:
            print("PROFILE INSERT ERROR:", repr(e))
            raise HTTPException(status_code=500, detail=f"Could not create profile: {e}")

    token = create_access_token(data={"sub": user["id"], "role": user["role"], "email": user["email"]})

    return LoginResponse(
        access_token=token,
        role=user["role"],
        user_id=user["id"],
        name=user["name"],
        email=user["email"],
    )


@router.get("/me", response_model=UserPublic)
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user


@router.put("/profile")
def update_profile(body: UserUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = supabase.table("users").update(update_data).eq("id", current_user["id"]).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Update failed")
    return result.data[0]


@router.post("/logout")
def logout():
    return {"message": "Logged out successfully"}


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
        print("USER SEARCH ERROR:", e)
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
async def ai_profile_analysis(current_user: dict = Depends(get_current_user)):
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
        print("Clubs fetch error:", e)
        real_clubs = []

    try:
        events_result = supabase.table("events").select("id, title, description").execute()
        real_events = events_result.data or []
    except Exception as e:
        print("Events fetch error:", e)
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
            print("OpenAI error:", e)

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
            "ai_analysis_updated_at": datetime.utcnow().isoformat(),
        }).eq("id", current_user["id"]).execute()
    except Exception as e:
        print("Cache save error:", e)

    return result