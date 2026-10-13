import { describe, expect, it } from "vitest";
import { CHECKPOINT_PROMPT, CLOSE_PROMPT, QUESTION_PROMPT, RESUME_PROMPT, fillPrompt, resumeMessage } from "../src/main/task-prompts";

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

describe("CHECKPOINT_PROMPT", () => {
  it("asks for save_note mid-task, without ending the conversation or showing choices", () => {
    expect(CHECKPOINT_PROMPT).toMatch(/^Checkpoint:/);
    expect(CHECKPOINT_PROMPT).toContain("`save_note`");
    expect(CHECKPOINT_PROMPT).toContain("do not call `show_choices`");
  });
});

describe("resumeMessage", () => {
  it("never claims the folder moved: it also runs after a move that failed", () => {
    expect(RESUME_PROMPT).not.toMatch(/moved/);
    expect(RESUME_PROMPT).toContain("not available");
  });

  it("an action's task: its brief filled as at its start, the resume line, then the person's message", () => {
    const text = resumeMessage({ language: "es", notesIndex: index, brief: "# Topic: blocks\nAnswer in {{language}}.", message: "¿Y {{notesIndex}}?" });
    expect(text.startsWith(`# Topic: blocks\nAnswer in Spanish.\n\n${index}\n\nThe earlier conversation`)).toBe(true);
    expect(text).toContain("Answer in Spanish, then end with `show_choices`.");
    expect(text.endsWith("## The person's message\n¿Y {{notesIndex}}?")).toBe(true);
  });

  it("a free question's task: the question that opened it, after the notes index", () => {
    const text = resumeMessage({ language: "en", notesIndex: index, question: "Where is the chat kept?", message: "And the notes?" });
    expect(text).toBe(
      [
        "The earlier conversation of this topic is not available; continue from the notes and the files in the folder. Answer in English, then end with `show_choices`.",
        index,
        "## The question that opened this topic\nWhere is the chat kept?",
        "## The person's message\nAnd the notes?",
      ].join("\n\n"),
    );
  });
});
