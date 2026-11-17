import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Io } from "../src/cli";

/** The repository: what `--core` points at in tests. */
export const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** A writable that keeps what was written. */
export function memoryStream(): { stream: Writable; text: () => string } {
  let text = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  });
  return { stream, text: () => text };
}

/** An output that copies into `out` and calls `seen` with each chunk, after it is kept. */
export const watch = (out: ReturnType<typeof memoryStream>, seen: (text: string) => void) =>
  new Writable({
    write(chunk, _encoding, callback) {
      out.stream.write(chunk);
      seen(String(chunk));
      callback();
    },
  });

/** An Io over memory: `input` is what the person types (already ended). */
export function memoryIo(cwd: string, input = "") {
  const out = memoryStream();
  const err = memoryStream();
  const stdin = new PassThrough();
  stdin.end(input);
  const io: Io = { cwd, stdin, stdout: out.stream, stderr: err.stream };
  return { io, out: out.text, err: err.text };
}

/** A temporary folder outside the repository, removed by `cleanup`. */
export function tempRoot(prefix: string): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");

/** Replaces `from` with `to` in a file of a harness repo; fails when `from` isn't there. */
export function replaceIn(dir: string, file: string, from: string, to: string): void {
  const text = read(dir, file);
  if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
  fs.writeFileSync(path.join(dir, file), text.replace(from, to));
}

/**
 * Takes the template's example tool (`word-count`) out of a harness made with `init`: its manifest line, its HARNESS.md row,
 * `tools/` and tsconfig.json's "tools" include. What is left is the template as it was before it had a tool — the
 * "harness without tools" of the D0 pins.
 */
export function dropExampleTool(dir: string): void {
  const cfg = read(dir, "harness.config.ts");
  const line = cfg.match(/\n {2}\/\/ Code the AI[^\n]*\n {2}tools: \{ "word-count": "\.\/tools\/word-count\.ts" \},/)?.[0];
  if (line === undefined) throw new Error("harness.config.ts has no example tool");
  replaceIn(dir, "harness.config.ts", line, "");
  replaceIn(dir, "HARNESS.md", "| (example) counting words | Code | word-count | the agent doesn't spend a turn counting |\n", "");
  fs.rmSync(path.join(dir, "tools"), { recursive: true });
  replaceIn(dir, "tsconfig.json", '"include": ["harness.config.ts", "ui", "tools"]', '"include": ["harness.config.ts", "ui"]');
}

/**
 * Gives a harness made with `init` a custom block of its own, `example_card` (`show_example_card`), with its component
 * in ui/ExampleCard.tsx registered in ui/App.tsx: what tests of custom blocks build on, now that the template is made of
 * mods and has none.
 */
export function withExampleCard(dir: string): void {
  replaceIn(dir, "harness.config.ts", 'import { defineHarness, z } from "@humanharness/cli/sdk";', 'import { defineBlock, defineHarness, z } from "@humanharness/cli/sdk";');
  replaceIn(
    dir,
    "harness.config.ts",
    "\nexport default defineHarness({",
    [
      "",
      "const exampleCard = defineBlock({",
      '  description: "Shows one idea as a card: a short title and a body of one or two sentences. Use it once per answer, for the main idea.",',
      "  visible: true,",
      "  schema: z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(400) }),",
      '  example: { title: "One idea", body: "A short explanation of why it matters." },',
      "});",
      "",
      "export default defineHarness({",
    ].join("\n"),
  );
  replaceIn(dir, "harness.config.ts", "blocks: {},", "blocks: { example_card: exampleCard },");
  fs.writeFileSync(
    path.join(dir, "ui", "ExampleCard.tsx"),
    [
      'import { type BlockProps, useTranslation } from "@humanharness/cli/ui";',
      "",
      "export function ExampleCard({ data }: BlockProps) {",
      '  const { t } = useTranslation("harness");',
      '  if (typeof data?.title !== "string" || typeof data?.body !== "string") return null;',
      "  return (",
      '    <article aria-label={t("exampleCard")}>',
      "      <h3>{data.title}</h3>",
      "      <p>{data.body}</p>",
      "    </article>",
      "  );",
      "}",
      "",
    ].join("\n"),
  );
  replaceIn(dir, "ui/App.tsx", 'import "./harness.css";', 'import { ExampleCard } from "./ExampleCard";\nimport "./harness.css";');
  replaceIn(dir, "ui/App.tsx", "const startView =", "const blocks = { example_card: ExampleCard };\nconst startView =");
  replaceIn(dir, "ui/App.tsx", "<HarnessApp client={client} locales", "<HarnessApp client={client} blocks={blocks} locales");
  const en = JSON.parse(read(dir, "locales/en.json")) as Record<string, string>;
  fs.writeFileSync(path.join(dir, "locales", "en.json"), `${JSON.stringify({ ...en, exampleCard: "Idea" }, null, 2)}\n`);
}
