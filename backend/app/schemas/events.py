from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class EventCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    description: str = Field(..., min_length=1, max_length=5000)
    club_id: Optional[str] = None
    event_date: datetime
    location: str = Field(..., min_length=1, max_length=300)
    capacity: Optional[int] = Field(None, ge=1, le=10000)
    is_school_wide: bool = False
    is_members_only: bool = False


class EventUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    event_date: Optional[datetime] = None
    location: Optional[str] = Field(None, max_length=300)
    capacity: Optional[int] = Field(None, ge=1, le=10000)
    is_members_only: Optional[bool] = None


class EventResponse(BaseModel):
    id: str
    title: str
    description: str
    club_id: Optional[str]
    created_by: str
    event_date: datetime
    location: str
    capacity: Optional[int]
    is_school_wide: bool
    is_members_only: bool
    cover_url: Optional[str]
    created_at: datetime
