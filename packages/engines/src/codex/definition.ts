import type { EngineDef } from "../types";

export const codex: EngineDef = {
  id: "codex",
  name: "Codex",
  status: "allowed",
  statusSource: "https://developers.openai.com/siwc/token-sharing-open-source (2026-10-10)",
  requires: "ChatGPT plan (Plus, Pro or higher)",
  dataLocation: "OpenAI, USA",
  trainsOnData: "Depends on your data controls in ChatGPT",
  termsUrl: "https://openai.com/policies/terms-of-use/",
  privacyUrl: "https://openai.com/policies/privacy-policy/",
  // The adapter bundles its own Codex core; `codex` itself is only needed for `codex login`
  // (minVersion is the tested CLI). The adapter is gated by transport.minAdapterVersion.
  detect: { binary: "codex", versionArgs: ["--version"], minVersion: "0.160.1" },
  transport: {
    kind: "acp",
    command: ["npx", "-y", "@agentclientprotocol/codex-acp@2.2.2"],
    modes: { edit: "workspace-write", readOnly: "read-only" },
    minAdapterVersion: "2.2.2",
  },
  // The model list comes from the adapter; these efforts are what Settings offers until it does.
  models: { efforts: ["low", "medium", "high"] },
  provider: "OpenAI",
  brands: ["ChatGPT", "GPT"],
  reportsLimits: false,
  plansUrl: "https://chatgpt.com/pricing",
  // The app runs the official Codex CLI bundled with the ACP adapter (status, login), so it never
  // installs Codex itself; the official install command is kept for builds without the bundle.
  setup: {
    install: { command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", docsUrl: "https://learn.chatgpt.com/docs/codex/cli" },
    login: ["login"],
    status: { args: ["login", "status"], format: "exit-code" },
    logout: ["logout"],
  },
  logo: "assets/codex.svg",
};
