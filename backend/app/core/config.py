from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _split_csv(raw: str) -> list[str]:
    return [s.strip() for s in raw.split(",") if s.strip()]


class Settings(BaseSettings):
    """App configuration sourced from environment + .env file.

    Why the *_RAW fields and the matching properties?
    -------------------------------------------------
    pydantic-settings v2 tries to JSON-decode any field typed as `List[str]`
    when it reads from env. `ALLOWED_ORIGINS=http://a,http://b` would crash
    startup because that string isn't JSON. NoDecode (the official escape
    hatch) isn't available in every 2.x sub-version, so we sidestep the
    problem altogether: store the env value as a plain string and expose
    the parsed list through a Python-side property. Old call sites
    (`settings.ALLOWED_ORIGINS`) still work unchanged.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        populate_by_name=True,
        extra="ignore",
    )

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

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""

    # Transactional email. See app/services/email.py for the resolution
    # rules between SMTP and Resend.
    EMAIL_FROM: str = "onboarding@resend.dev"
    EMAIL_FROM_NAME: str = "CampusConnect"

    # Option A — generic SMTP (Gmail, Workspace, Outlook, etc.). When
    # SMTP_HOST is set the email service uses SMTP and ignores Resend.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""

    # Option B — Resend. Used when SMTP_HOST is empty and this is set.
    RESEND_API_KEY: str = ""

    # Option C — SendGrid (HTTP API). Works on hosts that block outbound
    # SMTP ports (Railway, Render, etc.). With Single Sender Verification
    # you can send without owning a custom domain. Takes priority over
    # Resend when set.
    SENDGRID_API_KEY: str = ""

    # ---- CSV env fields ----
    # CORS — comma-separated origins, e.g.
    #   ALLOWED_ORIGINS=http://localhost:5173,https://campusconnect.example.com
    ALLOWED_ORIGINS_RAW: str = Field(
        default="http://localhost:5173,http://localhost:5174,http://localhost:3000",
        alias="ALLOWED_ORIGINS",
    )
    # Email domains the admin can invite users on. Production keeps this
    # locked to the university domain; dev can add gmail.com etc. so it can
    # be tested against Resend's sandbox before a real domain is verified.
    INVITE_ALLOWED_DOMAINS_RAW: str = Field(
        default="final.edu.tr",
        alias="INVITE_ALLOWED_DOMAINS",
    )

    # ---- Computed list views ----
    # Property names match the legacy field names so call sites are unchanged.
    @property
    def ALLOWED_ORIGINS(self) -> list[str]:
        return _split_csv(self.ALLOWED_ORIGINS_RAW)

    @property
    def INVITE_ALLOWED_DOMAINS(self) -> list[str]:
        return _split_csv(self.INVITE_ALLOWED_DOMAINS_RAW)


settings = Settings()
