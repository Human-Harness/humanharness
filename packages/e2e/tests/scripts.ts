import { type AcpScript, type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";

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
const ui = (tool: string, args: Record<string, unknown>) => ({ mcp: { server: "ui", tool, args } });
const choices = ui("show_choices", {
  options: [
    { label: "Profundizar en las acciones", followUp: "Contame más de las acciones." },
    { label: "Seguir el recorrido →", next: true },
  ],
});

/** Claude: answers the manifest topic with blocks, saves a note when the app closes the topic, answers engines. */
export const claudeScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      // The closing turn's core prompt names the save_note tool; no brief does.
      match: "save_note",
      steps: [
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
    { match: "# Topic: engines", steps: [...claudeTextLines("Los motores se detectan en cada inicio."), choices, result] },
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
