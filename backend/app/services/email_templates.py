"""
Email templates.

Two helpers — `welcome()` and `password_reset_notice()` — each returns
`(subject, html, text)`. Inline-style HTML so Gmail / Outlook render
consistently without external CSS.

These are intentionally minimal. When the design team gives us real
templates, swap the html strings; the function shapes stay.
"""
from __future__ import annotations

from app.core.config import settings


def _brand_name() -> str:
    return (settings.EMAIL_FROM_NAME or "CampusConnect").strip() or "CampusConnect"


def _wrap(content_html: str, preview: str = "") -> str:
    """Standard wrapper — header bar, content well, footer."""
    brand = _brand_name()
    return f"""<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f1f1f;">
    <span style="display:none;color:transparent;visibility:hidden;width:0;height:0;overflow:hidden;">{preview}</span>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f3ff;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e9d5ff;">
          <tr>
            <td style="padding:24px 28px;background:linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%);">
              <div style="color:#fff;font-weight:700;font-size:18px;letter-spacing:.02em;">{brand}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              {content_html}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;border-top:1px solid #f3eaff;color:#9ca3af;font-size:12px;line-height:1.5;">
              You are receiving this email because of activity on your {brand} account.<br>
              If this wasn't you, please ignore it.
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>"""


def welcome(*, recipient_name: str, login_url: str, temp_password: str | None = None) -> tuple[str, str, str]:
    """Welcome email after onboarding. If a temp password is provided,
    the user is instructed to sign in with it and change it immediately."""
    name = (recipient_name or "there").split()[0]
    subject = f"Welcome to {_brand_name()}"
    pw_block = ""
    if temp_password:
        pw_block = f"""
            <p style="margin:0 0 14px 0;font-size:14px;line-height:1.5;color:#374151;">
              Your temporary password:
            </p>
            <div style="font-family:'SFMono-Regular',Consolas,monospace;font-size:15px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:12px;text-align:center;color:#5b21b6;margin-bottom:14px;">
              {temp_password}
            </div>
            <p style="margin:0 0 18px 0;font-size:13px;color:#6b7280;">
              You will be asked to set a new password on first sign-in.
            </p>
        """
    content = f"""
        <h1 style="font-size:22px;margin:0 0 12px 0;color:#1f1f1f;">Hi {name},</h1>
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;">
          Your {_brand_name()} account is ready. You can now find study groups, join clubs,
          and collaborate on student projects.
        </p>
        {pw_block}
        <p style="margin:0 0 22px 0;">
          <a href="{login_url}"
             style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px;">
            Sign in
          </a>
        </p>
        <p style="margin:0;color:#9ca3af;font-size:12px;">
          Trouble with the button? Paste this link in your browser:<br>
          <span style="word-break:break-all;color:#7c3aed;">{login_url}</span>
        </p>
    """
    text = (
        f"Hi {name},\n\nYour {_brand_name()} account is ready.\n"
        + (f"Temporary password: {temp_password}\n(You'll be asked to set a new one on first sign-in.)\n\n" if temp_password else "")
        + f"Sign in: {login_url}\n"
    )
    return subject, _wrap(content, preview=f"Your {_brand_name()} account is ready."), text


def password_reset_notice(*, recipient_name: str, reset_url: str) -> tuple[str, str, str]:
    """Standalone reset link email (when we send it ourselves instead of
    relying on Supabase's built-in)."""
    name = (recipient_name or "there").split()[0]
    subject = f"Reset your {_brand_name()} password"
    content = f"""
        <h1 style="font-size:22px;margin:0 0 12px 0;color:#1f1f1f;">Hi {name},</h1>
        <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#374151;">
          We received a request to reset your {_brand_name()} password. Use the
          button below to set a new one. The link expires in 1 hour.
        </p>
        <p style="margin:0 0 22px 0;">
          <a href="{reset_url}"
             style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px;">
            Reset password
          </a>
        </p>
        <p style="margin:0;color:#9ca3af;font-size:12px;">
          Didn't request this? You can safely ignore this email — your password won't change.
        </p>
    """
    text = (
        f"Hi {name},\n\nReset your {_brand_name()} password: {reset_url}\n"
        "The link expires in 1 hour. If you didn't request this, ignore this email.\n"
    )
    return subject, _wrap(content, preview=f"Reset your {_brand_name()} password."), text
