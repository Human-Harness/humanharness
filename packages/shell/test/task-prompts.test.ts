import { describe, expect, it } from "vitest";
import { CLOSE_PROMPT, QUESTION_PROMPT, fillPrompt } from "../src/main/task-prompts";

const index = "## What we already covered\n- Engines → .harness/notes/engines.md";

describe("fillPrompt", () => {
  it("fills the language and the notes index", () => {
    expect(fillPrompt("Answer in {{language}}.\n\n{{ notesIndex }}", { language: "es", notesIndex: index })).toBe(`Answer in Spanish.\n\n${index}`);
    expect(fillPrompt("Answer in {{language}}.", { language: "en", notesIndex: "" })).toBe("Answer in English.");
  });

  it("appends the index when the brief has no place for it", () => {
    expect(fillPrompt("# Topic: blocks", { language: "en", notesIndex: index })).toBe(`# Topic: blocks\n\n${index}`);
  });

  it("leaves no run of blank lines when the index is empty", () => {
    expect(fillPrompt("Intro.\n\n{{notesIndex}}\n\nEnd.", { language: "en", notesIndex: "" })).toBe("Intro.\n\nEnd.");
  });

  it("keeps unknown placeholders and never fills values into inserted text", () => {
    expect(fillPrompt("{{other}} {{constructor}}", { language: "en", notesIndex: "" })).toBe("{{other}} {{constructor}}");
    expect(fillPrompt(QUESTION_PROMPT, { language: "en", notesIndex: "", question: "What is {{notesIndex}}?" })).toContain(
      "## Question\nWhat is {{notesIndex}}?",
    );
  });

  it("never rewrites the blank lines or edges of inserted text", () => {
    const question = "First part.\n\n\n\nSecond part after blank lines.\n";
    const notes = "## Notes\n\n\n- one\n";
    const text = fillPrompt(QUESTION_PROMPT, { language: "en", notesIndex: notes, question });
    expect(text).toContain(notes);
    expect(text.endsWith(`## Question\n${question}`)).toBe(true);
  });

  it("falls back to English for a language it does not know", () => {
    expect(fillPrompt("Answer in {{language}}.", { language: "fr" as never, notesIndex: "" })).toBe("Answer in English.");
  });

  it("builds a free question's first message with the index", () => {
    const text = fillPrompt(QUESTION_PROMPT, { language: "es", notesIndex: index, question: "¿Dónde se guarda la conversación?" });
    expect(text).toContain("Answer it in Spanish");
    expect(text).toContain(index);
    expect(text.endsWith("## Question\n¿Dónde se guarda la conversación?")).toBe(true);
  });

  it("asks the closing turn for save_note only", () => {
    expect(CLOSE_PROMPT).toContain("`save_note`");
    expect(CLOSE_PROMPT).toContain("do not call `show_choices`");
  });
});
