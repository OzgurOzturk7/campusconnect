from fastapi import APIRouter, HTTPException, status, Depends
from app.schemas.auth import LoginRequest, LoginResponse, UserPublic, UserUpdate, AIAnalysisResponse
from app.core.supabase import get_supabase, get_supabase_admin
from app.core.security import create_access_token, get_current_user
import os
import json
from datetime import datetime, timedelta

router = APIRouter()


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
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