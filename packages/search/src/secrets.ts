// The content check (search spec §8.2). A hit is never logged, and neither is where in the file it was.

/** Only the start of a file is scanned. */
export const SECRET_SCAN_BYTES = 256 * 1024;

/** Token-shaped strings. No `g` flag: `test` keeps no state between calls. */
const PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{37,}/,
  /\b(?:ghp|gho)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abp]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
];

const hit = (text: string) => PATTERNS.some((p) => p.test(text));

/** A file whose first 256 KB hold a token-shaped string is indexed by name only. */
export function secretShaped(text: string): boolean {
  return hit(text.length > SECRET_SCAN_BYTES ? text.slice(0, SECRET_SCAN_BYTES) : text);
}

/** Notes and chats: the lines with a token-shaped string are left out, the rest is indexed. */
export function withoutSecretLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !hit(line))
    .join("\n");
}
