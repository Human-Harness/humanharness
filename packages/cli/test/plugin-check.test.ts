import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { type PluginFinding, checkPlugin, execWrites, formatPluginFindings, wildcardOverOneLabel } from "../src/plugin-check";
import { CORE, memoryIo, replaceIn, tempRoot } from "./helpers";

type Json = Record<string, any>;

/** A template-like plugin as plain plugin.json data: one of everything, every check clean. */
const manifest = (): Json => ({
  id: "mini",
  name: "Mini",
  version: "0.1.0",
  api: 1,
  harness: "*",
  permissions: {
    hosts: ["api.example.com"],
    exec: [{ cmd: "gh", args: ["api", "--method", "GET", "*"] }],
    secrets: [{ id: "jira", label: "Jira token" }],
    tasks: true,
  },
  sources: [{ id: "items", ttl: 900 }],
  data: { items: { key: "id", agent: "read", schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } } },
  panels: [{ id: "main", title: "Mini" }],
  chips: [{ id: "count" }],
  actions: [
    {
      id: "sum",
      label: "Summarize",
      tier: "light",
      scope: "none",
      vars: {
        type: "object",
        properties: { title: { type: "string" }, tone: { type: "string", default: "plain" } },
        required: ["title", "tone"],
        additionalProperties: false,
      },
      prompt: "Summarize {{title}} for the person.",
    },
  ],
});

const BACKEND = `import { definePluginBackend } from "@humanharness/harness-sdk/plugin-backend";

export default definePluginBackend({
  sources: {
    async items(ctx) {
      const res = await ctx.fetch("https://api.example.com/items", { headers: { Authorization: "Bearer {{secret:jira}}" } });
      const out = await ctx.exec("gh", ["api", "--method", "GET", "repos/x/y/issues"]);
      await ctx.data.replaceAll("items", [...(res.json() as { id: string }[]), { id: out.stdout }]);
    },
  },
});
`;

const PANEL = `import { useQuery } from "@humanharness/plugin-ui";
export default function Main() {
  return <p>{useQuery("items").records.length}</p>;
}
`;

const FIXTURE = JSON.stringify({ kind: "fetch", request: { method: "GET", url: "https://api.example.com/items" }, response: { status: 200, headers: {}, text: "[]" } });

/** PLUGIN.md as the guide writes it, from the manifest: the Sources table and one bullet per permission. */
function pluginMd(m: Json): string {
  const p = m.permissions ?? {};
  const bullets = [
    ...(p.hosts ?? []).map((h: string) => `- Host: ${h} — why`),
    ...(p.exec ?? []).map((e: { cmd: string; args: string[] }) => `- Runs: \`${[e.cmd, ...e.args].join(" ")}\` — why`),
    ...(p.secrets ?? []).map((s: { id: string }) => `- Key: ${s.id} — why`),
    ...(p.tasks ? ["- Tasks — the actions"] : []),
  ];
  const rows = (m.sources ?? []).map((s: { id: string; ttl: number }) => `| ${s.id} | things | ${s.ttl} s |`);
  return [
    `# ${m.name}`,
    "",
    "## Purpose",
    "",
    "Shows items.",
    "",
    "## Sources",
    "",
    "| Source | Brings | TTL |",
    "|---|---|---|",
    ...rows,
    "",
    "## Rules",
    "",
    "## Panels",
    "",
    "## Actions",
    "",
    "## Permissions",
    "",
    ...bullets,
    "",
    "## Decision log",
    "",
  ].join("\n");
}

const { root, cleanup } = tempRoot("hh-plugin-check-");
afterAll(cleanup);
let n = 0;

interface Edit {
  manifest?: (m: Json) => void;
  files?: Record<string, string | null>;
  /** PLUGIN.md from the edited manifest, unless the edit writes its own. */
  md?: (text: string) => string;
}

