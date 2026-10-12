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

/** Codex: one answer to a free question. */
export const codexScript: AcpScript = {
  turns: [[{ update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Se guarda en .harness/chats." } } }, { stop: "end_turn" }]],
};
