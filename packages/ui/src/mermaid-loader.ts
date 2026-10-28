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

/** A drawing; a failure with Mermaid's reason; a draw given up after DRAW_TIMEOUT_MS; a draw nobody wanted any more. */
export type Drawn = { ok: true; svg: string } | { ok: false; why: string } | { ok: false; slow: true } | { ok: false; skipped: true };

/** Mermaid's own secure keys, plus `htmlLabels`: a diagram's `%%{init}%%` directive can't turn HTML labels back on. */
const SECURE = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels"];

/**
 * What every draw runs with: strict, labels as SVG text (the root `htmlLabels`; `flowchart.htmlLabels` is deprecated in
 * Mermaid 12 and the root wins), the app's colours, and no error drawing left behind in the page.
 */
export function mermaidConfig(themeVariables: Record<string, string>) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    htmlLabels: false,
    secure: SECURE,
    suppressErrorRendering: true,
    theme: "base" as const,
    themeVariables,
  };
}

/** A draw that takes longer than this is given up (its source is shown). */
export const DRAW_TIMEOUT_MS = 15_000;

// Drawn diagrams by source and colours: a redraw (a remount, a message drawn again) costs nothing. Oldest out first.
const CACHE_SIZE = 40;
const cache = new Map<string, Drawn>();

function remember(key: string, drawn: Drawn): void {
  cache.delete(key);
  cache.set(key, drawn);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

let queue: Promise<unknown> = Promise.resolve();
let count = 0;

/**
 * One draw at a time (Mermaid keeps global state). `wanted` is asked when the draw's turn comes: a diagram that left the
 * screen (or whose colours changed) meanwhile is skipped.
 */
export function drawMermaid(code: string, themeVariables: Record<string, string>, wanted: () => boolean = () => true): Promise<Drawn> {
  const key = `${JSON.stringify(themeVariables)}\n${code}`;
  const hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    return Promise.resolve(hit);
  }
  const run = queue.then(async (): Promise<Drawn> => {
    if (!wanted()) return { ok: false, skipped: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Drawn>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, slow: true }), DRAW_TIMEOUT_MS);
    });
    const draw = (async (): Promise<Drawn> => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize(mermaidConfig(themeVariables));
        await mermaid.parse(code);
        const { svg } = await mermaid.render(`hh-mermaid-${++count}`, code);
        const drawn: Drawn = { ok: true, svg };
        remember(key, drawn);
        return drawn;
      } catch (err) {
        return { ok: false, why: mermaidWhy(err) };
      }
    })();
    try {
      return await Promise.race([draw, timeout]);
    } finally {
      clearTimeout(timer);
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

/** A diagram's own accessible title and description (`accTitle: …`, `accDescr: …`), for the image's alt text. */
export function mermaidAccessible(code: string): { title?: string; description?: string } {
  const out: { title?: string; description?: string } = {};
  // Line by line with plain string tests: no regex runs over the diagram's text.
  for (const raw of code.split("\n")) {
    const line = raw.trim();
    for (const [word, field] of [
      ["accTitle", "title"],
      ["accDescr", "description"],
    ] as const) {
      if (out[field] || !line.startsWith(word)) continue;
      const rest = line.slice(word.length).trimStart();
      if (rest.startsWith(":")) out[field] = rest.slice(1).trim() || undefined;
    }
  }
  return out;
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
