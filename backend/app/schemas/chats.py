from pydantic import BaseModel, Field
from typing import Optional, List


class ChatCreate(BaseModel):
    type: str = Field(..., max_length=20)  # 'direct' | 'group'
    title: Optional[str] = Field(None, max_length=100)
    member_ids: List[str] = Field(default_factory=list, max_length=100)  # other user ids


class ChatUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=100)
    avatar_url: Optional[str] = Field(None, max_length=500)


class MessageCreate(BaseModel):
    body: Optional[str] = Field(None, max_length=4000)
    attachment_url: Optional[str] = Field(None, max_length=1000)
    attachment_type: Optional[str] = Field(None, max_length=20)  # 'image' | 'video' | 'file' | 'audio'
    attachment_name: Optional[str] = Field(None, max_length=300)
    reply_to_id: Optional[str] = None
    # User IDs the message tags via @mention. The server validates that
    # each one is actually a member of the chat before notifying — clients
    # can't escalate a mention into a notification to anyone they want.
    mentions: List[str] = Field(default_factory=list, max_length=20)


class MessageEdit(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)


class ReactionToggle(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=20)


class MemberAdd(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=100)


class MuteUpdate(BaseModel):
    is_muted: bool


class MarkReadUpdate(BaseModel):
    last_read_at: Optional[str] = Field(None, max_length=50)  # ISO string; defaults to now() server-side
