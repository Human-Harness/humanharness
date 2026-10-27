import { type AcpScript, type ClaudeScript, MOCK_SIDEKICK_MARKS, claudeTextLines } from "@humanharness/fake-agent";

/** A result line with usage, so usage.jsonl gets a record per turn. */
const result = {
  line: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: "fake-session",
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
  },
};
/** Claude's plan-limit snapshot (it comes after the turn's first API response); the window resets in 3 hours. */
const RESETS_AT = Math.floor(Date.now() / 1000) + 3 * 3600;
const limits = (fiveHour: number) => ({
  line: { type: "rate_limit_event", rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: fiveHour, resetsAt: RESETS_AT } } } },
});
const ui = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "ui", tool, args } });
const choices = ui("show_choices", {
  options: [
    { label: "Profundizar en las acciones", followUp: "Contame más de las acciones." },
    { label: "Seguir el recorrido →", next: true },
  ],
});

/**
 * Claude: answers the manifest topic with blocks, saves a note when the app closes the topic, answers engines.
 * Each turn reports the five-hour window: the manifest task uses 4 % of it (0.10 → 0.14 at the closing turn).
 */
export const claudeScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      // The closing turn's core prompt names the save_note tool; no brief does.
      match: "save_note",
      steps: [
        limits(0.14),
        ui("save_note", {
          title: "El manifiesto",
          summary: ["defineHarness valida el manifiesto", "Las acciones traen su brief"],
          decisions: ["Una sesión por tema"],
          files: ["packages/harness-sdk/src/index.ts"],
          open: [],
        }),
        ...claudeTextLines("Guardé el resumen."),
        result,
      ],
    },
    {
      match: "# Topic: the manifest",
      steps: [
        limits(0.1),
        ...claudeTextLines("El manifiesto declara todo el harness."),
        ui("show_diagram", {
          title: "Del manifiesto a la app",
          nodes: [
            { id: "config", label: "harness.config.ts" },
            { id: "sdk", label: "defineHarness", detail: "harness-sdk" },
            { id: "app", label: "La app", detail: "shell" },
          ],
          edges: [{ from: "config", to: "sdk" }, { from: "sdk", to: "app" }],
        }),
        ui("show_files", { files: [{ path: "packages/harness-sdk/src/index.ts", role: "valida el manifiesto" }] }),
        choices,
        result,
      ],
    },
    { match: "# Topic: engines", steps: [limits(0.15), ...claudeTextLines("Los motores se detectan en cada inicio."), choices, result] },
  ],
};

/** A result whose context (input + cache reads) is about 85% of the standard level's 200k cap. */
const bigResult = { line: { ...result.line, usage: { input_tokens: 170_000, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } } };

/** Claude: the manifest topic fills 85% of its cap, so the next follow-up first runs a checkpoint. */
export const checkpointScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: "^Checkpoint:",
      steps: [
        ui("save_note", { title: "El manifiesto", summary: ["defineHarness valida el manifiesto"], decisions: [], files: [], open: [] }),
        ...claudeTextLines("Guardé lo importante."),
        bigResult,
      ],
    },
    { match: "Contame más de las acciones", steps: [...claudeTextLines("Las acciones traen su brief."), bigResult] },
    { match: "# Topic: the manifest", steps: [...claudeTextLines("El manifiesto declara todo el harness."), choices, bigResult] },
  ],
};

/** Claude: the manifest topic rewrites plan.md in the person's folder (history by task). */
export const historyScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: "# Topic: the manifest",
      steps: [{ write: { path: "plan.md", content: "cambiado por la IA\n" } }, ...claudeTextLines("Cambié tu plan."), choices, result],
    },
  ],
};

/** Codex: one answer to a free question; its adapter offers one model. */
export const codexScript: AcpScript = {
  configOptions: [{ id: "model", name: "Model", type: "select", currentValue: "gpt-5.5", options: [{ value: "gpt-5.5", name: "GPT-5.5" }] }],
  turns: [[{ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Se guarda en .harness/chats." } } }, { stop: "end_turn" }]],
};

/** Claude: the template's example task, answered with its card and one choice. */
export const templateScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: "# Task: example",
      steps: [
        ...claudeTextLines("Hola, este harness todavía se está armando."),
        ui("show_example_card", { title: "Una idea", body: "Algo que vale la pena guardar." }),
        ui("show_choices", { options: [{ label: "Profundizar", followUp: "Contame más de esa idea." }] }),
        result,
      ],
    },
  ],
};

const sidekickReply = (o: unknown) => [...claudeTextLines(JSON.stringify(o)), result];
/** Sidekick's after-reply turn (on by default with Sidekick on): nothing to show, so no card (sidekick spec §4.2). */
const afterReplyTurn = { match: `^${MOCK_SIDEKICK_MARKS.after}`, steps: sidekickReply({}) };
/** Sidekick's learning turn at task close (sidekick spec §6.4): no changes. */
const learnTurn = { match: `^${MOCK_SIDEKICK_MARKS.learn}`, steps: sidekickReply({}) };

/** Claude where Sidekick's pre-send turn suggests a rewrite; every other turn answers "Listo." (sidekick spec §4.1). */
export const sidekickScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: `^${MOCK_SIDEKICK_MARKS.pre}`,
      steps: sidekickReply({
        verdict: "suggest",
        issues: [{ kind: "vague", text: "Say which part should be better." }],
        rewrite: "Explain how the manifest declares actions",
        confidence: 0.8,
      }),
    },
    afterReplyTurn,
    learnTurn,
  ],
};

/** Sidekick's turn never answers in time: the prompt goes as typed after the wait. */
export const slowSidekickScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [{ match: `^${MOCK_SIDEKICK_MARKS.pre}`, steps: [{ sleep: 15_000 }] }, afterReplyTurn, learnTurn],
};
