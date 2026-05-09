from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ClubCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: str = Field(..., min_length=10, max_length=2000)
    category: str = Field(..., min_length=1, max_length=50)
    is_open: bool = True


class ClubUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    description: Optional[str] = Field(None, min_length=10, max_length=2000)
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
    description: str = Field(..., min_length=10, max_length=2000)


class ClubRequestReview(BaseModel):
    status: str = Field(..., max_length=20)
    review_note: Optional[str] = Field(None, max_length=1000)


class AnnouncementCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=5000)
