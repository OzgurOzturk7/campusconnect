# CampusConnect

Academic social platform for university students. Built around the four things students actually do online: discover and join clubs, find events, team up on projects, and chat.

The deployed instance is scoped to Final University (`final.edu.tr` invite domain). The codebase is generic — the invite whitelist and branding swap out via environment variables.

---

## Feature surface

| Area | What it does |
| --- | --- |
| Auth | Admin invite → temporary password emailed → forced password reset on first login. Google Sign-In branches into "session" (returning) vs. "invited" (first-time) flows. Forgot-password reset over the project's own SMTP. |
| Profile | Name, department, year (1–12), bio, GitHub, LinkedIn, skills, courses. Initials-based avatar (no image upload). |
| Clubs | Browse by category, open vs. approval-required membership, request a new club (admin reviews), club detail page with cover, intro video, members, events, announcements. |
| Events | School-wide and club-scoped events, capacity caps, attendee list, CSV export for organisers, Google-calendar "add to calendar" link. Automatic 24-hour reminder notification via a background scheduler. |
| Projects | Post a project (monthly cap of 3 for non-admins), apply with a role, motivation, optional CV upload + external links. Owner accepts/rejects with mandatory reason. Re-apply allowed after rejection or workspace removal. |
| Workspace | Per-project shared space: kanban tasks with due-dates (server-validated against the past), members panel with role-aware remove, shared resource links, activity log, stage tracker (recruiting → planning → development → testing → launch → completed). |
| Chat | 1:1 and group chats, project chats (auto-managed with workspace membership), realtime messages and reactions, @mentions with notifications, file/image/audio attachments, search, pinned messages, mute, per-user soft-delete on direct chats with auto-restore on new message, per-user pin to top. |
| Notifications | Bell dropdown + dedicated page. Per-row delete, multi-select bulk delete, "clear all". Full-text rejection reasons (no truncation). |
| Settings | Theme (light/dark), language (English, Türkçe, Русский, العربية with RTL), password change, profile display. |
| i18n | 4 locales out of the box. Logical CSS properties + `rtl:` variants throughout. |

---

## Stack

**Frontend** — `src/`

- React 18 + TypeScript + Vite 6
- Tailwind CSS v4 (design tokens as CSS variables)
- React Router v7 (lazy routes)
- `@supabase/supabase-js` for realtime + storage
- `i18next` / `react-i18next` (ar, en, ru, tr)
- `lucide-react` for iconography

**Backend** — `backend/`

- FastAPI 0.115 + Uvicorn
- Pydantic v2 + `pydantic-settings`
- `supabase-py` (admin + anon clients)
- `python-jose` for JWT
- `slowapi` for rate limiting
- SMTP transport (Gmail / Workspace / Outlook), Resend as fallback

**Data** — Supabase / Postgres (Frankfurt region)

- 11 SQL migrations in `backend/supabase/migrations/`
- Row-Level Security on every table
- Realtime publication for `messages`, `chat_members`, `notifications`, `message_reactions`

---

## Running it

### Prerequisites

- Node 18+ (developed against Node 20)
- Python 3.11+
- A Supabase project with the SQL migrations in `backend/supabase/migrations/` applied in numerical order
- A Google OAuth client ID (web application) if you want Google Sign-In
- An SMTP account or a Resend API key for transactional email

### Frontend

```bash
npm install
npm run dev          # vite on :5173
npm run typecheck    # strict TS check
npm run build        # production bundle into dist/
```

`.env.local` at the repo root:

```
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
VITE_ALLOWED_EMAIL_DOMAIN=final.edu.tr
```

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`backend/.env`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
JWT_SECRET=<long random string>
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
DEBUG=true

ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
INVITE_ALLOWED_DOMAINS=final.edu.tr

EMAIL_FROM=noreply@yourdomain
EMAIL_FROM_NAME=CampusConnect
# Either SMTP (preferred):
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
# Or Resend (used when SMTP_HOST is empty):
# RESEND_API_KEY=re_...
```

CSV-style env values (origins, invite domains) are stored as plain strings and exposed through Python properties — see `backend/app/core/config.py` for why.

### Database

Apply the migrations to a fresh Supabase project, in order:

```
001_users_table.sql
002_chat_tables.sql
003_workspaces.sql
004_club_roles_cleanup.sql
005_extras.sql
006_realtime.sql
007_must_change_password.sql
008_relax_year_check.sql
009_club_request_fields.sql
010_cleanup_orphan_applications.sql
011_chat_pin.sql
```

The migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) so re-running is safe.

---

## Project layout

```
src/app/
├── App.tsx
├── routes.tsx
├── components/        # Avatar, Button, Card, Layout, Navbar, Sidebar, …
├── context/           # Auth, Theme, Language, Toast, Confirm, Notification
├── hooks/             # useRealtimeChannel
├── i18n/              # locales/{ar,en,ru,tr}/
├── lib/               # api, errors, format, i18n, supabase, utils
├── pages/             # one file per route
├── services/          # auth, realtime, storage helpers
└── styles/index.css   # Tailwind layer + CSS variables

backend/
├── main.py            # FastAPI app, CORS, error middleware, reminder cron
├── app/
│   ├── core/          # config, security (JWT), supabase clients, rate limit
│   ├── routers/       # auth, projects, clubs, events, chats, workspaces, notifications
│   ├── schemas/       # Pydantic request/response models
│   └── services/      # email (SMTP/Resend), templates
└── supabase/migrations/
```

---

## Design tokens

| Token | Value |
| --- | --- |
| Primary | `#dc2626` |
| Background | `#fafafa` |
| Card surface | `#ffffff` |
| Border | `#e2e8f0` |

All tokens live as CSS variables in `src/styles/index.css`. The light/dark theme swap changes the variable values only — component code is unaware. The interface is web-first and responsive down to 360 px.

---

## Conventions

- Conventional-commit prefixes (`feat`, `fix`, `refactor`, `perf`, `docs`).
- `npm run typecheck` must be green before a push.
- API errors flow through `lib/errors.ts` so toasts come out translated and consistent.
- Storage object keys are ASCII-sanitised before upload (`[A-Za-z0-9._-]`) so non-ASCII filenames don't trip Supabase Storage.
- RLS first. Routes that touch user data use the admin client only after explicit ownership / role checks — don't add a route that returns rows without scoping by `current_user["id"]`.

---

## Known limits

- The 24-hour event reminder loop is single-process; if you scale to multiple Uvicorn workers, only one ends up running it. Move to APScheduler with a database-level lock before going multi-instance.
- `/api/chats/unread-total` issues one count query per chat membership. Fine for a classroom-scale deployment; needs an aggregate SQL function before it scales further.
- Google Sign-In is the recommended path; the email/password form is kept for accounts that haven't linked Google yet.

---

## License

Internal university project. All rights reserved.
