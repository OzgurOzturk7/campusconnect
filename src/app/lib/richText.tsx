import React from "react";

/**
 * Lightweight, XSS-safe inline formatter for user-authored text
 * (chat messages, club announcements).
 *
 * Supports a deliberately small subset of Markdown:
 *   **bold**      → <strong>
 *   *italic*      → <em>
 *   [label](url)  → <a> (http/https only)
 *   bare http(s) URLs → <a>
 *
 * Why not a Markdown library + dangerouslySetInnerHTML? Because we never
 * build an HTML string at all — we return React nodes, so every piece of
 * user text is escaped by React automatically. Link targets are matched
 * with an `https?://` pattern, so `javascript:` / `data:` URLs can't slip
 * through. No sanitiser to keep in sync, no injection surface.
 *
 * Newlines are preserved by the caller's `whitespace-pre-wrap`; this
 * formatter only touches inline spans and leaves plain text untouched.
 */
const INLINE =
  /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s]+)/g;

export function renderRichText(text: string): React.ReactNode {
  if (!text) return text;

  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (match[1]) {
      // **bold**
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (match[2]) {
      // *italic*
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (match[3]) {
      // [label](url)
      const closeBracket = token.indexOf("]");
      const label = token.slice(1, closeBracket);
      const url = token.slice(closeBracket + 2, -1);
      out.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline break-all"
        >
          {label}
        </a>
      );
    } else {
      // bare URL
      out.push(
        <a
          key={key++}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="underline break-all"
        >
          {token}
        </a>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }

  return out;
}
