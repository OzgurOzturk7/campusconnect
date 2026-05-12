from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from app.schemas.projects import (
    ProjectPostCreate, ProjectPostUpdate,
    ApplicationCreate, ApplicationStatusUpdate
)
from app.schemas.notifications import send_notification
from app.core.supabase import get_supabase_admin
from app.core.security import get_current_user
from datetime import date, datetime, timezone
import logging
import os
import time
import uuid

logger = logging.getLogger(__name__)

router = APIRouter()

CV_BUCKET = "applications-cv"
ALLOWED_CV_MIMES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
# Some clients (curl, certain browsers, mobile uploaders) submit PDFs as
# application/octet-stream. Fall back to extension when content_type is generic.
EXT_TO_MIME = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_CV_BYTES = 10 * 1024 * 1024  # 10 MB

# Non-admin users may publish at most this many projects per calendar month.
PROJECT_MONTHLY_LIMIT = 3


# ============================================================
# Project chat helpers (auto-managed group chats per project)
# ============================================================
def _get_or_create_project_chat(supabase, project_id: str, title: str, owner_id: str) -> str:
    """Return chat id for a project; create it if missing."""
    existing = supabase.table("chats").select("id").eq("project_id", project_id).maybe_single().execute()
    if existing and existing.data:
        return existing.data["id"]
    new_chat = supabase.table("chats").insert({
        "type": "project",
        "title": title,
        "project_id": project_id,
        "created_by": owner_id,
    }).execute().data[0]
    supabase.table("chat_members").insert({
        "chat_id": new_chat["id"], "user_id": owner_id, "role": "admin",
    }).execute()
    return new_chat["id"]


def _add_to_project_chat(supabase, project_id: str, user_id: str):
    chat = supabase.table("chats").select("id").eq("project_id", project_id).maybe_single().execute()
    if not chat or not chat.data:
        return
    chat_id = chat.data["id"]
    exists = supabase.table("chat_members").select("user_id") \
        .eq("chat_id", chat_id).eq("user_id", user_id).maybe_single().execute()
    if exists and exists.data:
        return
    supabase.table("chat_members").insert({
        "chat_id": chat_id, "user_id": user_id, "role": "member",
    }).execute()


# ============================================================
# Workspace helpers (auto-managed per project)
# ============================================================
def _get_or_create_workspace(supabase, project_id: str, owner_id: str) -> dict:
    """Return workspace for a project; create it (with owner) if missing."""
    existing = supabase.table("workspaces").select("*").eq("project_id", project_id).maybe_single().execute()
    if existing and existing.data:
        return existing.data
    ws = supabase.table("workspaces").insert({
        "project_id": project_id,
        "stage": "recruiting",
    }).execute().data[0]
    supabase.table("workspace_members").insert({
        "workspace_id": ws["id"], "user_id": owner_id, "role": "owner",
    }).execute()
    _log_workspace_activity(supabase, ws["id"], owner_id, "workspace_created")
    return ws


