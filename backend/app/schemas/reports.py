from pydantic import BaseModel, Field
from typing import Optional


class ReportCreate(BaseModel):
    """A user flags a piece of content (currently chat messages)."""
    content_type: str = Field(default="message", max_length=30)
    content_id: str = Field(..., min_length=1, max_length=100)
    reason: str = Field(..., min_length=1, max_length=1000)
    content_preview: Optional[str] = Field(None, max_length=2000)
    reported_user_id: Optional[str] = None
    chat_id: Optional[str] = None


class ReportStatusUpdate(BaseModel):
    """Admin resolves a report."""
    status: str = Field(..., pattern="^(pending|reviewed|dismissed)$")
