from pydantic_settings import BaseSettings
from typing import List


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
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"]

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""

    # Transactional email (Resend). See app/services/email.py.
    # Leave RESEND_API_KEY empty in dev to log emails instead of sending.
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "onboarding@resend.dev"
    EMAIL_FROM_NAME: str = "CampusConnect"

    @classmethod
    def parse_env_var(cls, field_name: str, raw_val: str):
        """Parse ALLOWED_ORIGINS from a comma-separated string."""
        if field_name == "ALLOWED_ORIGINS":
            return [s.strip() for s in raw_val.split(",") if s.strip()]
        return raw_val

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()