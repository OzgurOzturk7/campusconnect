from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ClubCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: str = Field(..., min_length=1, max_length=2000)
    category: str = Field(..., min_length=1, max_length=50)
    is_open: bool = True


class ClubUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    category: Optional[str] = Field(None, max_length=50)
    is_open: Optional[bool] = None


class ClubResponse(BaseModel):
    id: str
    name: str
    description: str
    category: str
    logo_url: Optional[str]
    cover_url: Optional[str]
    admin_user_id: str
    is_open: bool
    status: str
    created_at: datetime


class MembershipStatusUpdate(BaseModel):
    status: str = Field(..., max_length=20)


class ClubRequestCreate(BaseModel):
    club_name: str = Field(..., min_length=2, max_length=100)
    category: str = Field(..., min_length=1, max_length=50)
    description: str = Field(..., min_length=1, max_length=2000)
    # Why the requester wants this club. Helps admins decide; shown
    # alongside the request in the admin panel.
    motivation: Optional[str] = Field(None, max_length=2000)
    # Whether the resulting club is open to anyone (True) or membership-
    # gated (False). Carried through to clubs.is_open on approval.
    is_open: bool = True


class ClubRequestReview(BaseModel):
    """Admin verdict on a pending club request.

    `review_note` is required when status='rejected' so the requester
    gets actionable feedback in the notification. The router enforces
    this — the field stays optional at the schema level so an accepted
    request doesn't need a note.
    """
    status: str = Field(..., max_length=20)
    review_note: Optional[str] = Field(None, max_length=1000)


class AnnouncementCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=5000)