/** A fresh plugin folder with a built-looking dist/ (no build: these tests read dist/plugin.json as written). */
function fixture(edit: Edit = {}): string {
  const dir = path.join(root, `p${++n}`);
  const m = manifest();
  edit.manifest?.(m);
  const files: Record<string, string | null> = {
    "dist/plugin.json": `${JSON.stringify(m, null, 2)}\n`,
    "backend.ts": BACKEND,
    "panels/main.tsx": PANEL,
    "fixtures/items/001.json": FIXTURE,
    "PLUGIN.md": (edit.md ?? ((t) => t))(pluginMd(m)),
    ...edit.files,
  };
  for (const [name, text] of Object.entries(files)) {
    if (text === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const check = (dir: string, harness?: string) => checkPlugin(dir, { build: false, ...(harness ? { harness } : {}) });
const rules = (f: PluginFinding[]) => [...new Set(f.map((x) => `${x.severity}:${x.rule}`))];

describe("plugin check: the clean plugin", () => {
  it("finds nothing in a template-like plugin", async () => {
    const r = await check(fixture());
    expect(r.findings).toEqual([]);
    expect(r.manifest?.id).toBe("mini");
  });

  it("takes a declared wildcard for a literal URL in the backend (part 1's hostAllowed)", async () => {
    const r = await check(fixture({ manifest: (m) => (m.permissions.hosts = ["*.example.com"]) }));
    expect(r.findings).toEqual([]);
  });

  it("scans panels/** and src/** too, and skips other files", async () => {
    const dir = fixture({ files: { "src/lib/api.ts": 'export const U = "https://api.example.com/x";\n', "notes/readme.ts": 'const x = "https://elsewhere.example.net";\n' } });
    expect((await check(dir)).findings).toEqual([]);
  });
});

describe("plugin check: errors", () => {
  it("schema: a manifest the app's parser refuses, with its path", async () => {
    const r = await check(fixture({ manifest: (m) => (m.sources[0].ttl = 5) }));
    expect(r.manifest).toBeNull();
    expect(rules(r.findings)).toEqual(["error:schema"]);
    expect(r.findings[0].message).toMatch(/^sources\.0\.ttl: /);
  });

  it("schema: a missing or unreadable plugin.json", async () => {
    expect(rules((await check(fixture({ files: { "dist/plugin.json": null } }))).findings)).toEqual(["error:schema"]);
    expect(rules((await check(fixture({ files: { "dist/plugin.json": "{" } }))).findings)).toEqual(["error:schema"]);
  });

  it("schema: a collection the data model refuses (the loader's own check)", async () => {
    const r = await check(fixture({ manifest: (m) => (m.data.items.key = "nope") }));
    expect(rules(r.findings)).toEqual(["error:schema"]);
    expect(r.findings[0].message).toMatch(/^data: /);
  });

  it("api-version: plugin.json's api is not this core's", async () => {
    const r = await check(fixture({ manifest: (m) => (m.api = 2) }));
    expect(rules(r.findings)).toEqual(["error:api-version"]);
  });

  it("host-undeclared: a literal URL to a host plugin.json doesn't declare, with its file and line", async () => {
    const dir = fixture({ files: { "backend.ts": `${BACKEND}\nconst other = "https://Other.example.net/x";\n` } });
    const r = await check(dir);
    expect(rules(r.findings)).toEqual(["error:host-undeclared"]);
    expect(r.findings[0]).toMatchObject({ file: "backend.ts", line: 13 });
    expect(r.findings[0].message).toContain("other.example.net");
  });

  it("host-undeclared: in a panel", async () => {
    const r = await check(fixture({ files: { "panels/main.tsx": `${PANEL}const u = "https://cdn.example.net/x.png";\n` } }));
    expect(rules(r.findings)).toEqual(["error:host-undeclared"]);
    expect(r.findings[0].file).toBe("panels/main.tsx");
  });

  it("exec-undeclared: a command plugin.json doesn't declare", async () => {
    const r = await check(fixture({ files: { "backend.ts": BACKEND.replace('ctx.exec("gh"', 'ctx.exec("curl"') } }));
    expect(rules(r.findings)).toEqual(["error:exec-undeclared"]);
    expect(r.findings[0].message).toContain('"curl"');
  });

  it("secret-undeclared: a key reference plugin.json doesn't declare", async () => {
    const r = await check(fixture({ files: { "backend.ts": BACKEND.replace("{{secret:jira}}", "{{secret:github}}") } }));
    expect(rules(r.findings)).toEqual(["error:secret-undeclared"]);
    expect(r.findings[0].message).toContain('"github"');
  });

  it("fixtures-missing: a source with no fixtures/<source>/*.json", async () => {
    const r = await check(fixture({ files: { "fixtures/items/001.json": null } }));
    expect(rules(r.findings)).toEqual(["error:fixtures-missing"]);
    expect(r.findings[0].message).toContain('"items"');
  });

  it("prompt-placeholder: a placeholder that isn't a var, and a required var the prompt never uses", async () => {
    const r = await check(fixture({ manifest: (m) => (m.actions[0].prompt = "Summarize {{titel}}.") }));
    expect(rules(r.findings)).toEqual(["error:prompt-placeholder"]);
    expect(r.findings.map((f) => f.message)).toEqual([
      'actions "sum": the prompt uses {{titel}}, which is not a declared var',
      'actions "sum": the required var "title" is never used in the prompt',
    ]);
  });

  it("prompt-placeholder: a defaulted var (required in zod's output) may go unused", async () => {
    expect((await check(fixture())).findings).toEqual([]);
  });

  it("plugin-md-mismatch: an extra source row, named", async () => {
    const r = await check(fixture({ md: (t) => t.replace("| items | things | 900 s |", "| items | things | 900 s |\n| extra | more | 15 min |") }));
    expect(rules(r.findings)).toEqual(["error:plugin-md-mismatch"]);
    expect(r.findings[0]).toMatchObject({ file: "PLUGIN.md", line: 12 });
    expect(r.findings[0].message).toContain('"extra"');
  });

  it("plugin-md-mismatch: a missing row, a different TTL, no table, no file", async () => {
    const missing = await check(fixture({ md: (t) => t.replace("| items | things | 900 s |\n", "") }));
    expect(missing.findings.map((f) => f.message)).toEqual(['PLUGIN.md → Sources doesn\'t list the source "items"']);
    const ttl = await check(fixture({ md: (t) => t.replace("900 s", "5 min") }));
    expect(ttl.findings.map((f) => f.message)).toEqual(['PLUGIN.md → Sources says "items" syncs every 300 s; plugin.json says 900 s']);
    const table = await check(fixture({ md: (t) => t.replace("| Source | Brings | TTL |\n|---|---|---|\n", "") }));
    expect(rules(table.findings)).toEqual(["error:plugin-md-mismatch"]);
    const gone = await check(fixture({ files: { "PLUGIN.md": null } }));
    expect(gone.findings.map((f) => f.message)).toEqual(["PLUGIN.md is missing: write it as the /new-plugin guide says."]);
  });

  it("plugin-md-mismatch: permission bullets that aren't exactly the declared ones", async () => {
    const r = await check(
      fixture({
        md: (t) =>
          t
            .replace("- Host: api.example.com — why", "- Host: api.example.org — why")
            .replace("- Runs: `gh api --method GET *` — why", "- Runs: gh api * — why")
            .replace("- Key: jira — why\n", "")
            .replace("- Tasks — the actions\n", ""),
      }),
    );
    expect(rules(r.findings)).toEqual(["error:plugin-md-mismatch"]);
    expect(r.findings.map((f) => f.message)).toEqual([
      'PLUGIN.md → Permissions has "Host: api.example.org", which plugin.json doesn\'t declare',
      'PLUGIN.md → Permissions has no "Host: api.example.com" line',
      'PLUGIN.md → Permissions has "Runs: gh api *", which plugin.json doesn\'t declare',
      'PLUGIN.md → Permissions has no "Runs: gh api --method GET *" line',
      'PLUGIN.md → Permissions has no "Key: jira" line',
      'PLUGIN.md → Permissions has no "Tasks" line',
    ]);
  });
});

describe("plugin check: slots (--harness)", () => {
  const harness = async (slots: string) => {
    const dir = path.join(root, `h${++n}`);
    await initHarness({ dir, core: CORE, install: false });
    replaceIn(dir, "harness.config.ts", "  tone:", `  slots: ${slots},\n  tone:`);
    return dir;
  };

  it("slot-unknown: a panel or chip slot the harness doesn't declare, or of the other kind", async () => {
    const h = await harness('[{ id: "side", label: "Side", kind: "panel" }]');
    const ok = fixture({ manifest: (m) => (m.panels[0].slot = "side") });
    expect((await check(ok, h)).findings).toEqual([]);
    const core = fixture({ manifest: (m) => ((m.panels[0].slot = "plugins"), (m.chips[0].slot = "chips")) });
    expect((await check(core, h)).findings).toEqual([]);
    const bad = fixture({ manifest: (m) => ((m.panels[0].slot = "nowhere"), (m.chips[0].slot = "side")) });
    const r = await check(bad, h);
    expect(rules(r.findings)).toEqual(["error:slot-unknown"]);
    expect(r.findings.map((f) => f.message)).toEqual([
      'panels "main": the harness has no panel slot "nowhere" (it would go in "plugins")',
      'chips "count": the harness has no chip slot "side" (it would go in "chips")',
    ]);
  });

  it("slot-unknown: only with --harness", async () => {
    const dir = fixture({ manifest: (m) => (m.panels[0].slot = "nowhere") });
    expect((await check(dir)).findings).toEqual([]);
  });
});

describe("plugin check: warnings", () => {
  it("exec-wide: a command that is only * after its name", async () => {
    const r = await check(fixture({ manifest: (m) => m.permissions.exec.push({ cmd: "date", args: ["*"] }) }));
    expect(rules(r.findings)).toEqual(["warning:exec-wide"]);
  });

  it("exec-writes: a command that may write", async () => {
    const r = await check(fixture({ manifest: (m) => m.permissions.exec.push({ cmd: "gh", args: ["issue", "close", "*"] }) }));
    expect(rules(r.findings)).toEqual(["warning:exec-writes"]);
  });

  it.each([
    [["api", "--method", "GET", "*"], false],
    [["api", "-X", "head", "*"], false],
    [["api", "--method", "POST", "*"], true],
    [["api", "-X", "*"], true],
    [["api", "--request", "PUT", "x"], true],
    [["api", "--method=DELETE", "*"], true],
    [["api", "-XPATCH", "*"], true],
    [["api", "--method"], true],
    [["issue", "list", "*"], false],
    [["pr", "Merge", "*"], true],
    [["rm", "*"], true],
    [["repo", "create"], true],
    [["label", "edit", "*"], true],
  ])("exec-writes %j → %s", (args, writes) => {
    expect(execWrites(args)).toBe(writes);
  });

  it("hosts-wildcard: a wildcard over one label (which the manifest schema already refuses)", async () => {
    expect(wildcardOverOneLabel("*.com")).toBe(true);
    expect(wildcardOverOneLabel("*.com:8443")).toBe(true);
    expect(wildcardOverOneLabel("*.example.com")).toBe(false);
    expect(wildcardOverOneLabel("com")).toBe(false);
    const r = await check(fixture({ manifest: (m) => m.permissions.hosts.push("*.com") }));
    expect(rules(r.findings)).toEqual(["error:schema"]);
    expect(r.findings[0].message).toMatch(/^permissions\.hosts\.1: /);
    expect((await check(fixture({ manifest: (m) => m.permissions.hosts.push("*.example.co.uk") }))).findings).toEqual([]);
  });

  it("sync-heavy: a TTL under 60 seconds", async () => {
    const r = await check(fixture({ manifest: (m) => (m.sources[0].ttl = 30) }));
    expect(rules(r.findings)).toEqual(["warning:sync-heavy"]);
  });

  it("host-local: localhost or an IP literal, declared or in the sources", async () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.2:8443", "*.dev.localhost"]) {
      const r = await check(fixture({ manifest: (m) => m.permissions.hosts.push(host) }));
      expect(rules(r.findings), host).toEqual(["warning:host-local"]);
    }
    const src = await check(fixture({ files: { "backend.ts": `${BACKEND}const dev = "https://127.0.0.1:8080/x";\n` } }));
    expect(rules(src.findings)).toEqual(["warning:host-local"]);
  });
});

describe("humanharness plugin check", () => {
  it("prints the findings like the harness check and exits 1 on errors", async () => {
    const dir = fixture({ manifest: (m) => (m.api = 2) });
    const { io, out } = memoryIo(dir);
    expect(await main(["plugin", "check", "--no-build"], io)).toBe(1);
    expect(out()).toMatch(/^error {3}api-version/);
    expect(out()).toContain("1 error, 0 warnings");
  });

  it("--json prints parseable JSON with the findings; warnings exit 0", async () => {
    const dir = fixture({ manifest: (m) => (m.sources[0].ttl = 30) });
    const { io, out } = memoryIo(root);
    expect(await main(["plugin", "check", "--json", "--no-build", "--plugin", dir], io)).toBe(0);
    const json = JSON.parse(out());
    expect(json.findings.map((f: PluginFinding) => f.rule)).toEqual(["sync-heavy"]);
  });

  it("builds first unless --no-build: a plugin from sources checks clean", async () => {
    const dir = fixture({ files: { "dist/plugin.json": null } });
    const m = manifest();
    const config = `import { definePlugin, z } from "@humanharness/harness-sdk";

export default definePlugin({
  id: "mini",
  name: "Mini",
  version: "0.1.0",
  harness: "*",
  permissions: ${JSON.stringify(m.permissions)},
  sources: [{ id: "items", ttl: 900 }],
  data: { items: { key: "id", agent: "read", schema: z.object({ id: z.string() }) } },
  panels: [{ id: "main", title: "Mini" }],
  chips: [{ id: "count" }],
  actions: [{ id: "sum", label: "Summarize", tier: "light", scope: "none", vars: z.object({ title: z.string() }), prompt: "Summarize {{title}} for the person." }],
});
`;
    fs.writeFileSync(path.join(dir, "plugin.config.ts"), config);
    const { io, out } = memoryIo(dir);
    expect(await main(["plugin", "check"], io)).toBe(0);
    expect(out()).toBe("No problems found.\n");
    expect(fs.existsSync(path.join(dir, "dist", "panel-main.js"))).toBe(true);
  }, 30_000);

  it("a build that fails is an error finding, not a crash", async () => {
    const dir = fixture({ files: { "plugin.config.ts": "export default 1;\n" } });
    const r = await checkPlugin(dir);
    expect(r.manifest).toBeNull();
    expect(rules(r.findings)).toEqual(["error:schema"]);
    expect(r.findings[0].message).toMatch(/^The build failed: /);
  }, 30_000);

  it("formats a finding without a file", () => {
    expect(formatPluginFindings([{ rule: "schema", severity: "error", message: "The build failed: x" }])).toBe(
      `error   schema${" ".repeat(15)}${" ".repeat(22)}The build failed: x\n\n1 error, 0 warnings\n`,
    );
  });
});
