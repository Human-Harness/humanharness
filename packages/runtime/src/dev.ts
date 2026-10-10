// Development runner: one harness turn in the terminal against a real engine.
// pnpm hh-dev --harness harnesses/demo/harness.config.ts --folder ~/tmp/demo --engine claude "make a note"
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { availableEngines } from "@humanharness/engines";
import { LANGUAGES, type Language, loadHarness } from "@humanharness/harness-sdk";
import { createRuntime } from "./runtime";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    harness: { type: "string" },
    folder: { type: "string" },
    engine: { type: "string", default: "claude" },
    language: { type: "string", default: "es" },
  },
});

const message = positionals.join(" ");
if (!values.harness || !values.folder || !message) {
  console.error('Usage: pnpm hh-dev --harness <harness.config.ts> --folder <dir> [--engine claude|codex] [--language es|en] "<message>"');
  process.exit(2);
}
if (!LANGUAGES.includes(values.language as Language)) {
  console.error(`Unknown language: ${values.language}`);
  process.exit(2);
}

const harness = await loadHarness(values.harness);
const engine = availableEngines(harness.engines, "development").find((e) => e.id === values.engine);
if (!engine) {
  console.error(`Engine "${values.engine}" is not available for ${harness.id} (or is excluded).`);
  process.exit(2);
}

const folder = path.resolve(values.folder.replace(/^~/, os.homedir()));
const runtime = await createRuntime({
  harness,
  engine,
  folder,
  gitdir: path.join(os.homedir(), ".humanharness", "dev", "history", harness.id),
  language: values.language as Language,
});

const turn = runtime.send(message, (e) => {
  if (e.type === "text") process.stdout.write(e.delta);
  else if (e.type === "paragraph") process.stdout.write("\n\n");
  else if (e.type === "activity" && e.state === "start") process.stdout.write(`\n  · ${e.kind}: ${e.detail}\n`);
  else if (e.type === "block") process.stdout.write(`\n  [${e.name}] ${JSON.stringify(e.data)}\n`);
  else if (e.type === "limits") {
    const windows = e.windows.map((w) => `${w.kind} ${Math.round(w.utilization * 100)}%${w.kind === "five_hour" ? ` (resets ${new Date(w.resetsAt).toLocaleTimeString()})` : ""}`);
    process.stdout.write(`\n  [limits] ${windows.join(" · ")}\n`);
  } else if (e.type === "usage") process.stdout.write(`\n  [usage] in ${e.inputTokens} · out ${e.outputTokens} · cache read ${e.cacheReadTokens}\n`);
  else if (e.type === "done") process.stdout.write(e.ok ? "\n\n✓ done\n" : `\n\n✗ ${e.error.code}${e.error.detail ? `: ${e.error.detail}` : ""}\n`);
});
process.on("SIGINT", () => turn.cancel());
await turn.done;
console.log("History:", (await runtime.history.list(3)).map((h) => h.message).join(" ← "));
await runtime.close();
