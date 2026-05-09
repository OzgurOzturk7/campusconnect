from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class ProjectPostCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=200)
    description: str = Field(..., min_length=10, max_length=5000)
    tech_stack: List[str] = Field(default_factory=list, max_length=30)
    roles_needed: List[str] = Field(default_factory=list, max_length=20)
    github_url: Optional[str] = Field(None, max_length=500)
    duration: Optional[str] = Field(None, max_length=100)


class ProjectPostUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=200)
    description: Optional[str] = Field(None, min_length=10, max_length=5000)
    tech_stack: Optional[List[str]] = Field(None, max_length=30)
    roles_needed: Optional[List[str]] = Field(None, max_length=20)
    github_url: Optional[str] = Field(None, max_length=500)
    duration: Optional[str] = Field(None, max_length=100)
    status: Optional[str] = Field(None, max_length=20)


class ProjectPostResponse(BaseModel):
    id: str
    title: str
    description: str
    owner_id: str
    tech_stack: List[str]
    roles_needed: List[str]
    status: str
    github_url: Optional[str]
    duration: Optional[str]
    created_at: datetime


class ApplicationCreate(BaseModel):
    role: str = Field(..., min_length=1, max_length=100)
    motivation: str = Field(..., min_length=10, max_length=2000)


class ApplicationResponse(BaseModel):
    id: str
    project_id: str
    applicant_id: str
    role: str
    motivation: str
    status: str
    applied_at: datetime


class ApplicationStatusUpdate(BaseModel):
    status: str = Field(..., max_length=20)
    reason: Optional[str] = Field(None, max_length=1000)
