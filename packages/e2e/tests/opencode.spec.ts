import { expect, test } from "@playwright/test";
import { type AcpScript, claudeTextLines } from "@humanharness/fake-agent";
import { closeAndClean, launch, makeSandbox, readJsonl } from "./helpers";

/** What OpenCode offers for a local model with variants: its model and an effort select (category thought_level). */
const OPTIONS = [
  { id: "model", name: "Model", type: "select", currentValue: "ollama/llama3.2:3b", options: [{ value: "ollama/llama3.2:3b", name: "Llama 3.2" }] },
  { id: "effort", name: "Variant", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low" }, { value: "medium" }, { value: "high" }] },
];
const text = (t: string) => ({ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } });
// The session's running cost after the first prompt (USD), sent as OpenCode does: one usage_update at the prompt's end.
const opencode: AcpScript = { configOptions: OPTIONS, usage: { inputTokens: 900, outputTokens: 40 }, costs: [0.0123], turns: [[text("Se guarda en .harness/chats.")]] };

test("OpenCode answers a question, gets its effort by config option, and Settings › Usage shows the spending", async () => {
  const s = makeSandbox("opencode", { engineId: "opencode" });
  const { app, page } = await launch(s, { claude: { steps: claudeTextLines("unused") }, opencode });
  try {
    await page.getByRole("button", { name: "Start Demo" }).click();
    await page.getByPlaceholder("Or ask something…").fill("¿Dónde se guarda la conversación?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("main").getByText("Se guarda en .harness/chats.")).toBeVisible();

    const log = readJsonl<{ method: string; params: Record<string, unknown> }>(s.opencodeLog);
    // One OpenCode process: the config-option profile never restarts it.
    expect(log.filter((l) => l.method === "initialize")).toHaveLength(1);
    // No CODEX_CONFIG for OpenCode; a free question is light: effort "low", OpenCode's default model (no model set).
    const envs = log.filter((l) => l.method === "env");
    expect(envs.length).toBeGreaterThan(0);
    for (const env of envs) expect(env.params.CODEX_CONFIG).toBeNull();
    // OpenCode asks before bash, edits and web tools (the demo allows none of them) and never reads ~/.claude.
    for (const env of envs) {
      expect(JSON.parse(String(env.params.OPENCODE_CONFIG_CONTENT))).toEqual({ permission: { bash: "ask", edit: "ask", webfetch: "ask", websearch: "ask" } });
      expect(env.params.OPENCODE_DISABLE_CLAUDE_CODE).toBe("1");
    }
    expect(log.filter((l) => l.method === "session/set_config_option").map((l) => [l.params.configId, l.params.value])).toEqual([["effort", "low"]]);
    // The demo edits nothing (permissions.edit "none"): OpenCode's read-only mode.
    expect(log.find((l) => l.method === "session/set_mode")?.params.modeId).toBe("plan");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Usage" }).click();
    const usage = page.getByRole("tabpanel", { name: "Usage" });
    await expect(usage.getByText("Spent in the last 30 days")).toBeVisible();
    await expect(usage.getByText("US$ 0.01")).toBeVisible();
  } finally {
    await closeAndClean(app, s);
  }
});
