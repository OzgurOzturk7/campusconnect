from pydantic import field_validator
from pydantic_settings import BaseSettings
from typing import List, Any


def _csv_to_list(value: Any) -> Any:
    """Accept comma-separated env values for List[str] fields.

    pydantic-settings v2 tries to JSON-parse complex types by default,
    which made ALLOWED_ORIGINS=http://a,http://b crash on startup. We
    intercept the raw string and split it ourselves; anything else
    (already a list) passes through.
    """
    if isinstance(value, str):
        return [s.strip() for s in value.split(",") if s.strip()]
    return value


class Settings(BaseSettings):
    # App
    APP_NAME: str = "CampusConnect API"
    DEBUG: bool = False

    # Supabase
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    # JWT
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    # CORS — comma-separated list in env, e.g.
    #   ALLOWED_ORIGINS=http://localhost:5173,https://campusconnect.example.com
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
    ]

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""

    # Transactional email (Resend). See app/services/email.py.
    # Leave RESEND_API_KEY empty in dev to log emails instead of sending.
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "onboarding@resend.dev"
    EMAIL_FROM_NAME: str = "CampusConnect"

    # Comma-separated list of email domains the admin can invite users on.
    # Production should keep this locked to the university domain. Dev can
    # add the operator's personal gmail/etc. so it can be tested against
    # Resend's sandbox before a real domain is verified.
    INVITE_ALLOWED_DOMAINS: List[str] = ["final.edu.tr"]

    # Both fields above ship as List[str]; pydantic-settings v2 would
    # otherwise try to JSON-decode their env values. The validator runs
    # *before* type coercion and turns plain CSV into a list.
    _split_origins = field_validator("ALLOWED_ORIGINS", mode="before")(_csv_to_list)
    _split_domains = field_validator("INVITE_ALLOWED_DOMAINS", mode="before")(_csv_to_list)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
