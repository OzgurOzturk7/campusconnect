# services/

Single seam between the app and its external dependencies (Supabase, the
FastAPI backend, future webhooks). Page and component code imports from
`"../services"`; nothing imports `@supabase/supabase-js` or hardcodes `fetch`
calls directly.

## What lives here

| Module      | Responsibility                                                    |
|-------------|-------------------------------------------------------------------|
| `auth.ts`   | Login (password / Google), session probe.                         |
| `storage.ts`| File uploads (CV today; resource files later).                    |
| `realtime.ts`| Postgres CDC subscriptions + broadcast channels.                 |
| `index.ts`  | Public barrel — consumers import from `"../services"`.            |

The companion React hook `hooks/useRealtimeChannel.ts` wraps `realtime.ts`
with auto-cleanup for consumers inside components.

## Why an abstraction layer

The product roadmap moves auth and direct CRUD from a FastAPI middle layer
to talking Supabase from the browser. That migration shouldn't touch every
page. Today's `authService.login()` is a `fetch` to `/api/auth/login`;
tomorrow it's `supabase.auth.signInWithPassword(...)`. Consumers care about
the return shape, not the transport.

Three rules keep the seam honest:

1. **Consumers don't import `supabase` or `fetch` directly.** They go through
   `services/`.
2. **The service interface is the contract.** Once a function returns
   `Promise<UserProfile>`, that shape is stable across rewrites. Internal
   refactors are free.
3. **Errors are normalized.** `apiFetch` throws `ApiError` with a real status
   code; storage uploads throw `Error & {status}`. The `toUserError()` helper
   in `lib/errors.ts` consumes either and produces translated UI copy.

## Realtime

`subscribeToTable` returns a `Subscription` you must `.unsubscribe()` when
done. Inside components, use `useRealtimeChannel` instead — it handles
cleanup on unmount and prop changes:

```tsx
useRealtimeChannel({
  table: "messages",
  filter: `chat_id=eq.${chatId}`,
  enabled: !!chatId,
  onChange: ({ event, new: row }) => {
    if (event === "INSERT") appendMessage(row);
  },
});
```

For ephemeral signals (typing, presence cursors) use `subscribeToBroadcast`
+ `broadcast()` — those aren't persisted to a table.

### Adding realtime to a new table

1. Add the table to the `supabase_realtime` publication (see
   `backend/supabase/migrations/006_realtime.sql` for the pattern).
2. Confirm row-level security lets the client read what the filter targets.
   Realtime payloads honor RLS — without SELECT permission you'll get
   subscription confirmations but no row events.
3. Call `useRealtimeChannel` from the consumer.

## Migration roadmap

Order suggested by risk / blast radius:

1. **Storage** — direct browser→Supabase upload with a signed-URL request to
   the backend (or RLS-gated insert). Single touch point: `storageService`.
2. **Auth** — `supabase.auth.signInWithPassword` + `onAuthStateChange`
   listener feeds `AuthContext`. Backend `/api/auth/me` becomes redundant.
3. **CRUD reads** — replace high-traffic GETs (`/api/projects/`,
   `/api/clubs/`) with `supabase.from(...).select(...)` and RLS policies.
   Keep the FastAPI layer for endpoints with non-trivial server logic
   (notifications fan-out, AI suggestion ranking, project monthly limit).
4. **Mutations** — last, because RLS policies need careful review.

The `services/` files are the seams that absorb these moves. Adding new
methods is fine; changing return shapes is a breaking change — bump major
in the doc comments and update all consumers in the same PR.

## Anti-patterns

- ❌ `import { supabase } from "../lib/supabase"` in a page file. (Two legacy
  consumers, `Chat.tsx` and `Workspace.tsx`, still do this. They predate
  this layer and will be migrated in a follow-up.)
- ❌ Throwing raw HTTP responses. Throw `ApiError` (already done in
  `lib/api.ts`) so `toUserError` can branch on status.
- ❌ Adding a service method that returns "whatever the backend returned"
  with `any`. Type the response shape — the typing is half the value.
