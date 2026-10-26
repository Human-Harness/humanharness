import { z } from "zod";
import { type Tier, defineBlock, defineHarness } from "@humanharness/harness-sdk";

const diagram = defineBlock({
  description:
    "Shows a flow diagram: 2 to 7 boxes (nodes) in order, joined by arrows, and the edges that don't join neighbours listed under them. Use it at most once per answer, when a flow helps.",
  visible: true,
  schema: z.object({
    title: z.string().min(1).max(80).optional(),
    nodes: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(40), detail: z.string().max(60).optional() })).min(2).max(7),
    edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1), label: z.string().max(120).optional() })).max(10),
  }),
  example: {
    title: "A turn",
    nodes: [
      { id: "ui", label: "Screen", detail: "ui" },
      { id: "shell", label: "Main process", detail: "shell · IPC" },
    ],
    edges: [{ from: "ui", to: "shell" }, { from: "shell", to: "ui", label: "comes back as events" }],
  },
});

const files = defineBlock({
  description:
    "Lists the files where what you explained lives, each with a one-line role, so the person can open and check them. Paths are relative to the reference folder.",
  visible: true,
  schema: z.object({ files: z.array(z.object({ path: z.string().min(1).max(300), role: z.string().min(1).max(120) })).min(1).max(8) }),
  example: { files: [{ path: "packages/runtime/src/runtime.ts", role: "picks the transport and emits events" }] },
});

const topic = (id: string, label: string, description: string, tier: Tier = "standard") => ({
  label,
  description,
  prompt: `./agent/tasks/${id}.md`,
  cost: "medium" as const,
  tier,
});

export default defineHarness({
  id: "demo",
  name: "Demo",
  core: "^0.1.0",
  engines: ["claude", "codex"],
  folder: {
    suggested: "Documents/Human Harness Demo",
    seed: "./agent/seed",
    references: [{ id: "source", label: "Human Harness source", default: "app-source" }],
  },
  instructions: "./agent/AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: { diagram, files },
  actions: {
    manifest: topic("manifest", "The manifest", "What a harness declares in harness.config.ts and what the core does with it."),
    engines: topic("engines", "Engines", "How Claude or Codex is detected, installed and connected without API keys."),
    turn: topic("turn", "A turn end to end", "From typing to the answer on screen.", "deep"),
    blocks: topic("blocks", "Blocks", "How the AI shows cards and options instead of loose text."),
    context: topic("context", "Context and memory", "What goes to the engine each turn and what is kept.", "deep"),
    history: topic("history", "Folder and history", "How every change is recorded and how to go back."),
  },
  path: ["manifest", "engines", "turn", "blocks", "context", "history"],
  questions: { tier: "light" },
  tagline: "How Human Harness works",
  tone: "clear and friendly, for developers; short sentences",
  author: "Marco Zanger",
});
