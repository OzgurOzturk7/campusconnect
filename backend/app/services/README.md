# services/

Backend "outside world" adapters. Anything that talks to a third-party
provider (email, payments, S3, etc.) lives here. Routers import from
`app.services.*` and never poke an SDK directly — same seam idea as the
frontend's `src/app/services/`.

## email — Resend

Transactional email (welcome, password reset, notifications) goes
through Resend over plain HTTP. No extra SDK; httpx (already a dep) is
enough.

### Setup

1. Create a Resend account: <https://resend.com>. Free tier covers
   3,000 emails/month, 100/day — plenty for dev + small launches.
2. Generate an API key (Dashboard → API Keys).
3. Add to `backend/.env`:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=onboarding@resend.dev
EMAIL_FROM_NAME=CampusConnect
```

`onboarding@resend.dev` is Resend's sandbox sender; it only delivers to
the account owner's verified address. Fine for dev. For real users:

4. Verify a domain in Resend (Dashboard → Domains). Add the listed SPF,
   DKIM, DMARC TXT records to your DNS. Switch `EMAIL_FROM` to e.g.
   `noreply@yourdomain.com`.

### Hook Supabase's built-in emails to the same sender

The password-reset email triggered by `auth.reset_password_for_email`
goes through *Supabase's* SMTP, not ours. To unify the sender:

- Resend → Settings → SMTP → grab the SMTP credentials.
- Supabase Dashboard → Project → Auth → SMTP → enable + paste credentials.
- Supabase Dashboard → Auth → Email Templates → set from address to
  match `EMAIL_FROM`.

After that, "reset password" emails come from the same domain as the
ones our backend sends directly.

### Dev mode (no API key)

If `RESEND_API_KEY` is empty, `send_email()` logs the email instead of
sending it and returns success. This keeps local dev unblocked.

### Usage

```python
from app.services.email import send_email
from app.services.email_templates import welcome

subject, html, text = welcome(
    recipient_name="Ada Lovelace",
    login_url="https://campusconnect.app/login",
    temp_password="abc123",
)
send_email(to="user@example.com", subject=subject, html=html, text=text)
```

### Anti-patterns

- ❌ Don't call `httpx.post(...)` against Resend directly from a router.
  Use `send_email`.
- ❌ Don't hand-roll HTML in routers. Add a template function in
  `email_templates.py` and return `(subject, html, text)`.
- ❌ Don't fail a request because an email failed. Catch `EmailError`
  and log — the user's primary action shouldn't bounce because of a
  transactional email hiccup.
