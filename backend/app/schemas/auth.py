from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)


class GoogleLoginRequest(BaseModel):
    credential: str = Field(..., min_length=10, max_length=4000)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: str
    name: str
    email: str


class UserPublic(BaseModel):
    id: str
    email: str
    name: str
    role: str
    university: Optional[str] = None
    department: Optional[str] = None
    year: Optional[int] = None
    avatar_url: Optional[str] = None
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    bio: Optional[str] = None
    skills: Optional[list] = []
    courses: Optional[list] = []


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    university: Optional[str] = Field(None, max_length=200)
    department: Optional[str] = Field(None, max_length=200)
    year: Optional[int] = Field(None, ge=1, le=10)
    github_url: Optional[str] = Field(None, max_length=500)
    linkedin_url: Optional[str] = Field(None, max_length=500)
    bio: Optional[str] = Field(None, max_length=2000)
    skills: Optional[List[str]] = Field(None, max_length=50)
    courses: Optional[List[str]] = Field(None, max_length=50)


class AIAnalysisResponse(BaseModel):
    missing_fields: List[str] = []
    tips: List[str] = []
    club_suggestions: List[str] = []
    event_suggestions: List[str] = []
