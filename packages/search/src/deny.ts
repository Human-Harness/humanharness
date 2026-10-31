// What is never indexed (search spec §8.1), as pure predicates over paths relative to a root.

/** By name, at any depth, compared without case. These files are not even indexed by name. */
const SECRET_NAMES: readonly RegExp[] = [
  /\.env$/,
  /^\.env\..+$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /\.jks$/,
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

/** Tool credential files, as runs of path parts at any depth (a `.aws` folder is denied whole, below). */
const SECRET_PATHS: readonly (readonly string[])[] = [
  [".kube", "config"],
  [".docker", "config.json"],
  [".config", "gh", "hosts.yml"],
  [".config", "gh", "hosts.yaml"],
];

/** True when `seq` appears in `parts` as consecutive parts. */
function hasRun(parts: readonly string[], seq: readonly string[]): boolean {
  for (let i = 0; i + seq.length <= parts.length; i++) if (seq.every((s, j) => parts[i + j] === s)) return true;
  return false;
}

/** The app's temp files (an atomic write's `<name>.<uuid>.tmp`). */
const TEMP_NAME = /\.tmp$/i;

/** Under `.harness/`, only these are the person's: notes, review records and chats (data is plan 2's opt-in). */
const HARNESS_ALLOWED: readonly string[] = ["notes", "reviews", "chats"];

/** Applied only when the root has no `.gitignore` (§8.1). Folder (or file) names, at any depth. */
export const DEFAULT_IGNORED_DIRS: readonly string[] = ["node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target", ".DS_Store"];

/** A name without its trailing dots and spaces, which Windows drops (`.env.` and `.env ` open `.env`). */
function withoutTrailingDots(name: string): string {
  let end = name.length;
  while (end > 0 && (name[end - 1] === "." || name[end - 1] === " ")) end--;
  return name.slice(0, end);
}

export function deniedName(name: string): boolean {
  const n = name.toLowerCase();
  const bare = withoutTrailingDots(n);
  return [n, bare].some((x) => TEMP_NAME.test(x) || SECRET_NAMES.some((r) => r.test(x)));
}

/**
 * True when `rel` (a file or a folder) must never be indexed nor walked into. `extra`: more exact paths, such as the
 * engine's generated instructions file.
 */
export function deniedPath(rel: string, extra: readonly string[] = []): boolean {
  // Compared without case, with `\` read as a separator and each part without trailing dots and spaces, so that
  // `.GIT/config`, `.claude\settings.json` and `.git./config` are what they open on macOS and Windows.
  const path = rel.replaceAll("\\", "/");
  const raw = path.split("/");
  if (raw.some((p) => p === "" || p === "." || p === "..")) return true;
  const parts = raw.map((p) => withoutTrailingDots(p.toLowerCase()));
  if (parts.some((p) => p === "")) return true;
  if (parts.includes(".git") || parts.includes(".claude") || parts.includes(".aws")) return true;
  if (SECRET_PATHS.some((seq) => hasRun(parts, seq))) return true;
  if (parts[0] === ".harness" && parts.length > 1 && !HARNESS_ALLOWED.includes(raw[1].toLowerCase())) return true;
  const key = parts.join("/");
  if (key === "agents.md" || extra.some((x) => x.replaceAll("\\", "/").toLowerCase() === key)) return true;
  return raw.some(deniedName);
}
