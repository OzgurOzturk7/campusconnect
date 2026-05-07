from pydantic import BaseModel
from typing import Optional, List


class ChatCreate(BaseModel):
    type: str  # 'direct' | 'group'
    title: Optional[str] = None
    member_ids: List[str] = []  # other user ids


class ChatUpdate(BaseModel):
    title: Optional[str] = None
    avatar_url: Optional[str] = None


class MessageCreate(BaseModel):
    body: Optional[str] = None
    attachment_url: Optional[str] = None
    attachment_type: Optional[str] = None  # 'image' | 'video' | 'file' | 'audio'
    attachment_name: Optional[str] = None
    reply_to_id: Optional[str] = None


class MessageEdit(BaseModel):
    body: str


class ReactionToggle(BaseModel):
    emoji: str


class MemberAdd(BaseModel):
    user_id: str


class MuteUpdate(BaseModel):
    is_muted: bool


class MarkReadUpdate(BaseModel):
    last_read_at: Optional[str] = None  # ISO string; defaults to now() server-side