def _add_to_workspace(supabase, workspace_id: str, user_id: str, role: str = "member"):
    exists = (
        supabase.table("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if exists and exists.data:
        return
    supabase.table("workspace_members").insert({
        "workspace_id": workspace_id, "user_id": user_id, "role": role,
    }).execute()


def _log_workspace_activity(
    supabase, workspace_id: str, actor_id: str, action: str,
    entity_type: str = None, entity_id: str = None, metadata: dict = None,
):
    supabase.table("workspace_activity_logs").insert({
        "workspace_id": workspace_id,
        "actor_id": actor_id,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "metadata": metadata or {},
    }).execute()


def _remove_from_project_chat(supabase, project_id: str, user_id: str):
    chat = supabase.table("chats").select("id").eq("project_id", project_id).maybe_single().execute()
    if not chat or not chat.data:
        return
    supabase.table("chat_members").delete() \
        .eq("chat_id", chat.data["id"]).eq("user_id", user_id).execute()


@router.get("/")
def list_projects(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
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


@router.get("/mine/projects")
def my_projects(current_user: dict = Depends(get_current_user)):
    """Projects the user is actively part of (accepted applications + own projects)."""
    supabase = get_supabase_admin()

    accepted = supabase.table("project_applications").select("project_id") \
        .eq("applicant_id", current_user["id"]).eq("status", "accepted").execute()
    accepted_ids = {a["project_id"] for a in (accepted.data or [])}

    own = supabase.table("project_posts").select("id").eq("owner_id", current_user["id"]).execute()
    own_ids = {p["id"] for p in (own.data or [])}

    all_ids = list(accepted_ids | own_ids)
    if not all_ids:
        return []

    result = supabase.table("project_posts").select(
        "*, users!owner_id(name, avatar_url, department, year), project_applications(count)"
    ).in_("id", all_ids).order("created_at", desc=True).execute()

    posts = result.data or []
    for post in posts:
        owner = post.pop("users", None)
        post["owner"] = owner
        apps = post.pop("project_applications", [])
        post["application_count"] = apps[0]["count"] if apps else 0
        post["my_role"] = "owner" if post["owner_id"] == current_user["id"] else "member"
    return posts


def _resolve_cv_mime(file: UploadFile) -> str | None:
    """Pick a usable mime type for a CV upload.
    Returns None if the file is not a permitted CV type.
    Falls back to extension when the client sends `application/octet-stream`
    or no Content-Type at all.
    """
    declared = (file.content_type or "").lower().strip()
    if declared in ALLOWED_CV_MIMES:
        return declared
    name = (file.filename or "").lower()
    _, ext = os.path.splitext(name)
    fallback = EXT_TO_MIME.get(ext)
    if fallback:
        return fallback
    return None


def _upload_with_retry(bucket, path: str, body: bytes, content_type: str, *, attempts: int = 3) -> None:
    """Upload to Supabase Storage with retry on transient failures.
    Re-raises the last exception if all attempts fail.
    """
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            bucket.upload(path, body, {"content-type": content_type})
            return
        except Exception as e:
            last_exc = e
            # Storage SDK raises a generic exception; treat permanent errors
            # (auth, RLS, missing bucket) as non-retryable so we fail fast.
            msg = str(e).lower()
            if any(s in msg for s in ("bucket not found", "row-level security", "unauthorized", "forbidden")):
                raise
            if i + 1 < attempts:
                time.sleep(0.4 * (2 ** i))  # 0.4s, 0.8s
    if last_exc:
        raise last_exc


@router.post("/upload-cv")
async def upload_cv(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload a CV file (PDF or Word) for use with a project application.

    Failure modes:
      * 415 — unsupported file type (mime + extension both unrecognized)
      * 413 — file exceeds MAX_CV_BYTES
      * 400 — empty file
      * 500 — Supabase Storage rejected the write (logged with full traceback)
    """
    supabase = get_supabase_admin()

    content_type = _resolve_cv_mime(file)
    if not content_type:
        raise HTTPException(
            status_code=415,
            detail="Only PDF or Word (.pdf/.doc/.docx) documents are allowed.",
        )

    try:
        contents = await file.read()
    except Exception as e:
        logger.exception("upload_cv: failed reading upload stream user=%s", current_user.get("id"))
        raise HTTPException(status_code=400, detail="Couldn't read the uploaded file.") from e

    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(contents) > MAX_CV_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_CV_BYTES // (1024*1024)} MB.",
        )

    safe_name = (file.filename or "cv").replace("/", "_").replace("\\", "_").strip()[:200] or "cv"
    object_path = f"{current_user['id']}/{uuid.uuid4().hex}_{safe_name}"

    bucket = supabase.storage.from_(CV_BUCKET)
    try:
        _upload_with_retry(bucket, object_path, contents, content_type)
    except Exception as e:
        # Log the real error server-side; return a generic but actionable message to the client.
        logger.exception(
            "upload_cv: storage upload failed user=%s bucket=%s path=%s size=%d",
            current_user.get("id"), CV_BUCKET, object_path, len(contents),
        )
        msg = str(e).lower()
        if "bucket not found" in msg:
            raise HTTPException(status_code=500, detail="Storage bucket is missing. Contact support.") from e
        if "row-level security" in msg or "unauthorized" in msg:
            raise HTTPException(status_code=500, detail="Storage policy rejected the upload. Contact support.") from e
        raise HTTPException(status_code=500, detail="Upload failed. Please try again in a moment.") from e

    try:
        signed = bucket.create_signed_url(object_path, 60 * 60 * 24 * 30)
        url = (
            signed.get("signedURL")
            or signed.get("signed_url")
            or signed.get("signedUrl")
            if isinstance(signed, dict) else None
        )
        if not url:
            raise RuntimeError(f"signed URL response missing url field: {signed!r}")
    except Exception as e:
        logger.exception("upload_cv: signed URL failed user=%s path=%s", current_user.get("id"), object_path)
        raise HTTPException(
            status_code=500,
            detail="File uploaded but couldn't generate a preview link. Try again.",
        ) from e

    logger.info(
        "upload_cv: ok user=%s bucket=%s path=%s size=%d type=%s",
        current_user.get("id"), CV_BUCKET, object_path, len(contents), content_type,
    )
    return {"url": url, "name": safe_name}


@router.get("/suggested")
def suggested_projects(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    import os, json, httpx

    user = supabase.table("users").select("skills, department").eq("id", current_user["id"]).single().execute()
    skills = user.data.get("skills", []) if user.data else []
    department = user.data.get("department", "") if user.data else ""

    if not skills:
        return []

    applied = supabase.table("project_applications").select("project_id") \
        .eq("applicant_id", current_user["id"]).execute()
    applied_ids = {a["project_id"] for a in (applied.data or [])}

    result = supabase.table("project_posts").select("*") \
        .eq("status", "open").neq("owner_id", current_user["id"]).execute()
    open_posts = [p for p in (result.data or []) if p["id"] not in applied_ids]

    if not open_posts:
        return []

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

    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key and len(top_posts) > 1:
        try:
            prompt = f"""You are a project matching AI for a university platform.
Student skills: {', '.join(skills)}
Student department: {department}

Projects (JSON):
{json.dumps([{{"id": p["id"], "title": p["title"], "tech_stack": p.get("tech_stack", []), "roles_needed": p.get("roles_needed", [])}} for p in top_posts])}

Return ONLY a JSON array of project ids ordered by relevance (most relevant first), max 3."""

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
    try:
        u = supabase.table("users").select("name, avatar_url, department, year, skills, github_url") \
            .eq("id", post["owner_id"]).single().execute()
        post["owner"] = u.data
    except Exception:
        post["owner"] = None
    try:
        c = supabase.table("project_applications").select("id", count="exact") \
            .eq("project_id", project_id).execute()
        post["application_count"] = c.count or 0
    except Exception:
        post["application_count"] = 0
    return post


def _month_window_iso() -> tuple[str, str]:
    """First-of-this-month and first-of-next-month as ISO strings (UTC).
    Used to count projects published within the current calendar month.
    """
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # First day of next month
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start.isoformat(), end.isoformat()


def _published_this_month(supabase, user_id: str) -> int:
    start_iso, end_iso = _month_window_iso()
    res = (
        supabase.table("project_posts")
        .select("id", count="exact")
        .eq("owner_id", user_id)
        .gte("created_at", start_iso)
        .lt("created_at", end_iso)
        .execute()
    )
    return res.count or 0


def _publish_resets_at_iso() -> str:
    _, end_iso = _month_window_iso()
    return end_iso


@router.get("/limit-info")
def project_limit_info(current_user: dict = Depends(get_current_user)):
    """How many more projects the current user can publish this month.

    Admins are unrestricted. Non-admins are capped at PROJECT_MONTHLY_LIMIT.
    Frontend renders this to warn users before they hit the wall.
    """
    if current_user.get("role") == "admin":
        return {
            "limit": None,
            "used": 0,
            "remaining": None,
            "resets_at": None,
            "is_admin": True,
        }
    supabase = get_supabase_admin()
    used = _published_this_month(supabase, current_user["id"])
    return {
        "limit": PROJECT_MONTHLY_LIMIT,
        "used": used,
        "remaining": max(0, PROJECT_MONTHLY_LIMIT - used),
        "resets_at": _publish_resets_at_iso(),
        "is_admin": False,
    }


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectPostCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    # Server-authoritative monthly publish cap. Admins are exempt.
    if current_user.get("role") != "admin":
        used = _published_this_month(supabase, current_user["id"])
        if used >= PROJECT_MONTHLY_LIMIT:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Monthly publish limit reached ({PROJECT_MONTHLY_LIMIT} per month). "
                    "Try again next month."
                ),
            )

    result = supabase.table("project_posts").insert({
        "title": body.title,
        "description": body.description,
        "owner_id": current_user["id"],
        "tech_stack": body.tech_stack,
        "roles_needed": body.roles_needed,
        "github_url": body.github_url,
        "duration": body.duration,
        "start_date": body.start_date.isoformat() if body.start_date else None,
        "deadline": body.deadline.isoformat() if body.deadline else None,
        "status": "open",
    }).execute()
    project = result.data[0]

    # Auto-create the project group chat with the owner as admin
    try:
        _get_or_create_project_chat(supabase, project["id"], project["title"], current_user["id"])
    except Exception as e:
        print("PROJECT CHAT CREATE ERROR:", e)

    # Auto-create the workspace with the owner as owner
    try:
        _get_or_create_workspace(supabase, project["id"], current_user["id"])
    except Exception as e:
        print("WORKSPACE CREATE ERROR:", e)

    return project


@router.put("/{project_id}")
def update_project(project_id: str, body: ProjectPostUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    existing = supabase.table("project_posts").select("owner_id").eq("id", project_id).single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Project not found")
    if existing.data["owner_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    # Serialize dates → ISO strings
    for k in ("start_date", "deadline"):
        if k in update_data and hasattr(update_data[k], "isoformat"):
            update_data[k] = update_data[k].isoformat()
    result = supabase.table("project_posts").update(update_data).eq("id", project_id).execute()

    # Sync project chat title if title changed
    if "title" in update_data:
        try:
            supabase.table("chats").update({"title": update_data["title"]}).eq("project_id", project_id).execute()
        except Exception as e:
            print("PROJECT CHAT TITLE SYNC ERROR:", e)

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
        "cv_url": body.cv_url,
        "links": [l.model_dump() for l in (body.links or [])],
        "status": "pending",
    }).execute()

    send_notification(
        user_id=project.data["owner_id"],
        type="project_application",
        title="New application to your project",
        body=f"{current_user['name']} applied for the {body.role} role in '{project.data['title']}'.",
        link="/projects",
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

    if body.status == "rejected" and not (body.reason and body.reason.strip()):
        raise HTTPException(status_code=400, detail="A rejection reason is required.")

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

    notif_body = f"Your application for '{project.data['title']}' has been {body.status}."
    if body.status == "rejected" and body.reason:
        notif_body += f" Reason: {body.reason}"

    send_notification(
        user_id=application.data["applicant_id"],
        type="project_application_result",
        title=f"Application {'accepted' if body.status == 'accepted' else 'rejected'}",
        body=notif_body,
        link="/projects",
    )

    if body.status == "accepted":
        send_notification(
            user_id=application.data["applicant_id"],
            type="project_team_join",
            title="Welcome to the team!",
            body=f"You've been accepted to '{project.data['title']}' as {application.data['role']}. Welcome aboard!",
            link=f"/projects/{project_id}/workspace",
        )
        # Auto-add to project chat (creating it if it doesn't exist for legacy projects)
        try:
            _get_or_create_project_chat(supabase, project_id, project.data["title"], project.data["owner_id"])
            _add_to_project_chat(supabase, project_id, application.data["applicant_id"])
        except Exception as e:
            print("PROJECT CHAT MEMBER ADD ERROR:", e)
        # Auto-add to workspace
        try:
            ws = _get_or_create_workspace(supabase, project_id, project.data["owner_id"])
            _add_to_workspace(supabase, ws["id"], application.data["applicant_id"], "member")
            _log_workspace_activity(
                supabase, ws["id"], application.data["applicant_id"], "member_joined",
                metadata={"role": application.data.get("role", "member")},
            )
        except Exception as e:
            print("WORKSPACE MEMBER ADD ERROR:", e)

    return result.data[0]