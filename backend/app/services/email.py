"""
Transactional email service — provider-agnostic.

Resolution order (first matching transport wins):

  1. SMTP_HOST set        → stdlib smtplib. NOTE: most PaaS hosts (Railway,
                            Render) block outbound SMTP ports — avoid in prod.
  2. SENDGRID_API_KEY set → SendGrid HTTP API. Works on SMTP-blocked hosts;
                            Single Sender Verification means no domain needed.
  3. BREVO_API_KEY set    → Brevo HTTP API. Same idea as SendGrid.
  4. RESEND_API_KEY set   → send via Resend's REST API.
  5. None set             → "dev mode": log the message body, return success.

Why both? Resend is the cleanest production setup *once you have a
verified domain*. Until then its sandbox sender only delivers to the
account owner's address, which blocks real onboarding testing. Gmail
SMTP (with a Google App Password) sidesteps that — sender is your own
mailbox, deliverability works for any recipient. When the domain is
verified later, drop the SMTP_* env values and Resend takes over with
zero code change.

`send_email()` is the only public surface. Templates live in
email_templates.py.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailError(Exception):
    """Raised for non-transient email send failures (4xx from the provider)."""


def _from_header() -> str:
    name = (settings.EMAIL_FROM_NAME or "").strip()
    addr = (settings.EMAIL_FROM or "").strip()
    return f"{name} <{addr}>" if name else addr


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def send_email(
    to: str | list[str],
    subject: str,
    html: str,
    text: Optional[str] = None,
    *,
    reply_to: Optional[str] = None,
) -> dict:
    """Send an email through whichever transport is configured.

    Returns a small dict describing the transport for debugging. Raises
    EmailError on non-transient failures; network blips re-raise the
    underlying httpx/smtplib exception so the caller can retry.
    """
    recipients = [to] if isinstance(to, str) else list(to)
    if not recipients:
        raise EmailError("send_email called with no recipients")

    if settings.SMTP_HOST:
        return _send_via_smtp(recipients, subject, html, text, reply_to)
    if settings.SENDGRID_API_KEY:
        return _send_via_sendgrid(recipients, subject, html, text, reply_to)
    if settings.BREVO_API_KEY:
        return _send_via_brevo(recipients, subject, html, text, reply_to)
    if settings.RESEND_API_KEY:
        return _send_via_resend(recipients, subject, html, text, reply_to)

    logger.info(
        "[email/dev] To=%s | Subject=%s | (no SMTP_HOST or RESEND_API_KEY — not actually sent)",
        recipients, subject,
    )
    return {"id": "dev-no-transport", "transport": "dev", "dev_mode": True}


# ---------------------------------------------------------------------------
# SMTP transport (Option A — recommended for dev / pre-domain)
# ---------------------------------------------------------------------------
def _send_via_smtp(
    recipients: list[str],
    subject: str,
    html: str,
    text: Optional[str],
    reply_to: Optional[str],
) -> dict:
    """Standard SMTP send. Supports STARTTLS (587) and implicit TLS (465).

    Auth: SMTP_USER + SMTP_PASSWORD. For Gmail / Google Workspace this is
    the email address + a 16-char App Password (regular passwords are
    rejected by Google for SMTP).
    """
    sender_addr = (settings.EMAIL_FROM or settings.SMTP_USER or "").strip()
    if not sender_addr:
        raise EmailError("EMAIL_FROM (or SMTP_USER) must be set for SMTP")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = _from_header() or sender_addr
    msg["To"] = ", ".join(recipients)
    if reply_to:
        msg["Reply-To"] = reply_to

    # Text part first, then HTML — RFC 2046 says the most faithful
    # representation goes last so mail clients prefer the HTML.
    if text:
        msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    host = settings.SMTP_HOST
    port = int(settings.SMTP_PORT or 587)
    user = settings.SMTP_USER
    password = settings.SMTP_PASSWORD

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=15) as server:
                if user and password:
                    server.login(user, password)
                server.sendmail(sender_addr, recipients, msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=15) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                if user and password:
                    server.login(user, password)
                server.sendmail(sender_addr, recipients, msg.as_string())
    except smtplib.SMTPAuthenticationError as e:
        logger.error("SMTP auth failed for %s: %s", user, e)
        raise EmailError(
            f"SMTP authentication failed. Check SMTP_USER and SMTP_PASSWORD "
            f"(Gmail/Workspace need an App Password, not the regular one)."
        ) from e
    except smtplib.SMTPRecipientsRefused as e:
        logger.error("SMTP refused recipients %s: %s", recipients, e)
        raise EmailError(f"All recipients refused by the SMTP server: {e}") from e
    except smtplib.SMTPException as e:
        logger.exception("SMTP send failed")
        raise EmailError(f"SMTP error: {e}") from e

    return {"id": "smtp", "transport": "smtp"}


# ---------------------------------------------------------------------------
# Resend transport (Option B — production once a domain is verified)
# ---------------------------------------------------------------------------
def _send_via_resend(
    recipients: list[str],
    subject: str,
    html: str,
    text: Optional[str],
    reply_to: Optional[str],
) -> dict:
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
        res.raise_for_status()
    if res.status_code >= 400:
        body = res.text
        logger.error("Resend rejected the request: %s — %s", res.status_code, body)
        raise EmailError(f"Resend {res.status_code}: {body[:300]}")

    data = res.json()
    return {"id": data.get("id", "resend"), "transport": "resend"}


# ---------------------------------------------------------------------------
# SendGrid transport (HTTP API — works on SMTP-blocked hosts like Railway;
# Single Sender Verification means no custom domain required)
# ---------------------------------------------------------------------------
def _send_via_sendgrid(
    recipients: list[str],
    subject: str,
    html: str,
    text: Optional[str],
    reply_to: Optional[str],
) -> dict:
    sender_addr = (settings.EMAIL_FROM or "").strip()
    if not sender_addr:
        raise EmailError("EMAIL_FROM must be a SendGrid-verified sender for SendGrid")

    content = []
    if text:
        content.append({"type": "text/plain", "value": text})
    content.append({"type": "text/html", "value": html})

    from_obj: dict = {"email": sender_addr}
    if (settings.EMAIL_FROM_NAME or "").strip():
        from_obj["name"] = settings.EMAIL_FROM_NAME.strip()

    payload: dict = {
        "personalizations": [{"to": [{"email": r} for r in recipients]}],
        "from": from_obj,
        "subject": subject,
        "content": content,
    }
    if reply_to:
        payload["reply_to"] = {"email": reply_to}

    headers = {
        "Authorization": f"Bearer {settings.SENDGRID_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.post("https://api.sendgrid.com/v3/mail/send", headers=headers, json=payload)
    except httpx.HTTPError as e:
        logger.warning("SendGrid network error: %s", e)
        raise

    if res.status_code >= 500:
        res.raise_for_status()
    if res.status_code >= 400:
        body = res.text
        logger.error("SendGrid rejected the request: %s — %s", res.status_code, body)
        raise EmailError(f"SendGrid {res.status_code}: {body[:300]}")

    # SendGrid returns 202 Accepted with an empty body on success.
    return {"id": res.headers.get("X-Message-Id", "sendgrid"), "transport": "sendgrid"}


# ---------------------------------------------------------------------------
# Brevo transport (HTTP API — SMTP-blocked-host friendly, verified single
# sender means no custom domain required)
# ---------------------------------------------------------------------------
def _send_via_brevo(
    recipients: list[str],
    subject: str,
    html: str,
    text: Optional[str],
    reply_to: Optional[str],
) -> dict:
    sender_addr = (settings.EMAIL_FROM or "").strip()
    if not sender_addr:
        raise EmailError("EMAIL_FROM must be a Brevo-verified sender for Brevo")

    sender: dict = {"email": sender_addr}
    if (settings.EMAIL_FROM_NAME or "").strip():
        sender["name"] = settings.EMAIL_FROM_NAME.strip()

    payload: dict = {
        "sender": sender,
        "to": [{"email": r} for r in recipients],
        "subject": subject,
        "htmlContent": html,
    }
    if text:
        payload["textContent"] = text
    if reply_to:
        payload["replyTo"] = {"email": reply_to}

    headers = {
        "api-key": settings.BREVO_API_KEY,
        "Content-Type": "application/json",
        "accept": "application/json",
    }

    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.post("https://api.brevo.com/v3/smtp/email", headers=headers, json=payload)
    except httpx.HTTPError as e:
        logger.warning("Brevo network error: %s", e)
        raise

    if res.status_code >= 500:
        res.raise_for_status()
    if res.status_code >= 400:
        body = res.text
        logger.error("Brevo rejected the request: %s — %s", res.status_code, body)
        raise EmailError(f"Brevo {res.status_code}: {body[:300]}")

    data = res.json() if res.content else {}
    return {"id": data.get("messageId", "brevo"), "transport": "brevo"}
