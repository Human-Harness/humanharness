import { describe, expect, it } from "vitest";
import { cleanCodex, cleanMcp, cleanSettings } from "../../src/main/engine-config/clean";

const ctx = { folder: "/w", linked: ["/repo"], edit: "folder" as const, reserved: new Set(["ui", "data", "translate", "review", "harness"]) };

describe("cleanSettings (spec §5.4, E4, E5)", () => {
  it("keeps hooks and permissions allow/deny/ask", () => {
    const s = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node ./tools/check.js" }] }] }, permissions: { allow: ["Bash(npm test)"], deny: ["Bash(rm:*)"], ask: [] } };
    expect(cleanSettings(s, ctx)).toEqual({ settings: s, ignored: [] });
  });
  it("drops defaultMode and permissions.defaultMode as ignored", () => {
    expect(cleanSettings({ defaultMode: "bypassPermissions", permissions: { defaultMode: "acceptEdits" } }, ctx)).toEqual({ settings: { permissions: {} }, ignored: ["defaultMode", "permissions.defaultMode"] });
  });
  it.each(["env", "apiKeyHelper", "awsAuthRefresh", "forceLoginMethod", "model", "statusLine", "enabledPlugins"])("refuses %s naming it", (key) => {
    expect(() => cleanSettings({ [key]: "x" }, ctx)).toThrow(`settings.json: ${key} is not allowed`);
  });
  it("refuses permissions.additionalDirectories (folders come from linking)", () => {
    expect(() => cleanSettings({ permissions: { additionalDirectories: ["/etc"] } }, ctx)).toThrow("permissions.additionalDirectories");
  });
  it("permissions.edit none: edit-tool allow rules are dropped as ignored", () => {
    const r = cleanSettings({ permissions: { allow: ["Edit", "Write(./x)", "Read", "Bash(npm test)"] } }, { ...ctx, edit: "none" });
    expect(r.settings.permissions?.allow).toEqual(["Read", "Bash(npm test)"]);
    expect(r.ignored).toEqual(["permissions.allow: Edit", "permissions.allow: Write(./x)"]);
  });
  it("refuses an allow path rule outside the folder and its linked folders", () => {
    expect(() => cleanSettings({ permissions: { allow: ["Edit(//etc/**)"] } }, ctx)).toThrow("outside");
    expect(cleanSettings({ permissions: { allow: ["Edit(//repo/src/**)", "Edit(./docs/**)"] } }, ctx).settings.permissions?.allow).toHaveLength(2);
  });
  it.each(["Read(//etc/passwd)", "Edit(../x)", "Edit(~/notes)", "Edit(/x)", "Edit(//repo/../etc/**)"])("refuses the allow path rule %s as outside", (rule) => {
    expect(() => cleanSettings({ permissions: { allow: [rule] } }, ctx)).toThrow("outside");
  });
  it.each(["Edit", "Write", "MultiEdit", "NotebookEdit", "Edit()", "Write( )"])("refuses the edit allow rule %s without a path", (rule) => {
    expect(() => cleanSettings({ permissions: { allow: [rule] } }, ctx)).toThrow(`settings.json: permissions.allow: ${rule} needs a path inside the folder`);
  });
  it("bare Read, Glob and Grep allow rules stay", () => {
    expect(cleanSettings({ permissions: { allow: ["Read", "Glob", "Grep", "Read()"] } }, ctx).settings.permissions?.allow).toEqual(["Read", "Glob", "Grep", "Read()"]);
  });
  it.each(["Edit(//w*/**)", "Edit(//w-other/x)", "Read(//re*)", "Edit(./docs/../../etc/x)", "Edit(docs/..)"])("refuses the glob or .. escape %s", (rule) => {
    expect(() => cleanSettings({ permissions: { allow: [rule] } }, ctx)).toThrow("outside");
  });
  it("a glob inside a confined folder passes", () => {
    expect(cleanSettings({ permissions: { allow: ["Edit(//w/src*/**)", "Edit(*.md)", "Read(//repo/**)"] } }, ctx).settings.permissions?.allow).toHaveLength(3);
  });
  it.each(["Edit (//etc)", "edit(./x)", "bash", " Read"])("refuses the malformed allow rule %j", (rule) => {
    expect(() => cleanSettings({ permissions: { allow: [rule] } }, ctx)).toThrow("is not a valid rule");
  });
  it("MCP tool allow rules pass", () => {
    expect(cleanSettings({ permissions: { allow: ["mcp__scope-lint__run"] } }, ctx).settings.permissions?.allow).toEqual(["mcp__scope-lint__run"]);
  });
  it("deny and ask path rules outside the folder are kept (they only narrow)", () => {
    expect(cleanSettings({ permissions: { deny: ["Read(//etc/**)"], ask: ["Edit(//etc/**)"] } }, ctx).settings.permissions).toEqual({ deny: ["Read(//etc/**)"], ask: ["Edit(//etc/**)"] });
  });
  it("refuses a hook that is not a command hook", () => {
    expect(() => cleanSettings({ hooks: { Stop: [{ hooks: [{ type: "http", url: "x" }] }] } }, ctx)).toThrow("hooks.Stop");
  });
  it("refuses rule lists that are not lists of strings, and a non-object file", () => {
    expect(() => cleanSettings({ permissions: { allow: "Bash" } }, ctx)).toThrow("settings.json: permissions.allow");
    expect(() => cleanSettings({ permissions: { deny: [1] } }, ctx)).toThrow("settings.json: permissions.deny");
    expect(() => cleanSettings([], ctx)).toThrow("settings.json");
  });
  it("refuses prototype keys as hook events", () => {
    expect(() => cleanSettings(JSON.parse('{"hooks":{"__proto__":[]}}'), ctx)).toThrow("hooks.__proto__");
  });
  it("returns a copy: changing the input later doesn't change the result", () => {
    const s = { permissions: { allow: ["Read"] } };
    const r = cleanSettings(s, ctx);
    s.permissions.allow.push("Edit");
    expect(r.settings.permissions?.allow).toEqual(["Read"]);
  });
});

