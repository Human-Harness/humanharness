import { type ClaudeScript, claudeTextLines } from "@humanharness/fake-agent";

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

/** The quiz: a question to commit to, then marks on the person's own words. */
export const quizScript: ClaudeScript = {
  steps: [...claudeTextLines("Listo."), result],
  turns: [
    {
      match: "save_note",
      steps: [ui("save_note", { title: "Mitades", summary: ["Dos mitades son un entero"], decisions: [], files: [], open: [] }), ...claudeTextLines("Guardé el resumen."), result],
    },
    {
      match: "\\[respuesta a commit_answer\\]",
      steps: [
        ...claudeTextLines("Bien pensado."),
        ui("show_annotate", { ref: "last", marks: [{ quote: "dos mitades", kind: "ok", comment: "Exacto." }] }),
        result,
      ],
    },
    {
      match: "# Task: practice",
      steps: [
        ...claudeTextLines("Primero, comprometete."),
        ui("show_commit_answer", { question: "¿Quién comió más?", options: ["Yo", "Mi amiga", "Las dos igual"] }),
        result,
      ],
    },
  ],
};
