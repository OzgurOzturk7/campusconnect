import i18n from "./i18n";
import { ApiError } from "./api";

/**
 * UserError - a user-facing error model.
 *
 * Internal services throw raw `Error`s with status codes or technical messages.
 * UI code should never display those directly. `toUserError` converts any
 * thrown value into a structured, translated, user-friendly message with an
 * action label and an optional hint.
 *
 * Usage:
 *   try { await save(); }
 *   catch (e) { toast.error(formatUserError(toUserError(e, { action: "save", what: "project" }))); }
 */
export interface UserError {
  title: string;
  body: string;
  hint?: string;
  status?: number;
}

interface ToUserErrorOptions {
  /** Verb describing what the user was doing (e.g. "save", "load"). */
  action?: "load" | "save" | "delete" | "create" | "login" | "upload";
  /** Subject — what was being acted on (e.g. "project", "your CV"). */
  what?: string;
}

function hasStatus(value: unknown): value is { status: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof (value as Record<string, unknown>).status === "number"
  );
}

function getStatus(err: unknown): number | undefined {
  if (err instanceof ApiError) return err.status;
  if (hasStatus(err)) return err.status;
  if (err instanceof Error) {
    const match = err.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function isNetworkError(err: unknown): boolean {
  // ApiError(status=0) is our explicit "network unreachable" marker.
  if (err instanceof ApiError && err.status === 0) return true;
  if (!(err instanceof Error)) return false;
  return /Failed to fetch|NetworkError|fetch failed/i.test(err.message);
}

export function toUserError(err: unknown, opts: ToUserErrorOptions = {}): UserError {
  const t = i18n.getFixedT(null, "errors");
  const status = getStatus(err);

  // Network failure — couldn't reach the server at all.
  if (isNetworkError(err)) {
    return {
      title: t("network.title"),
      body: t("network.body"),
      hint: t("network.hint"),
    };
  }

  if (status === 401) {
    return {
      title: t("unauthorized.title"),
      body: t("unauthorized.body"),
      hint: t("unauthorized.hint"),
      status,
    };
  }
  if (status === 403) {
    return {
      title: t("forbidden.title"),
      body: t("forbidden.body"),
      hint: t("forbidden.hint"),
      status,
    };
  }
  if (status === 404) {
    return {
      title: t("notFound.title"),
      body: t("notFound.body"),
      hint: t("notFound.hint"),
      status,
    };
  }
  if (status === 429) {
    return {
      title: t("rateLimit.title"),
      body: t("rateLimit.body"),
      hint: t("rateLimit.hint"),
      status,
    };
  }
  if (status === 413) {
    return {
      title: t("upload.title"),
      body: t("upload.tooLarge", { max: opts.what ?? "10 MB" }),
      hint: t("upload.hint"),
      status,
    };
  }
  if (status === 415) {
    return {
      title: t("upload.title"),
      body: t("upload.wrongType", { types: "PDF" }),
      hint: t("upload.hint"),
      status,
    };
  }
  if (status === 422 || status === 400) {
    return {
      title: t("validation.title"),
      body: err instanceof Error && err.message ? err.message : t("validation.body"),
      hint: t("validation.hint"),
      status,
    };
  }
  if (status && status >= 500) {
    return {
      title: t("server.title"),
      body: t("server.body"),
      hint: t("server.hint"),
      status,
    };
  }

  // Action-scoped fallback (e.g. "Couldn't save project").
  if (opts.action) {
    const actionKey = `action.${opts.action}Failed` as const;
    const title = t(actionKey, { what: opts.what ?? "" }) as string;
    return {
      title: title || t("generic.title"),
      body: err instanceof Error ? err.message : t("generic.body"),
      hint: t("generic.hint"),
      status,
    };
  }

  return {
    title: t("generic.title"),
    body: err instanceof Error ? err.message : t("generic.body"),
    hint: t("generic.hint"),
    status,
  };
}

/** Flatten a UserError into a single string suitable for a toast. */
export function formatUserError(e: UserError): string {
  return e.hint ? `${e.title}. ${e.body} ${e.hint}` : `${e.title}. ${e.body}`;
}
