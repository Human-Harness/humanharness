import type { Code } from "mdast";

type Mermaid = (typeof import("mermaid"))["default"];

let loading: Promise<Mermaid> | null = null;

/** Mermaid is loaded the first time a diagram is drawn (§3.3): a chat without diagrams pays nothing. */
function loadMermaid(): Promise<Mermaid> {
  loading ??= import("mermaid").then(
    (m) => m.default,
    (err: unknown) => {
      // A failed load (a chunk that did not arrive) is tried again by the next diagram.
      loading = null;
      throw err;
    },
  );
  return loading;
}

export type Drawn = { ok: true; svg: string } | { ok: false; why: string };

let queue: Promise<unknown> = Promise.resolve();
let count = 0;

/** One draw at a time (Mermaid keeps global state): strict, no HTML labels, the app's colours. */
export function drawMermaid(code: string, themeVariables: Record<string, string>): Promise<Drawn> {
  const run = queue.then(async (): Promise<Drawn> => {
    try {
      const mermaid = await loadMermaid();
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables, flowchart: { htmlLabels: false } });
      await mermaid.parse(code);
      const { svg } = await mermaid.render(`hh-mermaid-${++count}`, code);
      return { ok: true, svg };
    } catch (err) {
      return { ok: false, why: mermaidWhy(err) };
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

/** "line 3: <the message's last line>", or the message's last line. */
export function mermaidWhy(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lines = msg.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  const detail = last.length > 80 ? `${last.slice(0, 79)}…` : last;
  const line = /line (\d+)/i.exec(msg)?.[1];
  return line ? `line ${line}: ${/^parse error on line/i.test(detail) ? "…" : detail}` : detail || "unknown error";
}

/** Whether a fenced code block's closing fence has arrived (an answer may still be streaming). */
export function fenceClosed(source: string, node: Code): boolean {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return true;
  const lines = source.slice(start, end).split("\n");
  const open = /^[ \t>]*(`{3,}|~{3,})/.exec(lines[0]);
  if (!open) return true;
  if (lines.length < 2) return false;
  const last = lines[lines.length - 1].replace(/^[ \t>]*/, "");
  const char = open[1][0] === "`" ? "`" : "~";
  return new RegExp(`^${char}{${open[1].length},}\\s*$`).test(last);
}
