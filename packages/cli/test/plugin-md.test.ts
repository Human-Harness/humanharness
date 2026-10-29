import { describe, expect, it } from "vitest";
import { PLUGIN_SECTIONS, parsePluginMd, parseTtl } from "../src/plugin-md";

const DOC = `# Mini

## Purpose

Shows items.

## Sources

| Source | Brings | TTL |
|---|---|---|
| \`items\` | The items | 15 min |
| events | Today's events | 6 h |

## Rules

None.

## Panels

- main: the items.

## Actions

- sum: summarizes.

## Permissions

- Host: api.example.com — the items API
- Host: \`*.example.org\` – mirrors
- Runs: \`gh api --method GET *\` — read issues
- Key: jira — the Jira token
- Tasks — the Summarize action

\`\`\`md
## Sources
- Host: fenced.example.com — not a line
\`\`\`

## Decision log

- 2026-10-28: started.
`;

describe("parsePluginMd", () => {
  it("reads the sections by their canonical names, whatever their case", () => {
    const doc = parsePluginMd(DOC.replace("## Rules", "## rules"));
    expect([...doc.sections.keys()]).toEqual([...PLUGIN_SECTIONS]);
    expect(doc.sections.get("Rules")?.line).toBeGreaterThan(0);
  });

  it("reads the Sources table's ids and TTLs, with backticks dropped", () => {
    expect(parsePluginMd(DOC).sources).toEqual([
      { id: "items", ttl: 900, line: 11 },
      { id: "events", ttl: 21600, line: 12 },
    ]);
  });

  it("has no sources table when the section has none", () => {
    expect(parsePluginMd("## Sources\n\nNone yet.\n").sources).toBeNull();
    expect(parsePluginMd("# Nothing\n").sources).toBeNull();
  });

  it("reads the permission bullets, outside code fences", () => {
    expect(parsePluginMd(DOC).permissions).toEqual({
      hosts: ["api.example.com", "*.example.org"],
      exec: ["gh api --method GET *"],
      keys: ["jira"],
      tasks: true,
    });
  });

  it("takes a bullet without a reason, and Tasks only as its own bullet", () => {
    const doc = parsePluginMd("## Permissions\n\n* Host: API.Example.com\n- Runs: date\n- Tasks: none here\n");
    expect(doc.permissions).toEqual({ hosts: ["api.example.com"], exec: ["date"], keys: [], tasks: false });
  });
});

describe("parseTtl", () => {
  it.each([
    ["300", 300],
    ["300 s", 300],
    ["300s", 300],
    ["45 seconds", 45],
    ["5 min", 300],
    ["1 minute", 60],
    ["6 h", 21600],
    ["2 hours", 7200],
    ["1 d", 86400],
    ["`900`", 900],
  ])("%s → %d", (cell, ttl) => {
    expect(parseTtl(cell)).toBe(ttl);
  });

  it.each(["", "soon", "5 weeks", "1.5 h", "-5"])("%j is not a TTL", (cell) => {
    expect(parseTtl(cell)).toBeNull();
  });
});
