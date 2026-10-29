import { fileURLToPath } from "node:url";

export * from "./script";
export * from "./mock";
export * from "./mock-replay";
export { callMcpTool } from "./mcp-call";
export { MOCK_SIDEKICK_MARKS, isMockSidekickTurn, mockSidekickReply } from "./mock-claude";
export { pseudoTranslate, type PseudoStrings } from "./pseudo";

const tsx = () => import.meta.resolve("tsx");
const entry = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/** Command that starts the fake `claude` CLI. Pass it as the transport command. */
export function fakeClaudeCommand(): string[] {
  return [process.execPath, "--import", tsx(), entry("./fake-claude.ts")];
}

/** Command that starts the fake ACP agent. */
export function fakeAcpCommand(): string[] {
  return [process.execPath, "--import", tsx(), entry("./fake-acp.ts")];
}
