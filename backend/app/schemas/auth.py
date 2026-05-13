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
    # True when the user is signed in with a system-issued temporary password
    # and the frontend must force them through /onboarding to set a real one.
    must_change_password: bool = False


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
    must_change_password: bool = False


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
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


class ChangePasswordRequest(BaseModel):
    """Authenticated user changing their own password.

    The current_password check defends against an attacker with a stolen
    session token escalating to full account takeover via password reset.
    """
    current_password: str = Field(..., min_length=1, max_length=200)
    new_password: str = Field(..., min_length=8, max_length=200)


class ForgotPasswordRequest(BaseModel):
    """Public endpoint — accepts an email and triggers a reset link if a
    matching user exists. Always succeeds (no email enumeration).
    """
    email: EmailStr


class InviteUserRequest(BaseModel):
    """Admin onboards a new university member.

    The server generates a temporary password, creates the auth + profile
    rows, emails the temp password to the user, and flags the account
    `must_change_password=True` so first login forces a real password.
    """
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    role: str = Field(default="student", pattern="^(student|admin)$")
