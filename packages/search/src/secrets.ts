// The content check (search spec §8.2). A hit is never logged, and neither is where in the file it was.

import { MAX_TEXT_BYTES } from "./limits";

/** All the text that can be indexed is scanned (a bigger file is indexed by name only anyway). */
export const SECRET_SCAN_BYTES = MAX_TEXT_BYTES;

// Token edges: a letter or digit may not touch the token, but `_` may (`ANTHROPIC_KEY_sk-…`, `AWS_AKIA…`), which `\b`
// would miss.
const B = "(?<![A-Za-z0-9])";
const E = "(?![A-Za-z0-9])";

/**
 * Token-shaped strings. No `g` flag: `test` keeps no state between calls. Every pattern is a literal plus one
 * quantified character class (no nested quantifiers, no overlapping alternatives), so a scan is linear in the text.
 */
const PATTERNS: readonly RegExp[] = [
  new RegExp(`${B}sk-[A-Za-z0-9_-]{37,}`),
  new RegExp(`${B}(?:ghp|gho)_[A-Za-z0-9]{20,}`),
  new RegExp(`${B}github_pat_[A-Za-z0-9_]{20,}`),
  new RegExp(`${B}xox[abp]-[A-Za-z0-9-]{10,}`),
  new RegExp(`${B}AKIA[0-9A-Z]{16}${E}`),
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  new RegExp(`${B}glpat-[A-Za-z0-9_-]{20,}`),
];

/** The first line of a private-key block; its label names the END line that closes it. */
const BLOCK_BEGIN = /-----BEGIN ([A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/;

const hit = (text: string) => PATTERNS.some((p) => p.test(text));

/** A file whose indexable text holds a token-shaped string is indexed by name only. */
export function secretShaped(text: string): boolean {
  return hit(text.length > SECRET_SCAN_BYTES ? text.slice(0, SECRET_SCAN_BYTES) : text);
}

/**
 * Notes and chats: the lines with a token-shaped string are left out, the rest is indexed. A private-key block is
 * left out whole, from its BEGIN line through the matching END line (to the end of the text when there is none).
 */
export function withoutSecretLines(text: string): string {
  const out: string[] = [];
  let end: string | null = null;
  for (const line of text.split("\n")) {
    if (end !== null) {
      if (line.includes(end)) end = null;
      continue;
    }
    const begin = BLOCK_BEGIN.exec(line);
    if (begin) {
      const close = `-----END ${begin[1]}-----`;
      if (!line.slice(begin.index + begin[0].length).includes(close)) end = close;
      continue;
    }
    if (!hit(line)) out.push(line);
  }
  return out.join("\n");
}
