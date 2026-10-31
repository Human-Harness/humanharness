import { describe, expect, it } from "vitest";
import { DEFAULT_IGNORED_DIRS, deniedName, deniedPath, overTextBudget } from "../src";

describe("deniedPath (§8.1)", () => {
  it.each([
    ".git/config",
    "a/.git/HEAD",
    ".claude/settings.json",
    "x/.claude/agents/a.md",
    ".harness/tasks.json",
    ".harness/usage.jsonl",
    ".harness/data/main/tickets.json",
    ".harness/context/main.json",
    ".harness/data-meta/main.json",
    "AGENTS.md",
    ".env",
    ".env.local",
    "conf/.ENV.production",
    "certs/site.pem",
    "a/b/server.key",
    "x.p12",
    "x.pfx",
    "app.keystore",
    "id_rsa",
    "keys/id_rsa.pub",
    "id_ed25519",
    "id_ecdsa",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".git-credentials",
    "credentials.json",
    "aws/Credentials",
    "secrets.yaml",
    "vault.kdbx",
    "config.json.123e4567-e89b-12d3-a456-426614174000.tmp",
  ])("denies %s", (p) => {
    expect(deniedPath(p)).toBe(true);
  });

  it.each([
    ".harness",
    ".harness/notes/a.md",
    ".harness/notes/physics/a.md",
    ".harness/reviews/docs/a.md.json",
    ".harness/chats/main.jsonl",
    "docs/env.md",
    "keys.md",
    "my-credential-notes.md",
    "secrets",
    "src/key.ts",
  ])("allows %s", (p) => {
    expect(deniedPath(p)).toBe(false);
  });

  it("denies the engine's instructions file when told", () => {
    expect(deniedPath("CLAUDE.md")).toBe(false);
    expect(deniedPath("CLAUDE.md", ["CLAUDE.md"])).toBe(true);
  });

  it("names are compared without case", () => {
    expect(deniedName("ID_RSA")).toBe(true);
    expect(deniedName("Server.PEM")).toBe(true);
  });

  it("has the default list for a folder without .gitignore", () => {
    expect(DEFAULT_IGNORED_DIRS).toEqual(["node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target", ".DS_Store"]);
  });
});

describe("overTextBudget (§4.5)", () => {
  it("takes the largest files out first until the total fits", () => {
    const over = overTextBudget(
      [
        { key: "a", size: 50 },
        { key: "b", size: 10 },
        { key: "c", size: 40 },
      ],
      60,
    );
    expect([...over].sort()).toEqual(["a"]);
  });

  it("takes nothing out when everything fits", () => {
    expect(overTextBudget([{ key: "a", size: 1 }], 10).size).toBe(0);
  });
});
