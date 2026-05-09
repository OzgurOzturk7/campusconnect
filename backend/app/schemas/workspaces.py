from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class WorkspaceStageUpdate(BaseModel):
    stage: str = Field(..., max_length=50)


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    assignee_id: Optional[str] = None
    status: str = Field("todo", max_length=20)
    priority: str = Field("medium", max_length=20)
    due_date: Optional[date] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    assignee_id: Optional[str] = None
    status: Optional[str] = Field(None, max_length=20)
    priority: Optional[str] = Field(None, max_length=20)
    due_date: Optional[date] = None
    position: Optional[int] = None


class TaskCommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)


class ResourceCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    url: str = Field(..., min_length=1, max_length=500)
    type: str = Field("link", max_length=20)
