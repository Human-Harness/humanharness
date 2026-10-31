// What is never indexed (search spec §8.1), as pure predicates over paths relative to a root, with forward slashes.

/** By name, at any depth, compared without case. These files are not even indexed by name. */
const SECRET_NAMES: readonly RegExp[] = [
  /^\.env$/,
  /^\.env\..+$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^id_ecdsa/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^\.git-credentials$/,
  /^credentials/,
  /^secrets\./,
  /\.kdbx$/,
];

/** The app's temp files (an atomic write's `<name>.<uuid>.tmp`). */
const TEMP_NAME = /\.tmp$/i;

/** Under `.harness/`, only these are the person's: notes, review records and chats (data is plan 2's opt-in). */
const HARNESS_ALLOWED: readonly string[] = ["notes", "reviews", "chats"];

/** Applied only when the root has no `.gitignore` (§8.1). Folder (or file) names, at any depth. */
export const DEFAULT_IGNORED_DIRS: readonly string[] = ["node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target", ".DS_Store"];

export function deniedName(name: string): boolean {
  const n = name.toLowerCase();
  return TEMP_NAME.test(n) || SECRET_NAMES.some((r) => r.test(n));
}

/**
 * True when `rel` (a file or a folder) must never be indexed nor walked into. `extra`: more exact paths, such as the
 * engine's generated instructions file.
 */
export function deniedPath(rel: string, extra: readonly string[] = []): boolean {
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return true;
  if (parts.includes(".git") || parts.includes(".claude")) return true;
  if (parts[0] === ".harness" && parts.length > 1 && !HARNESS_ALLOWED.includes(parts[1])) return true;
  if (rel === "AGENTS.md" || extra.includes(rel)) return true;
  return parts.some(deniedName);
}
