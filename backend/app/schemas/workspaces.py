from pydantic import BaseModel
from typing import Optional
from datetime import date


class WorkspaceStageUpdate(BaseModel):
    stage: str


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    assignee_id: Optional[str] = None
    status: str = "todo"
    priority: str = "medium"
    due_date: Optional[date] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    assignee_id: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[date] = None
    position: Optional[int] = None


class TaskCommentCreate(BaseModel):
    body: str


class ResourceCreate(BaseModel):
    title: str
    url: str
    type: str = "link"
