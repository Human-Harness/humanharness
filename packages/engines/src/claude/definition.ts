import { CLAUDE_MODELS, EFFORTS } from "../models";
import type { EngineDef } from "../types";

export const claude: EngineDef = {
  id: "claude",
  name: "Claude",
  status: "allowed",
  statusSource: "https://code.claude.com/docs/en/legal-and-compliance (2026-10-10)",
  requires: "Claude Pro or Max plan",
  dataLocation: "Anthropic, USA",
  trainsOnData: "Depends on your privacy settings in claude.ai",
  termsUrl: "https://www.anthropic.com/legal/consumer-terms",
  privacyUrl: "https://www.anthropic.com/legal/privacy",
  detect: { binary: "claude", versionArgs: ["--version"], minVersion: "2.1.296" },
  transport: { kind: "claude-cli", binary: "claude" },
  instructionsFile: { path: "CLAUDE.md", content: "@AGENTS.md\n" },
  models: { list: CLAUDE_MODELS, efforts: EFFORTS },
  provider: "Anthropic",
  reportsLimits: true,
  limits: { primary: "five_hour" },
  plansUrl: "https://claude.com/pricing",
  setup: {
    install: { command: "curl -fsSL https://claude.ai/install.sh | bash", docsUrl: "https://code.claude.com/docs/en/setup" },
    login: ["auth", "login"],
    status: { args: ["auth", "status", "--json"], format: "json-logged-in" },
    update: ["update"],
    logout: ["auth", "logout"],
  },
  logo: "assets/claude.svg",
};