describe("cleanMcp (spec §5.2, E9, Decision 7, 8)", () => {
  it("stdio servers, renamed scope-<name>", () => {
    expect(cleanMcp({ mcpServers: { lint: { command: "node", args: ["./tools/lint.js"], env: { LEVEL: "1" } } } }, ctx)).toEqual([
      { name: "scope-lint", command: "node", args: ["./tools/lint.js"], env: { LEVEL: "1" } },
    ]);
  });
  it("args and env default to empty; type stdio is accepted", () => {
    expect(cleanMcp({ mcpServers: { a: { type: "stdio", command: "a" } } }, ctx)).toEqual([{ name: "scope-a", command: "a", args: [], env: {} }]);
  });
  it.each([
    [{ mcpServers: { x: { url: "https://e" } } }, "url servers are not supported"],
    [{ mcpServers: { x: { type: "http", command: "a" } } }, "url servers are not supported"],
    [{ mcpServers: { "Bad Name": { command: "a" } } }, "Bad Name"],
    [{ mcpServers: { x: { command: "a", env: { GITHUB_TOKEN: "t" } } } }, "GITHUB_TOKEN"],
    [{ mcpServers: { x: { command: "a", env: { OPENAI_API_KEY: "k" } } } }, "OPENAI_API_KEY"],
    [{ mcpServers: { x: { command: "-rf" } } }, "command"],
    [{ mcpServers: { x: { command: "" } } }, "command"],
    [{ mcpServers: { x: { command: "a", args: [1] } } }, "args"],
    [{ mcpServers: { x: { command: "a", cwd: "/" } } }, "cwd"],
    [{ mcpServers: { x: { command: "a", env: { DEPLOY_PRIVATE_KEY: "k" } } } }, "DEPLOY_PRIVATE_KEY"],
    [{ mcpServers: { x: { command: "a", env: { OPENAIKEY: "k" } } } }, "OPENAIKEY"],
    [{ mcpServers: { x: { command: "a", env: { GH_PAT: "k" } } } }, "GH_PAT"],
    [{ mcpServers: { x: { command: "a", env: { SITE_COOKIE: "k" } } } }, "SITE_COOKIE"],
    [{ mcpServers: { x: { command: "a", env: { SESSION_ID: "k" } } } }, "SESSION_ID"],
    [{ mcpServers: { x: { command: "a", env: { NODE_OPTIONS: "--require ./x.js" } } } }, "NODE_OPTIONS"],
    [{ mcpServers: { x: { command: "a", env: { PATH: "/tmp" } } } }, "PATH"],
    [{ mcpServers: { x: { command: "a", env: { DYLD_INSERT_LIBRARIES: "x" } } } }, "DYLD_INSERT_LIBRARIES"],
    [{ mcpServers: { x: { command: "a", env: { LD_PRELOAD: "x" } } } }, "LD_PRELOAD"],
    [{ mcpServers: { x: { command: "a", env: { PYTHONPATH: "x" } } } }, "PYTHONPATH"],
    [{ mcpServers: { x: { command: "a", env: { PYTHONSTARTUP: "x" } } } }, "PYTHONSTARTUP"],
    [{ mcpServers: { x: { command: "a", env: { BASH_ENV: "x" } } } }, "BASH_ENV"],
    [{ mcpServers: { x: { command: "a", env: { ENV: "x" } } } }, ".env.ENV"],
    [{ mcpServers: { x: { command: "a", env: { RUBYOPT: "x" } } } }, "RUBYOPT"],
    [{ mcpServers: { x: { command: "a", env: { PERL5OPT: "x" } } } }, "PERL5OPT"],
    [{ mcpServers: { x: { command: "a", env: { LEVEL: "${GITHUB_TOKEN}" } } } }, "env.LEVEL can't use $"],
    [{ mcpServers: { x: { command: "a", args: ["--token", "$GITHUB_TOKEN"] } } }, "args can't use $"],
    [{ mcpServers: { x: { command: "${HOME}/bin/a" } } }, "command can't use $"],
    [{ other: 1 }, "other"],
  ])("refuses %j", (m, message) => {
    expect(() => cleanMcp(m, ctx)).toThrow(message);
  });
  it("refusals start with the file name", () => {
    expect(() => cleanMcp({ other: 1 }, ctx)).toThrow(/^mcp\.json: /);
  });
  it("a renamed server can't equal a core or harness server", () => {
    expect(() => cleanMcp({ mcpServers: { x: { command: "a" } } }, { ...ctx, reserved: new Set(["scope-x"]) })).toThrow("scope-x");
  });
});

