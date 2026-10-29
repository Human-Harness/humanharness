import type { EngineDef } from "../types";

/**
 * OpenCode's permission config (the 1.x `permission` map, which 2.x migrates): these tools ask before they run,
 * so every such call reaches `session/request_permission` and the harness's permissions decide it. Without it
 * OpenCode runs bash and webfetch without asking, even in its read-only `plan` agent.
 */
export const OPENCODE_PERMISSION = { bash: "ask", edit: "ask", webfetch: "ask", websearch: "ask" } as const;

/**
 * OpenCode's environment. Sources (github.com/anomalyco/opencode, formerly sst/opencode):
 * - 1.x (tag v1.19.4): packages/core/src/flag/flag.ts:22,69; packages/opencode/src/config/config.ts:482-489
 *   (OPENCODE_CONFIG_CONTENT) and :559-561 (OPENCODE_PERMISSION); packages/opencode/src/effect/runtime-flags.ts:24,28.
 * - 2.x (branch dev): packages/cli/src/server-process.ts:128-133; packages/core/src/config.ts:255-263;
 *   packages/core/src/config/normalize.ts:180 (the 1.x `permission` map becomes rules).
 * - Docs: packages/web/src/content/docs/cli.mdx:757,761,766 (opencode.ai/docs/cli, environment variables).
 *
 * `OPENCODE_CONFIG_CONTENT` is an inline config layer (1.x and 2.x) above the person's global and project config.
 * `OPENCODE_PERMISSION` is merged last over `permission` (1.x; 2.x does not read it). `OPENCODE_DISABLE_CLAUDE_CODE`
 * stops OpenCode from reading `~/.claude/CLAUDE.md` and `.claude/skills`, so they never reach the person's provider.
 */
export const OPENCODE_ENV: Readonly<Record<string, string>> = Object.freeze({
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: OPENCODE_PERMISSION }),
  OPENCODE_PERMISSION: JSON.stringify(OPENCODE_PERMISSION),
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
});

export const opencode: EngineDef = {
  id: "opencode",
  name: "OpenCode",
  provider: "OpenCode",
  status: "allowed",
  statusSource: "https://opencode.ai/docs/acp (2026-10-26)",
  requires: "An account or API key with a provider you set up in OpenCode, or a local model (Ollama)",
  dataLocation: "Depends on the provider you set up in OpenCode",
  trainsOnData: "Depends on the provider you set up in OpenCode",
  // OpenCode's own terms and privacy policy (spike); the chosen provider's terms apply on top.
  termsUrl: "https://opencode.ai/legal/terms-of-service",
  privacyUrl: "https://opencode.ai/legal/privacy-policy",
  // OpenCode 1.x and 2.x are both accepted (the status check reads either `auth list` format).
  // minVersion: set from the spike before release.
  detect: { binary: "opencode", versionArgs: ["--version"], minVersion: "0.0.0" },
  transport: { kind: "acp", command: ["opencode", "acp"], modes: { edit: "build", readOnly: "plan" }, profile: "config-option", env: { ...OPENCODE_ENV } },
  // The models come from OpenCode at session start; these efforts are what Settings offers until it does.
  models: { efforts: ["low", "medium", "high"] },
  reportsLimits: false,
  reportsCost: true,
  setup: {
    install: { command: "curl -fsSL https://opencode.ai/install | bash", docsUrl: "https://opencode.ai/docs/" },
    login: ["auth", "login"],
    status: { args: ["auth", "list"], format: "opencode-auth-list" },
    update: ["upgrade"],
    logout: ["auth", "logout"],
    inTerminal: ["login", "logout"],
    providersUrl: "https://opencode.ai/docs/providers/",
  },
  logo: "assets/opencode.svg",
};
