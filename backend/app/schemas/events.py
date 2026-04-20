from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class EventCreate(BaseModel):
    title: str
    description: str
    club_id: Optional[str] = None
    event_date: datetime
    location: str
    capacity: Optional[int] = None
    is_school_wide: bool = False
    is_members_only: bool = False


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[datetime] = None
    location: Optional[str] = None
    capacity: Optional[int] = None
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