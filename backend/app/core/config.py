from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode
from typing import Annotated, Any, List


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
    #
    # NoDecode keeps pydantic-settings from running its default JSON decoder
    # on the raw env value. Without it, "http://a,http://b" would crash at
    # source-load time because it's not valid JSON. The field_validator below
    # then splits the CSV ourselves.
    ALLOWED_ORIGINS: Annotated[List[str], NoDecode] = [
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
    INVITE_ALLOWED_DOMAINS: Annotated[List[str], NoDecode] = ["final.edu.tr"]

    @field_validator("ALLOWED_ORIGINS", "INVITE_ALLOWED_DOMAINS", mode="before")
    @classmethod
    def _split_csv(cls, value: Any) -> Any:
        """Treat env values for these list fields as comma-separated."""
        if isinstance(value, str):
            return [s.strip() for s in value.split(",") if s.strip()]
        return value

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
