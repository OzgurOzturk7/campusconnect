from fastapi import APIRouter, HTTPException, status, Depends
from app.schemas.workspaces import (
    WorkspaceStageUpdate, TaskCreate, TaskUpdate,
    TaskCommentCreate, ResourceCreate,
)
from app.schemas.notifications import send_notification
from app.core.supabase import get_supabase_admin
from app.core.security import get_current_user

router = APIRouter()

VALID_STAGES = ("recruiting", "planning", "development", "testing", "launch", "completed")


# ──────────────────────────────────────────────────────────────
# Shared helpers
# ──────────────────────────────────────────────────────────────

def _require_member(supabase, workspace_id: str, user_id: str) -> dict:
    """Return the membership row or raise 403."""
    row = (
        supabase.table("workspace_members")
        .select("role")
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not row or not row.data:
        raise HTTPException(status_code=403, detail="Not a workspace member")
    return row.data


def _require_owner_or_admin(supabase, workspace_id: str, user_id: str):
    m = _require_member(supabase, workspace_id, user_id)
    if m["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Owner or admin access required")


def _log_activity(
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


def _enrich_members(supabase, rows: list) -> list:
    """Attach user profile to each workspace_members row."""
    if not rows:
        return rows
    user_ids = list({r["user_id"] for r in rows})
    users_res = (
        supabase.table("users")
        .select("id, name, avatar_url, department, year")
        .in_("id", user_ids)
        .execute()
    )
    user_map = {u["id"]: u for u in (users_res.data or [])}
    for r in rows:
        r["user"] = user_map.get(r["user_id"])
    return rows


# ──────────────────────────────────────────────────────────────
# Workspace — get by project_id
# ──────────────────────────────────────────────────────────────

@router.get("/project/{project_id}")
def get_workspace(project_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    ws = (
        supabase.table("workspaces")
        .select("*")
        .eq("project_id", project_id)
        .maybe_single()
        .execute()
    )
    if not ws or not ws.data:
        raise HTTPException(status_code=404, detail="Workspace not found")

    workspace = ws.data
    workspace_id = workspace["id"]

    # Access check
    _require_member(supabase, workspace_id, current_user["id"])

    # Attach project info
    proj = (
        supabase.table("project_posts")
        .select("id, title, description, tech_stack, roles_needed, status, github_url, duration, owner_id")
        .eq("id", project_id)
        .single()
        .execute()
    )
    workspace["project"] = proj.data if proj.data else {}

    # Attach project chat id
    chat = (
        supabase.table("chats")
        .select("id")
        .eq("project_id", project_id)
        .maybe_single()
        .execute()
    )
    workspace["chat_id"] = chat.data["id"] if chat and chat.data else None

    # Task counts per status
    task_counts = {"todo": 0, "in_progress": 0, "review": 0, "done": 0}
    tasks_res = (
        supabase.table("workspace_tasks")
        .select("status")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    for t in (tasks_res.data or []):
        s = t.get("status", "todo")
        if s in task_counts:
            task_counts[s] += 1
    workspace["task_counts"] = task_counts

    # Member count
    mem_res = (
        supabase.table("workspace_members")
        .select("user_id", count="exact")
        .eq("workspace_id", workspace_id)
        .execute()
    )
    workspace["member_count"] = mem_res.count or 0

    # Current user's role
    my_row = (
        supabase.table("workspace_members")
        .select("role")
        .eq("workspace_id", workspace_id)
        .eq("user_id", current_user["id"])
        .single()
        .execute()
    )
    workspace["my_role"] = my_row.data["role"] if my_row.data else "member"

    return workspace


# ──────────────────────────────────────────────────────────────
# Stage
# ──────────────────────────────────────────────────────────────

@router.patch("/{workspace_id}/stage")
def update_stage(
    workspace_id: str, body: WorkspaceStageUpdate,
    current_user: dict = Depends(get_current_user),
):
    if body.stage not in VALID_STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Must be one of: {', '.join(VALID_STAGES)}")

    supabase = get_supabase_admin()
    _require_owner_or_admin(supabase, workspace_id, current_user["id"])

    result = (
        supabase.table("workspaces")
        .update({"stage": body.stage})
        .eq("id", workspace_id)
        .execute()
    )
    _log_activity(
        supabase, workspace_id, current_user["id"], "stage_updated",
        metadata={"stage": body.stage},
    )
    return result.data[0]


# ──────────────────────────────────────────────────────────────
# Tasks
# ──────────────────────────────────────────────────────────────

@router.get("/{workspace_id}/tasks")
def list_tasks(workspace_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    result = (
        supabase.table("workspace_tasks")
        .select("*")
        .eq("workspace_id", workspace_id)
        .order("position")
        .order("created_at")
        .execute()
    )
    tasks = result.data or []

    # Enrich with assignee + creator names
    user_ids = list({
        uid
        for t in tasks
        for uid in [t.get("assignee_id"), t.get("created_by")]
        if uid
    })
    if user_ids:
        users_res = (
            supabase.table("users")
            .select("id, name, avatar_url")
            .in_("id", user_ids)
            .execute()
        )
        user_map = {u["id"]: u for u in (users_res.data or [])}
        for t in tasks:
            t["assignee"] = user_map.get(t.get("assignee_id"))
            t["creator"] = user_map.get(t.get("created_by"))

    return tasks


@router.post("/{workspace_id}/tasks", status_code=status.HTTP_201_CREATED)
def create_task(
    workspace_id: str, body: TaskCreate,
    current_user: dict = Depends(get_current_user),
):
    if body.status not in ("todo", "in_progress", "review", "done"):
        raise HTTPException(status_code=400, detail="Invalid status")
    if body.priority not in ("low", "medium", "high", "urgent"):
        raise HTTPException(status_code=400, detail="Invalid priority")

    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    # Place at bottom of that column
    pos_res = (
        supabase.table("workspace_tasks")
        .select("position")
        .eq("workspace_id", workspace_id)
        .eq("status", body.status)
        .order("position", desc=True)
        .limit(1)
        .execute()
    )
    next_pos = ((pos_res.data[0]["position"] + 1) if pos_res.data else 0)

    payload = {
        "workspace_id": workspace_id,
        "title": body.title,
        "description": body.description,
        "assignee_id": body.assignee_id,
        "created_by": current_user["id"],
        "status": body.status,
        "priority": body.priority,
        "due_date": body.due_date.isoformat() if body.due_date else None,
        "position": next_pos,
    }
    result = supabase.table("workspace_tasks").insert(payload).execute()
    task = result.data[0]

    _log_activity(
        supabase, workspace_id, current_user["id"], "task_created",
        entity_type="task", entity_id=task["id"],
        metadata={"title": body.title},
    )
    return task


@router.patch("/{workspace_id}/tasks/{task_id}")
def update_task(
    workspace_id: str, task_id: str, body: TaskUpdate,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    existing = (
        supabase.table("workspace_tasks")
        .select("status, title")
        .eq("id", task_id)
        .eq("workspace_id", workspace_id)
        .single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = body.model_dump(exclude_unset=True)
    if "due_date" in update_data and update_data["due_date"] is not None and hasattr(update_data["due_date"], "isoformat"):
        update_data["due_date"] = update_data["due_date"].isoformat()

    result = (
        supabase.table("workspace_tasks")
        .update(update_data)
        .eq("id", task_id)
        .execute()
    )

    if "status" in update_data and update_data["status"] != existing.data["status"]:
        _log_activity(
            supabase, workspace_id, current_user["id"], "task_moved",
            entity_type="task", entity_id=task_id,
            metadata={
                "title": existing.data["title"],
                "from": existing.data["status"],
                "to": update_data["status"],
            },
        )

    return result.data[0]


@router.delete("/{workspace_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    workspace_id: str, task_id: str,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    task = (
        supabase.table("workspace_tasks")
        .select("created_by, title")
        .eq("id", task_id)
        .eq("workspace_id", workspace_id)
        .single()
        .execute()
    )
    if not task.data:
        raise HTTPException(status_code=404, detail="Task not found")

    # Only creator or owner/admin can delete
    if task.data["created_by"] != current_user["id"]:
        mem = _require_member(supabase, workspace_id, current_user["id"])
        if mem["role"] not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Only the task creator or an admin can delete this task")

    supabase.table("workspace_tasks").delete().eq("id", task_id).execute()
    _log_activity(
        supabase, workspace_id, current_user["id"], "task_deleted",
        metadata={"title": task.data["title"]},
    )


# ──────────────────────────────────────────────────────────────
# Task Comments
# ──────────────────────────────────────────────────────────────

@router.get("/{workspace_id}/tasks/{task_id}/comments")
def list_task_comments(
    workspace_id: str, task_id: str,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    result = (
        supabase.table("workspace_task_comments")
        .select("*")
        .eq("task_id", task_id)
        .order("created_at")
        .execute()
    )
    comments = result.data or []

    user_ids = list({c["user_id"] for c in comments})
    if user_ids:
        users_res = (
            supabase.table("users")
            .select("id, name, avatar_url")
            .in_("id", user_ids)
            .execute()
        )
        user_map = {u["id"]: u for u in (users_res.data or [])}
        for c in comments:
            c["user"] = user_map.get(c["user_id"])

    return comments


@router.post("/{workspace_id}/tasks/{task_id}/comments", status_code=status.HTTP_201_CREATED)
def add_task_comment(
    workspace_id: str, task_id: str, body: TaskCommentCreate,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    result = supabase.table("workspace_task_comments").insert({
        "task_id": task_id,
        "user_id": current_user["id"],
        "body": body.body,
    }).execute()
    comment = result.data[0]
    comment["user"] = {
        "id": current_user["id"],
        "name": current_user["name"],
        "avatar_url": current_user.get("avatar_url"),
    }
    return comment


# ──────────────────────────────────────────────────────────────
# Members
# ──────────────────────────────────────────────────────────────

@router.get("/{workspace_id}/members")
def list_members(workspace_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    result = (
        supabase.table("workspace_members")
        .select("*")
        .eq("workspace_id", workspace_id)
        .order("joined_at")
        .execute()
    )
    return _enrich_members(supabase, result.data or [])


@router.delete("/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    workspace_id: str, user_id: str,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase_admin()

    # Must be owner/admin, or removing yourself
    my_role = _require_member(supabase, workspace_id, current_user["id"])
    if current_user["id"] != user_id and my_role["role"] not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owner/admin can remove other members")

    target = (
        supabase.table("workspace_members")
        .select("role")
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not target or not target.data:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.data["role"] == "owner" and current_user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Cannot remove the project owner")

    supabase.table("workspace_members").delete().eq("workspace_id", workspace_id).eq("user_id", user_id).execute()
    _log_activity(
        supabase, workspace_id, current_user["id"], "member_removed",
        metadata={"removed_user_id": user_id},
    )


# ──────────────────────────────────────────────────────────────
# Resources
# ──────────────────────────────────────────────────────────────

@router.get("/{workspace_id}/resources")
def list_resources(workspace_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    result = (
        supabase.table("workspace_resources")
        .select("*")
        .eq("workspace_id", workspace_id)
        .order("created_at", desc=True)
        .execute()
    )
    resources = result.data or []

    user_ids = list({r["added_by"] for r in resources})
    if user_ids:
        users_res = (
            supabase.table("users")
            .select("id, name, avatar_url")
            .in_("id", user_ids)
            .execute()
        )
        user_map = {u["id"]: u for u in (users_res.data or [])}
        for r in resources:
            r["added_by_user"] = user_map.get(r["added_by"])

    return resources


@router.post("/{workspace_id}/resources", status_code=status.HTTP_201_CREATED)
def add_resource(
    workspace_id: str, body: ResourceCreate,
    current_user: dict = Depends(get_current_user),
):
    valid_types = ("github", "figma", "drive", "notion", "meeting", "link")
    if body.type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid type. Must be one of: {', '.join(valid_types)}")

    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    result = supabase.table("workspace_resources").insert({
        "workspace_id": workspace_id,
        "added_by": current_user["id"],
        "title": body.title,
        "url": body.url,
        "type": body.type,
    }).execute()
    resource = result.data[0]

    _log_activity(
        supabase, workspace_id, current_user["id"], "resource_added",
        entity_type="resource", entity_id=resource["id"],
        metadata={"title": body.title, "type": body.type},
    )
    return resource


@router.delete("/{workspace_id}/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(
    workspace_id: str, resource_id: str,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase_admin()

    res = (
        supabase.table("workspace_resources")
        .select("added_by")
        .eq("id", resource_id)
        .eq("workspace_id", workspace_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(status_code=404, detail="Resource not found")

    if res.data["added_by"] != current_user["id"]:
        _require_owner_or_admin(supabase, workspace_id, current_user["id"])

    supabase.table("workspace_resources").delete().eq("id", resource_id).execute()
    _log_activity(
        supabase, workspace_id, current_user["id"], "resource_removed",
        entity_type="resource", entity_id=resource_id,
    )


# ──────────────────────────────────────────────────────────────
# Activity Feed
# ──────────────────────────────────────────────────────────────

@router.get("/{workspace_id}/activity")
def get_activity(
    workspace_id: str,
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_supabase_admin()
    _require_member(supabase, workspace_id, current_user["id"])

    result = (
        supabase.table("workspace_activity_logs")
        .select("*")
        .eq("workspace_id", workspace_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    logs = result.data or []

    user_ids = list({l["actor_id"] for l in logs if l.get("actor_id")})
    if user_ids:
        users_res = (
            supabase.table("users")
            .select("id, name, avatar_url")
            .in_("id", user_ids)
            .execute()
        )
        user_map = {u["id"]: u for u in (users_res.data or [])}
        for l in logs:
            l["actor"] = user_map.get(l.get("actor_id"))

    return logs
