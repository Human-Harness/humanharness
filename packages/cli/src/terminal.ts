import type { Writable } from "node:stream";
import { type ChoiceOption, type InputSpec, annotateSchema, choicesSchema, recommendModeSchema } from "@humanharness/harness-sdk";
import type { ReviewSummary } from "@humanharness/harness-sdk/review";
import { CORE_LOCALES } from "@humanharness/i18n";
import type { Event } from "@humanharness/runtime";
import type { TaskTurnNotice } from "@humanharness/protocol";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const MARK: Record<string, string> = { ok: "✓", gap: "…", wrong: "✗", note: "•" };

/** The app's own English message for an error code (`errors.*`), with the engine's name filled in. */
export function errorMessage(code: string, engine: string): string {
  const errors = CORE_LOCALES.en.errors as Record<string, unknown>;
  const text = errors[code];
  return (typeof text === "string" ? text : code).replaceAll("{{engine}}", engine);
}

/**
 * The agent's text as one plain line: no terminal control characters (an escape sequence could redraw the terminal),
 * line breaks and tabs as spaces.
 */
const plain = (s: string) => s.replace(/[\t\n\v\f\r]/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "").replace(/ {2,}/g, " ").trim();

/** The terminal's review line (review spec §6.3): the status when it is final, else what is still open. */
export function reviewLine(r: ReviewSummary): string {
  if (r.status === "approved") return "approved";
  if (r.status === "stale") return "changed since approval";
  if (r.questions === 0) return r.comments > 0 ? `${r.comments} comment${r.comments === 1 ? "" : "s"} open` : "in review";
  return `${r.questions} question${r.questions === 1 ? "" : "s"} open${r.blocking > 0 ? ` (${r.blocking} blocking)` : ""}`;
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
    /** The open task's action's modes (task-modes spec §4); undefined: not known, every valid id is drawn. */
    private readonly listedModes: () => readonly string[] | undefined = () => undefined,
    /** A document's review summary (review spec §6.3); absent for a harness whose agent can't edit the folder (D0). */
    private readonly reviewOf: (path: string) => ReviewSummary | null = () => null,
  ) {}

  event(e: Event): void {
    if (e.type === "text") this.write(e.delta);
    else if (e.type === "paragraph") this.write("\n\n");
    else if (e.type === "activity" && e.state === "start") this.line(this.dim(`  · ${e.kind}: ${e.detail}`));
    else if (e.type === "block") this.block(e.name, e.data, e.id);
    // A path is the agent's text: drawn without terminal control characters.
    else if (e.type === "documents")
      for (const d of e.documents) {
        const path = plain(d.path);
        if (!path) continue;
        this.line(`Documents: ${path} (${d.change})`);
        const r = this.reviewOf(d.path);
        if (r) this.line(`Review: ${reviewLine(r)}`);
      }
    else if (e.type === "done") {
      if (e.ok) this.newline();
      else this.line(`✗ ${errorMessage(e.error.code, this.engineName)}${e.error.detail ? ` (${e.error.detail})` : ""}`);
    }
  }

  /** A line of the run's tools (a call, a note): on a line of its own, as given. */
  toolLine(s: string): void {
    this.line(s);
  }

  /** A turn the app starts on its own (task-phases spec §4.4, §5): its line, before its answer. */
  taskTurn(n: TaskTurnNotice, label?: string): void {
    this.newline();
    this.write(n.kind === "wrap-up" ? "\nTime is almost up\n" : `\n— ${plain(label ?? n.phase ?? "")} —\n`);
  }

  /**
   * The agent's proposal to move (task-phases spec §4.3), with how to act on it: to the current part (the close part
   * is done) it says how to finish, to another part how to go there.
   */
  proposal(p: { to: string; reason: string }, label: string, current: boolean): void {
    const reason = plain(p.reason);
    const why = /[.!?]$/.test(reason) ? reason : `${reason}.`;
    this.newline();
    this.write(
      current ? `\nThe AI says this part is done: ${why} Type q to finish.\n` : `\nThe AI proposes to move to ${plain(label)}: ${why} Type >phase ${p.to} to go there.\n`,
    );
  }

  private block(name: string, data: unknown, id?: string): void {
    // Hidden state blocks: the run prints what follows from `set_phase` (a proposal, a part's line), never the call.
    if (name === "save_note" || name === "set_phase") return;
    if (name === "choices") {
      const parsed = choicesSchema.safeParse(data);
      if (!parsed.success) return;
      this.choices = parsed.data.options;
      this.newline();
      this.write("\n");
      parsed.data.options.forEach((o, i) => this.line(`  ${i + 1}. ${o.label}`));
      return;
    }
    if (name === "recommend_mode") {
      const parsed = recommendModeSchema.safeParse(data);
      if (!parsed.success) return;
      // Ids the action doesn't list are dropped; an unlisted recommendation draws nothing.
      const listed = this.listedModes();
      const known = (mode: string) => listed === undefined || listed.includes(mode);
      if (!known(parsed.data.recommended)) return;
      this.newline();
      this.write("\n");
      this.line(`  Recommended mode: ${parsed.data.recommended}`);
      for (const reason of parsed.data.reasons.map(plain).filter(Boolean)) this.line(`    - ${reason}`);
      const alternatives = (parsed.data.alternatives ?? []).filter((a) => known(a.mode));
      if (alternatives.length > 0) {
        this.line("  Or:");
        for (const a of alternatives) this.line(`    ${a.mode}: ${plain(a.why)}`);
      }
      this.line("  Type m <mode> to pick one.");
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
    const fields = spec.fields.map((f) => `${f.label} (${f.kind ?? "not here"})`).join(", ");
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
