from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File
from app.schemas.study_groups import StudyGroupCreate, StudyGroupUpdate, MessageCreate, MemberStatusUpdate
from app.schemas.notifications import send_notification
from app.core.supabase import get_supabase, get_supabase_admin
from app.core.security import get_current_user
import uuid

router = APIRouter()


@router.get("/")
def list_groups(current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("study_groups").select("*").eq("is_active", True).order("created_at", desc=True).execute()
    return result.data


@router.get("/{group_id}")
def get_group(group_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("study_groups").select("*").eq("id", group_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Study group not found")
    return result.data


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_group(body: StudyGroupCreate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("study_groups").insert({
        "course_name": body.course_name,
        "course_code": body.course_code,
        "description": body.description,
        "creator_id": current_user["id"],
        "university": body.university or current_user.get("university"),
        "is_active": True,
        "is_private": body.is_private,
    }).execute()

    group = result.data[0]

    supabase.table("study_group_members").insert({
        "group_id": group["id"],
        "user_id": current_user["id"],
        "status": "approved",
    }).execute()

    return group


@router.put("/{group_id}")
def update_group(group_id: str, body: StudyGroupUpdate, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    group = supabase.table("study_groups").select("creator_id").eq("id", group_id).single().execute()
    if not group.data:
        raise HTTPException(status_code=404, detail="Study group not found")
    if group.data["creator_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    update_data = {k: v for k, v in body.model_dump().items() if v is not None}
    result = supabase.table("study_groups").update(update_data).eq("id", group_id).execute()
    return result.data[0]


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(group_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    group = supabase.table("study_groups").select("creator_id").eq("id", group_id).single().execute()
    if not group.data:
        raise HTTPException(status_code=404, detail="Study group not found")
    if group.data["creator_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    supabase.table("study_groups").delete().eq("id", group_id).execute()


@router.post("/{group_id}/join", status_code=status.HTTP_201_CREATED)
def join_group(group_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    group = supabase.table("study_groups").select("*").eq("id", group_id).single().execute()
    if not group.data:
        raise HTTPException(status_code=404, detail="Study group not found")

    existing = supabase.table("study_group_members").select("id, status").eq("group_id", group_id).eq("user_id", current_user["id"]).execute()
    if existing.data:
        raise HTTPException(status_code=400, detail="Already a member or request pending")

    member_status = "pending" if group.data.get("is_private") else "approved"

    result = supabase.table("study_group_members").insert({
        "group_id": group_id,
        "user_id": current_user["id"],
        "status": member_status,
    }).execute()

    if member_status == "pending":
        send_notification(
            user_id=group.data["creator_id"],
            type="study_join_request",
            title="New join request",
            body=f"{current_user['name']} wants to join your study group '{group.data['course_name']}'.",
            link="/study-groups",
        )

    return result.data[0]


@router.delete("/{group_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
def leave_group(group_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    supabase.table("study_group_members").delete().eq("group_id", group_id).eq("user_id", current_user["id"]).execute()


@router.get("/{group_id}/members")
def get_members(group_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()
    result = supabase.table("study_group_members").select("*, users(id, name, avatar_url)").eq("group_id", group_id).execute()
    return result.data


@router.patch("/{group_id}/members/{user_id}")
def update_member_status(
    group_id: str,
    user_id: str,
    body: MemberStatusUpdate,
    current_user: dict = Depends(get_current_user)
):
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected")

    supabase = get_supabase_admin()
    group = supabase.table("study_groups").select("creator_id, course_name").eq("id", group_id).single().execute()
    if not group.data:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.data["creator_id"] != current_user["id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")

    result = supabase.table("study_group_members").update({"status": body.status}).eq("group_id", group_id).eq("user_id", user_id).execute()

    send_notification(
        user_id=user_id,
        type="study_join_result",
        title=f"Join request {body.status}",
        body=f"Your request to join '{group.data['course_name']}' has been {body.status}.",
        link="/study-groups",
    )

    return result.data[0]


@router.get("/{group_id}/messages")
def get_messages(group_id: str, current_user: dict = Depends(get_current_user)):
    supabase = get_supabase_admin()

    membership = supabase.table("study_group_members").select("status").eq("group_id", group_id).eq("user_id", current_user["id"]).execute()
    if not membership.data or membership.data[0]["status"] != "approved":
        raise HTTPException(status_code=403, detail="You must be an approved member to read messages")

    result = (
        supabase.table("study_messages")
        .select("*, users(id, name, avatar_url)")
        .eq("group_id", group_id)
        .order("created_at")
        .limit(100)
        .execute()
    )
    return result.data


@router.post("/{group_id}/messages", status_code=status.HTTP_201_CREATED)
def send_message(group_id: str, body: MessageCreate, current_user: dict = Depends(get_current_user)):
    if not body.content and not body.file_url:
        raise HTTPException(status_code=400, detail="Message must have content or file")

    supabase = get_supabase_admin()

    membership = supabase.table("study_group_members").select("status").eq("group_id", group_id).eq("user_id", current_user["id"]).execute()
    if not membership.data or membership.data[0]["status"] != "approved":
        raise HTTPException(status_code=403, detail="You must be an approved member to send messages")

    result = supabase.table("study_messages").insert({
        "group_id": group_id,
        "sender_id": current_user["id"],
        "content": body.content,
        "file_url": body.file_url,
        "file_name": body.file_name,
    }).execute()

    if body.file_url:
        group = supabase.table("study_groups").select("course_name").eq("id", group_id).single().execute()
        members = supabase.table("study_group_members").select("user_id").eq("group_id", group_id).eq("status", "approved").execute()
        for member in members.data:
            if member["user_id"] != current_user["id"]:
                send_notification(
                    user_id=member["user_id"],
                    type="study_file_upload",
                    title="New file in study group",
                    body=f"{current_user['name']} uploaded {body.file_name} to {group.data['course_name']} group.",
                    link="/study-groups",
                )

    return result.data[0]


@router.post("/{group_id}/upload")
async def upload_file(
    group_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):
    supabase_admin = get_supabase_admin()

    membership = supabase_admin.table("study_group_members").select("status").eq("group_id", group_id).eq("user_id", current_user["id"]).execute()
    if not membership.data or membership.data[0]["status"] != "approved":
        raise HTTPException(status_code=403, detail="Not authorized")

    file_content = await file.read()
    file_ext = file.filename.split(".")[-1] if "." in file.filename else ""
    file_path = f"{group_id}/{uuid.uuid4()}.{file_ext}"

    supabase_admin.storage.from_("study-files").upload(
        path=file_path,
        file=file_content,
        file_options={"content-type": file.content_type}
    )

    file_url = supabase_admin.storage.from_("study-files").get_public_url(file_path)
    return {"file_url": file_url, "file_name": file.filename}