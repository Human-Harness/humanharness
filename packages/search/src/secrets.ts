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
  // GitHub: personal, OAuth, user-to-server, server-to-server and refresh tokens, and fine-grained ones.
  new RegExp(`${B}gh[pousr]_[A-Za-z0-9]{20,}`),
  new RegExp(`${B}github_pat_[A-Za-z0-9_]{20,}`),
  // Slack: the known xox kinds (a bot, user, refresh, session, legacy, config…) and app-level tokens.
  new RegExp(`${B}xox[abcdeoprs]-[A-Za-z0-9-]{10,}`),
  new RegExp(`${B}xapp-[A-Za-z0-9-]{10,}`),
  // A JWT: three base64url parts, the first two JSON objects (`{"` is `eyJ`). The class has no `.`, so the parts
  // cannot overlap.
  new RegExp(`${B}eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}`),
  // AWS: long-term (AKIA) and temporary (ASIA) access key ids.
  new RegExp(`${B}A(?:KI|SI)A[0-9A-Z]{16}${E}`),
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN PGP PRIVATE KEY BLOCK-----/,
  // A PEM block in base64 (`-----BEGIN` is `LS0tLS1CRUdJTi`), as config files and k8s secrets carry them. Any such
  // run is matched, not only a private key's: what follows BEGIN encodes differently by its offset, and a base64
  // certificate indexed by name only is a cheap miss.
  new RegExp(`${B}LS0tLS1CRUdJTi[A-Za-z0-9+/=]{40,}`),
  new RegExp(`${B}glpat-[A-Za-z0-9_-]{20,}`),
  // Stripe live secret and restricted keys (test keys are not secrets).
  new RegExp(`${B}[rs]k_live_[A-Za-z0-9]{16,}`),
  // Google API keys are exactly 39 characters.
  new RegExp(`${B}AIza[A-Za-z0-9_-]{35}${E}`),
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
