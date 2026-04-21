from fastapi import APIRouter, HTTPException, status, Depends
from app.schemas.projects import (
    ProjectPostCreate, ProjectPostUpdate,
    ApplicationCreate, ApplicationStatusUpdate
)
from app.schemas.notifications import send_notification
from app.core.supabase import get_supabase_admin
from app.core.security import get_current_user

router = APIRouter()


@router.get("/")
def list_projects(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    # Single query with owner info and application count
    result = supabase.table("project_posts").select(
        "*, users!owner_id(name, avatar_url, department, year), project_applications(count)"
    ).order("created_at", desc=True).execute()
    posts = result.data or []
    for post in posts:
        owner = post.pop("users", None)
        post["owner"] = owner
        apps = post.pop("project_applications", [])
        post["application_count"] = apps[0]["count"] if apps else 0
    return posts


@router.get("/mine/posts")
def my_posts(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("project_posts").select("*") \
        .eq("owner_id", current_user["id"]).order("created_at", desc=True).execute()
    posts = result.data or []
    for post in posts:
        try:
            c = supabase.table("project_applications").select("id", count="exact") \
                .eq("project_id", post["id"]).execute()
            post["application_count"] = c.count or 0
        except Exception:
            post["application_count"] = 0
    return posts


@router.get("/mine/applications")
def my_applications(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("project_applications").select("*") \
        .eq("applicant_id", current_user["id"]).execute()
    apps = result.data or []
    for app in apps:
        try:
            p = supabase.table("project_posts").select("title, status, owner_id") \
                .eq("id", app["project_id"]).single().execute()
            if p.data:
                app["project"] = p.data
        except Exception:
            app["project"] = None
    return apps


@router.get("/suggested")
def suggested_projects(current_user: dict = Depends(get_current_user)):
    """Returns projects that match user's skills. Empty if no skills set."""
    supabase = get_supabase_admin()
    import os, json, httpx

    user = supabase.table("users").select("skills, department").eq("id", current_user["id"]).single().execute()
    skills = user.data.get("skills", []) if user.data else []
    department = user.data.get("department", "") if user.data else ""

    # No skills = no suggestions
    if not skills:
        return []

    # Get open projects (exclude own, exclude already applied)
    applied = supabase.table("project_applications").select("project_id") \
        .eq("applicant_id", current_user["id"]).execute()
    applied_ids = {a["project_id"] for a in (applied.data or [])}

    result = supabase.table("project_posts").select("*") \
        .eq("status", "open").neq("owner_id", current_user["id"]).execute()
    open_posts = [p for p in (result.data or []) if p["id"] not in applied_ids]

    if not open_posts:
        return []

    # Skill matching — only include posts with score > 0
    skill_lower = [s.lower() for s in skills]
    scored = []
    for post in open_posts:
        tech = [t.lower() for t in (post.get("tech_stack") or [])]
        roles = [r.lower() for r in (post.get("roles_needed") or [])]
        all_tags = tech + roles + [post.get("description", "").lower()]
        score = sum(1 for s in skill_lower if any(s in tag for tag in all_tags))
        if score > 0:
            scored.append((post, score))

    if not scored:
        return []

    scored.sort(key=lambda x: x[1], reverse=True)
    top_posts = [p for p, _ in scored[:6]]

    # Try OpenAI re-ranking if API key available
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key and len(top_posts) > 1:
        try:
            prompt = f"""You are a project matching AI for a university platform.
Student skills: {', '.join(skills)}
Student department: {department}

Projects (JSON):
{json.dumps([{{"id": p["id"], "title": p["title"], "tech_stack": p.get("tech_stack", []), "roles_needed": p.get("roles_needed", [])}} for p in top_posts])}

Return ONLY a JSON array of project ids ordered by relevance (most relevant first), max 3. Example: ["id1","id2"]"""

            response = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}"},
                json={"model": "gpt-4o", "messages": [{"role": "user", "content": prompt}], "max_tokens": 100},
                timeout=10.0,
            )
            if response.status_code == 200:
                content = response.json()["choices"][0]["message"]["content"].strip()
                ids = json.loads(content)
                id_map = {p["id"]: p for p in top_posts}
                reranked = [id_map[i] for i in ids if i in id_map]
                if reranked:
                    return reranked
        except Exception as e:
            print("AI suggestion error:", e)

    return top_posts[:3]


@router.get("/{project_id}")
def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("project_posts").select("*").eq("id", project_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Project not found")
    post = result.data
    # Owner info
    try:
        u = supabase.table("users").select("name, avatar_url, department, year, skills, github_url") \
            .eq("id", post["owner_id"]).single().execute()
        post["owner"] = u.data
    except Exception:
        post["owner"] = None
    # Application count
    try:
        c = supabase.table("project_applications").select("id", count="exact") \
            .eq("project_id", project_id).execute()
        post["application_count"] = c.count or 0
    except Exception:
        post["application_count"] = 0
    return post


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectPostCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("project_posts").insert({
        "title": body.title,
        "description": body.description,
        "owner_id": current_user["id"],
        "tech_stack": body.tech_stack,
        "roles_needed": body.roles_needed,
        "github_url": body.github_url,
        "duration": body.duration,
        "status": "open",
    }).execute()
    return result.data[0]


@router.put("/{project_id}")
def update_project(project_id: str, body: ProjectPostUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    existing = supabase.table("project_posts").select("owner_id").eq("id", project_id).single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Project not found")
    if existing.data["owner_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = supabase.table("project_posts").update(update_data).eq("id", project_id).execute()
    return result.data[0]


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    existing = supabase.table("project_posts").select("owner_id").eq("id", project_id).single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Project not found")
    if existing.data["owner_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    supabase.table("project_posts").delete().eq("id", project_id).execute()


@router.post("/{project_id}/apply", status_code=status.HTTP_201_CREATED)
def apply_to_project(project_id: str, body: ApplicationCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    project = supabase.table("project_posts").select("*").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.data["status"] != "open":
        raise HTTPException(status_code=400, detail="Project is not accepting applications")
    if project.data["owner_id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot apply to your own project")

    existing = supabase.table("project_applications").select("id") \
        .eq("project_id", project_id).eq("applicant_id", current_user["id"]).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Already applied to this project")

    result = supabase.table("project_applications").insert({
        "project_id": project_id,
        "applicant_id": current_user["id"],
        "role": body.role,
        "motivation": body.motivation,
        "status": "pending",
    }).execute()

    send_notification(
        user_id=project.data["owner_id"],
        type="project_application",
        title="New application to your project",
        body=f"{current_user['name']} applied for the {body.role} role in '{project.data['title']}'.",
        link=f"/projects/{project_id}",
    )
    return result.data[0]


@router.get("/{project_id}/applications")
def get_applications(project_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    project = supabase.table("project_posts").select("owner_id").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.data["owner_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    result = supabase.table("project_applications").select("*") \
        .eq("project_id", project_id).order("applied_at", desc=True).execute()
    apps = result.data or []
    # Enrich with applicant info
    for app in apps:
        try:
            u = supabase.table("users").select("name, avatar_url, department, year, skills, github_url") \
                .eq("id", app["applicant_id"]).single().execute()
            app["applicant"] = u.data
        except Exception:
            app["applicant"] = None
    return apps


@router.patch("/{project_id}/applications/{application_id}")
def update_application_status(
    project_id: str, application_id: str,
    body: ApplicationStatusUpdate, current_user: dict = Depends(get_current_user)
):
    if body.status not in ("accepted", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be accepted or rejected")

    supabase = get_supabase_admin()
    project = supabase.table("project_posts").select("owner_id, title").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.data["owner_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    application = supabase.table("project_applications").select("*").eq("id", application_id).single().execute()
    if not application.data:
        raise HTTPException(status_code=404, detail="Application not found")

    result = supabase.table("project_applications").update({
        "status": body.status,
        "rejection_reason": body.reason if body.status == "rejected" else None,
    }).eq("id", application_id).execute()

    # Notify applicant of result
    notif_body = f"Your application for '{project.data['title']}' has been {body.status}."
    if body.status == "rejected" and body.reason:
        notif_body += f" Reason: {body.reason}"

    send_notification(
        user_id=application.data["applicant_id"],
        type="project_application_result",
        title=f"Application {'accepted' if body.status == 'accepted' else 'rejected'}",
        body=notif_body,
        link=f"/projects?tab=my-applications&project={project_id}",
    )

    # If accepted — also send team join notification
    if body.status == "accepted":
        send_notification(
            user_id=application.data["applicant_id"],
            type="project_team_join",
            title="Welcome to the team!",
            body=f"You've been accepted to '{project.data['title']}' as {application.data['role']}. Welcome aboard!",
            link=f"/projects/{project_id}",
        )

    return result.data[0]