describe("cleanCodex (spec §5.4, Decision 9)", () => {
  it("passes allowlisted keys", () => {
    expect(cleanCodex({ model_verbosity: "low", features: { web_search_request: true }, tools: { web_search: true } }, { web: true })).toEqual({ model_verbosity: "low", features: { web_search_request: true }, tools: { web_search: true } });
  });
  it("passes the reasoning display keys, sandbox network access and command hooks", () => {
    const c = {
      model_reasoning_summary: "concise",
      hide_agent_reasoning: true,
      show_raw_agent_reasoning: false,
      sandbox_workspace_write: { network_access: true },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node ./tools/check.js", timeout: 30 }] }] },
    };
    expect(cleanCodex(c, { web: true })).toEqual(c);
  });
  it.each([
    [{ tools: { web_search: true } }, "tools.web_search"],
    [{ features: { web_search_request: true } }, "features.web_search_request"],
    [{ sandbox_workspace_write: { network_access: true } }, "sandbox_workspace_write.network_access"],
  ])("with the web off (or no permissions given), refuses %j", (c, key) => {
    expect(() => cleanCodex(c, { web: false })).toThrow(`codex.toml: ${key} is not allowed: the harness doesn't allow the web`);
    expect(() => cleanCodex(c)).toThrow(key);
    expect(Object.values(cleanCodex(JSON.parse(JSON.stringify(c).replace("true", "false")), { web: false }))).toHaveLength(1);
  });
  it("features is a named list: unknown flags are refused", () => {
    expect(() => cleanCodex({ features: { unified_exec: true } }, { web: true })).toThrow("codex.toml: features.unified_exec is not allowed");
  });
  it("enum-checks the reasoning display values", () => {
    expect(() => cleanCodex({ model_verbosity: "loud" })).toThrow("codex.toml: model_verbosity must be one of low, medium, high");
    expect(() => cleanCodex({ model_reasoning_summary: "all" })).toThrow("codex.toml: model_reasoning_summary must be one of");
  });
  it("hook event names are limited to a short identifier", () => {
    expect(() => cleanCodex({ hooks: { "Pre Tool": [] } })).toThrow("codex.toml: hooks.Pre Tool is not a valid hook event name");
    expect(() => cleanSettings({ hooks: { ["x".repeat(65)]: [] } }, ctx)).toThrow("is not a valid hook event name");
  });
  it.each(["model_provider", "model_providers", "openai_api_key", "azure_api_key", "cli_auth_credentials_store", "chatgpt_base_url", "mcp_servers", "profile", "profiles", "model", "model_reasoning_effort", "model_auto_compact_token_limit", "instructions", "sandbox_mode", "approval_policy"])("refuses %s naming it", (key) => {
    expect(() => cleanCodex({ [key]: "x" })).toThrow(`codex.toml: ${key} is not allowed`);
  });
  it("refuses unknown keys inside allowlisted tables, naming the dotted key", () => {
    expect(() => cleanCodex({ tools: { shell: true } })).toThrow("codex.toml: tools.shell is not allowed");
    expect(() => cleanCodex({ sandbox_workspace_write: { writable_roots: ["/"] } })).toThrow("codex.toml: sandbox_workspace_write.writable_roots is not allowed");
  });
  it("features takes booleans only", () => {
    expect(() => cleanCodex({ features: { x: "on" } })).toThrow("features.x");
  });
  it("checks value types", () => {
    expect(() => cleanCodex({ model_verbosity: 1 })).toThrow("codex.toml: model_verbosity");
    expect(() => cleanCodex({ tools: { web_search: "yes" } })).toThrow("codex.toml: tools.web_search");
    expect(() => cleanCodex({ hooks: { Stop: [{ hooks: [{ type: "prompt" }] }] } })).toThrow("codex.toml: hooks.Stop");
  });
});
