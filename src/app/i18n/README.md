# i18n — Translation system

Production-grade internationalization built on [i18next](https://www.i18next.com/) + [react-i18next](https://react.i18next.com/).

## Quick start

```tsx
import { useTranslation } from "react-i18next";

function MyComponent() {
  const { t } = useTranslation("dashboard"); // namespace
  return <h1>{t("welcome", { name: user.name })}</h1>;
}
```

For cross-namespace keys, prefix with the namespace:

```tsx
const { t } = useTranslation(); // uses default ns: "common"
t("nav.dashboard");       // common.nav.dashboard
t("errors:server.title"); // errors.server.title
```

## Languages

| Code | Name      | Direction |
|------|-----------|-----------|
| `en` | English   | LTR       |
| `tr` | Türkçe    | LTR       |
| `ru` | Русский   | LTR       |
| `ar` | العربية   | **RTL**   |

The active language is persisted to `localStorage` under `campusconnect_lang`.
On switch, `LanguageProvider` updates `<html lang>` and `<html dir>`, so Tailwind's
`rtl:` variants and logical CSS properties (`ms-*`, `me-*`) take effect automatically.

## Namespaces

Each namespace is a separate JSON file under `src/app/i18n/locales/<lang>/<ns>.json`:

| Namespace   | Scope                                                            |
|-------------|------------------------------------------------------------------|
| `common`    | Default. Nav, generic actions, badges, time-ago, loading states. |
| `auth`      | Login, signup, session expiry copy.                              |
| `dashboard` | Dashboard welcome, sections, empty states.                       |
| `projects`  | Project listing, dates, publish limits, applications.            |
| `chat`      | Chat list, composer, group ownership controls, mute.             |
| `clubs`     | Club applications, visibility.                                   |
| `settings`  | Settings page sections.                                          |
| `errors`    | Cross-cutting user-friendly error copy (used by `toUserError`).  |

To add a new key:
1. Add it to **all four** language files for the namespace.
2. Use it via `t("key.path")` or `t("ns:key.path")`.
3. Run `npm run build` — i18next will warn on missing keys at runtime, not compile time.

## Adding a new language

1. Create `src/app/i18n/locales/<code>/` and copy the eight namespace files from `en/`.
2. Translate values (keys must match).
3. Register the language in `src/app/lib/i18n.ts`:
   - Add the code to `SUPPORTED_LANGS`.
   - Add the resource imports + `resources` entry.
   - If RTL, add the code to `RTL_LANGS`.
4. Add the display name to `common.json` → `languages.<code>` in every locale.

The language switcher in `Navbar` reads `SUPPORTED_LANGS` and renders automatically — no UI change required.

## Error system integration

`src/app/lib/errors.ts` provides `toUserError(err, { action, what })` which maps any
thrown value (HTTP statuses, network errors, unknown) into a translated `UserError`:

```ts
catch (err) {
  toastError(toUserError(err, { action: "save", what: "project" }));
}
```

All copy comes from the `errors` namespace, so error messages translate automatically.

---

## Strategy: when, how, and why translation hygiene matters

### When should translation work happen?

**As soon as you stop being a single-language MVP.** Practically, the right
moment is the iteration where you first decide a second language matters — not
later. Every screen built without `t()` is a screen that has to be edited a
second time later, often by someone who didn't write it.

### Recommended integration order

1. **Infrastructure first** *(done)* — i18next, namespace structure, RTL plumbing,
   language switcher. No screens migrated yet.
2. **Common chrome** — Sidebar, Navbar, dialogs, toasts, error helper. Touched
   on every screen, so wins compound.
3. **High-traffic flows** — Login, Dashboard, Projects, Chat. In that order:
   auth first (it's the first screen a non-English user sees), then the most-used
   pages.
4. **Deep features** — Workspace, Clubs detail, Settings.
5. **Long-tail copy** — empty states, tooltips, validation messages buried in forms.

Phase each migration as its own commit. A page-at-a-time refactor is easy to
review; a "translate everything" PR is not.

### Why retrofitting later is harder

- **Hard-coded strings hide.** Once a string is concatenated into a template
  literal (`` `Welcome ${name}` ``) or split across JSX siblings, extracting it
  becomes a refactor of the surrounding code, not a string replace.
- **Pluralization and gender become bugs.** English `1 item / 2 items` plus
  Russian (3 plural forms) plus Arabic (6 plural forms) — handling this *after*
  copy ships means visible bugs in the wild.
- **RTL breaks visual assumptions.** Hard-coded `ml-4`, `pl-2`, left-aligned
  flex rows, icons with `→` glyphs — each one is a future regression. Building
  with RTL in mind means using `ms-4`, `ps-2`, logical alignment, and
  direction-aware icons from day one.
- **Translation context is lost.** A translator handed `"Open"` doesn't know
  if it's a verb (open the file) or an adjective (the project is open). The
  developer writing it *knows* — capture that with namespaced keys
  (`actions.open` vs `clubs.visibility.open`).
- **Date/number/currency formatters multiply.** Mixing `toLocaleString()` with
  hard-coded `"MM/DD/YYYY"` strings results in a hybrid that nobody owns.

### Managing translations in production

- **Treat locale files as code.** They live in the repo, ship in the bundle,
  are reviewed in PRs.
- **One namespace per feature area.** Avoid a single 5,000-line `common.json` —
  it slows down review and creates merge conflicts.
- **Keep keys semantic, not positional.** `actions.confirm` not `button1`.
  `errors.upload.tooLarge` not `error_message_47`.
- **Variables, not concatenation.** Always `t("welcome", { name })` —
  never `t("welcome") + " " + name`. Word order differs by language.
- **Lazy-load when the bundle grows.** This file imports all locales eagerly.
  If translations cross ~500 KB total, swap to dynamic `import()` per
  namespace+language (i18next supports this natively via the backend plugin).
- **Run a "missing keys" report in CI.** Compare every locale against `en` and
  fail the build if a key was added but not translated. Avoids shipping
  half-translated screens.
- **Pseudo-localize before launch.** Wrap every string in `[!!Welcome back!!]`
  to surface untranslated strings and width issues. Catches more than human review.
- **For external translators**, export to a TMS (Lokalise, Crowdin, Phrase) and
  sync back via PR. Don't let translators commit directly — review still matters.

### Anti-patterns to avoid

- ❌ Building a homegrown `translations.ts` object (we just replaced one).
  i18next has solved interpolation, pluralization, fallback chains, and
  detection. Reinventing wastes time and creates subtle bugs.
- ❌ Storing language as a state variable per page. Use the global instance.
- ❌ Calling `t()` outside React. Use `i18n.t()` directly or `getFixedT()`
  in non-component code (see `lib/errors.ts`).
- ❌ Embedding HTML in translation strings. Use `<Trans>` from
  `react-i18next` for inline formatting.
