"""
Transactional email service.

Backed by Resend (https://resend.com) over plain HTTP — no extra SDK
dependency, just httpx (already in requirements). Resend was picked for
three reasons over SendGrid/Postmark:

  * Cleanest DX for small teams (single API key, no SMTP fiddling).
  * Native Supabase integration: setting the same Resend SMTP in
    Supabase Dashboard → Auth → SMTP makes Supabase's built-in emails
    (reset password, magic link) flow through the same sender domain.
  * Generous free tier (3000 emails/mo, 100/day) covers an entire dev
    cycle without a credit card.

If RESEND_API_KEY is empty the service degrades gracefully: it logs the
email it *would* have sent and returns success. That keeps local dev
unblocked when you don't have a real key, and prevents the app from
crashing in environments where email isn't configured yet.

Environment variables (see app/core/config.py):
  RESEND_API_KEY       — from the Resend dashboard. Empty = dev mode.
  EMAIL_FROM           — verified sender. Defaults to onboarding@resend.dev
                         (Resend's sandbox sender; only delivers to the
                         account owner's address).
  EMAIL_FROM_NAME      — display name; e.g. "CampusConnect".
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailError(Exception):
    """Raised for non-transient email send failures (4xx from Resend)."""


def _from_header() -> str:
    name = (settings.EMAIL_FROM_NAME or "").strip()
    addr = (settings.EMAIL_FROM or "onboarding@resend.dev").strip()
    return f"{name} <{addr}>" if name else addr


def send_email(
    to: str | list[str],
    subject: str,
    html: str,
    text: Optional[str] = None,
    *,
    reply_to: Optional[str] = None,
) -> dict:
    """Send an email via Resend.

    Returns the Resend response body on success. Raises EmailError on a
    4xx response (bad request, invalid key). 5xx errors are re-raised as
    the underlying httpx exception so the caller can retry.

    In dev mode (no API key) returns a fake response and logs the email.
    """
    recipients = [to] if isinstance(to, str) else list(to)
    if not recipients:
        raise EmailError("send_email called with no recipients")

    if not settings.RESEND_API_KEY:
        logger.info(
            "[email/dev] To=%s | Subject=%s | (RESEND_API_KEY not set — not actually sent)",
            recipients, subject,
        )
        return {"id": "dev-no-key", "dev_mode": True}

    payload: dict = {
        "from": _from_header(),
        "to": recipients,
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text
    if reply_to:
        payload["reply_to"] = reply_to

    headers = {
        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.post(RESEND_API_URL, headers=headers, json=payload)
    except httpx.HTTPError as e:
        logger.warning("Resend network error: %s", e)
        raise

    if res.status_code >= 500:
        # Let the caller decide whether to retry.
        res.raise_for_status()
    if res.status_code >= 400:
        # 4xx is a non-transient client error — bad From, missing recipient,
        # invalid key. Surface the detail in a readable way and stop.
        body = res.text
        logger.error("Resend rejected the request: %s — %s", res.status_code, body)
        raise EmailError(f"Resend {res.status_code}: {body[:300]}")

    return res.json()
