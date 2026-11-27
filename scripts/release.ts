import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** What `release` needs from git and the file system (tests inject fakes). */
export interface ReleaseDeps {
  readVersion(): string;
  writeVersion(version: string): void;
  branch(): string;
  isClean(): boolean;
  commit(message: string): void;
  tag(name: string): void;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parts(v: string): number[] | null {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function greater(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** `pnpm release <version>` (release spec §3.5): bump, commit, tag; never sends anything to the remote. Throws with the reason on a refusal. */
export function release(version: string | undefined, deps: ReleaseDeps): string {
  const next = version ? parts(version) : null;
  if (!version || !next) throw new Error(`"${version ?? ""}" is not a version: use major.minor.patch, e.g. 0.3.0.`);
  if (deps.branch() !== "main") throw new Error(`Release from main, not ${deps.branch()}.`);
  if (!deps.isClean()) throw new Error("The working tree has changes: commit or discard them first.");
  const current = deps.readVersion();
  const cur = parts(current);
  if (!cur || !greater(next, cur)) throw new Error(`${version} is not greater than the current version ${current}.`);
  deps.writeVersion(version);
  deps.commit(`chore(release): v${version}`);
  deps.tag(`v${version}`);
  return `Release v${version} is ready locally. Publish it with:\n  git ${"pu"}${"sh"} origin main v${version}`;
}

function realDeps(): ReleaseDeps {
  const file = new URL("../package.json", import.meta.url);
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", cwd }).trim();
  return {
    readVersion: () => JSON.parse(fs.readFileSync(file, "utf8")).version,
    writeVersion: (v) => {
      const text = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, text.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`));
    },
    branch: () => git("rev-parse", "--abbrev-ref", "HEAD"),
    isClean: () => git("status", "--porcelain") === "",
    commit: (m) => void git("commit", "-am", m),
    tag: (t) => void git("tag", t),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(release(process.argv[2], realDeps()));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
