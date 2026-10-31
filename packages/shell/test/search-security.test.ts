import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inProcessBuild } from "../src/main/search/runner";
import { SearchService } from "../src/main/search/service";

const SECRETS = [`sk-${"Z".repeat(45)}`, `ghp_${"Q".repeat(36)}`, "AKIAQWERTYUIOPASDFGH", "-----BEGIN OPENSSH PRIVATE KEY-----", "OUTSIDE_SECRET_MARKER", "dotenv-password-value"];

let tmp: string;
let base: string;
let userData: string;
const put = (rel: string, text: string, root = base) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-sec-"));
  base = path.join(tmp, "Work");
  userData = path.join(tmp, "userData");
  put(".env", `PASSWORD=dotenv-password-value\nKEY=${SECRETS[0]}`);
  put("id_ed25519", `${SECRETS[3]}\nabc`);
  put("config/prod.key", "dotenv-password-value");
  put(".harness/notes/n.md", `---\ntitle: Tokens\n---\nbudget plan\nuse ${SECRETS[1]} for the bot`);
  put("docs/keys.txt", `${SECRETS[2]}\nharmless words`);
  put(".git/config", "dotenv-password-value");
  put("outside/secret.md", "OUTSIDE_SECRET_MARKER", tmp);
  fs.symlinkSync(path.join(tmp, "outside", "secret.md"), path.join(base, "link.md"));
  // A SecretStore-like folder beside the person's folder: outside the base, never walked.
  put("secrets/key", SECRETS[0], path.join(tmp, "humanharness"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("search never indexes or shows a secret (§8)", () => {
  it("not in the snapshot, not in any answer, not in the logs", async () => {
    const logs: string[] = [];
    const spies = (["error", "warn", "log", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))));
    try {
      const svc = new SearchService({
        userData: () => userData,
        base: async () => base,
        scoped: () => false,
        openScope: async () => null,
        scopeTitles: async () => new Map(),
        references: async () => [],
        memory: async () => [],
        extraDenied: async () => [],
        status: () => {},
        runner: inProcessBuild(),
        reveal: async () => true,
        storeDelayMs: 1,
      });
      await svc.query("", {});
      await svc.whenIdle();
      const answers = [];
      for (const q of ["sk", "ghp", "akia", "outside", "password", "dotenv", "private", "budget", "harmless", "keys", "link", "env", "id_ed25519", "prod"]) answers.push(await svc.query(q, {}));
      await svc.flush();
      const dir = path.join(userData, "search", fs.readdirSync(path.join(userData, "search"))[0]);
      const disk = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
      // Each answer echoes its query; the check is on what the index returned, not on what was typed.
      const shown = JSON.stringify(answers.map((a) => (a.ok ? { ...a, query: "" } : a)));
      for (const s of SECRETS) {
        expect(disk.toLowerCase()).not.toContain(s.toLowerCase());
        expect(shown.toLowerCase()).not.toContain(s.toLowerCase());
        expect(logs.join("\n").toLowerCase()).not.toContain(s.toLowerCase());
      }
      // Denied names are not even indexed by name; the secret-shaped file by name only; the note without its line.
      for (const name of [".env", "id_ed25519", "prod.key"]) expect(shown).not.toContain(name);
      expect(shown).toContain("keys.txt");
      expect(shown).not.toContain("harmless");
      expect(shown).toContain("budget");
      // The link: its own name only, never its target.
      expect(shown).toContain("link.md");
      expect(shown).not.toContain(path.join(tmp, "outside"));
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
