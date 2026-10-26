import type { Writable } from "node:stream";
import { type ChoiceOption, type InputSpec, type Language, annotateSchema, choicesSchema } from "@humanharness/harness-sdk";
import { CORE_LOCALES } from "@humanharness/i18n";
import type { Event } from "@humanharness/runtime";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const MARK: Record<string, string> = { ok: "✓", gap: "…", wrong: "✗", note: "•" };

/** The app's own English message for an error code (`errors.*`), with the engine's name filled in. */
export function errorMessage(code: string, engine: string): string {
  const errors = CORE_LOCALES.en.errors as Record<string, unknown>;
  const text = errors[code];
  return (typeof text === "string" ? text : code).replaceAll("{{engine}}", engine);
}

/** `run`'s window: the events the app would show, as plain text. */
export class TerminalView {
  /** The options of the last `choices` block shown; `run` clears it before each operation. */
  choices: ChoiceOption[] = [];
  private lineStart = true;
  /** The data each input block was shown with, by its id: `run` answers from it. */
  readonly shown = new Map<string, unknown>();

  constructor(
    private readonly out: Writable,
    private readonly engineName: string,
    private readonly color = false,
    /** The harness's input blocks, by name (input-blocks spec §8). */
    private readonly inputs: Record<string, InputSpec> = {},
    private readonly language: Language = "en",
  ) {}

  event(e: Event): void {
    if (e.type === "text") this.write(e.delta);
    else if (e.type === "paragraph") this.write("\n\n");
    else if (e.type === "activity" && e.state === "start") this.line(this.dim(`  · ${e.kind}: ${e.detail}`));
    else if (e.type === "block") this.block(e.name, e.data, e.id);
    else if (e.type === "done") {
      if (e.ok) this.newline();
      else this.line(`✗ ${errorMessage(e.error.code, this.engineName)}${e.error.detail ? ` (${e.error.detail})` : ""}`);
    }
  }

  private block(name: string, data: unknown, id?: string): void {
    if (name === "save_note") return;
    if (name === "choices") {
      const parsed = choicesSchema.safeParse(data);
      if (!parsed.success) return;
      this.choices = parsed.data.options;
      this.newline();
      this.write("\n");
      parsed.data.options.forEach((o, i) => this.line(`  ${i + 1}. ${o.label}`));
      return;
    }
    if (name === "annotate") {
      const parsed = annotateSchema.safeParse(data);
      if (!parsed.success) return;
      this.line("  [annotate]");
      for (const m of parsed.data.marks) this.line(`    ${MARK[m.kind]} "${m.quote}"${m.comment ? ` — ${m.comment}` : ""}`);
      return;
    }
    this.line(`  [${name}]`);
    this.line(
      (JSON.stringify(data, null, 2) ?? "null")
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );
    // Own keys only: a block named `constructor` is no input block (D0).
    if (!Object.hasOwn(this.inputs, name)) return;
    const spec = this.inputs[name];
    if (id) this.shown.set(id, data);
    const fields = spec.fields.map((f) => `${f.label[this.language]} (${f.kind ?? "not here"})`).join(", ");
    this.line(`    Answer with a: ${fields}${spec.skippable ? " · can be skipped" : ""}`);
  }

  private dim(s: string): string {
    return this.color ? `${DIM}${s}${RESET}` : s;
  }

  private newline(): void {
    if (!this.lineStart) this.write("\n");
  }

  private line(s: string): void {
    this.newline();
    this.write(`${s}\n`);
  }

  private write(s: string): void {
    if (!s) return;
    this.out.write(s);
    this.lineStart = s.endsWith("\n");
  }
}
