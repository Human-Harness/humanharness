// Stand-in for `claude -p ... --output-format stream-json`. Reads its script from HH_FAKE_SCRIPT,
// records its argv in HH_FAKE_ARGS, the prompt in HH_FAKE_STDIN, and appends {argv, prompt} for
// every run to HH_FAKE_PROMPTS, so tests can assert on the flags and messages the runtime sent.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callMcpTool } from "./mcp-call";
import type { ClaudeScript } from "./script";

const argv = process.argv.slice(2);
if (process.env.HH_FAKE_ARGS) writeFileSync(process.env.HH_FAKE_ARGS, JSON.stringify(argv));
const script = JSON.parse(readFileSync(process.env.HH_FAKE_SCRIPT!, "utf8")) as ClaudeScript;
let input = "";
if (process.env.HH_FAKE_STDIN || process.env.HH_FAKE_PROMPTS || script.turns) {
  for await (const chunk of process.stdin) input += chunk;
  if (process.env.HH_FAKE_STDIN) writeFileSync(process.env.HH_FAKE_STDIN, input);
  if (process.env.HH_FAKE_PROMPTS) appendFileSync(process.env.HH_FAKE_PROMPTS, JSON.stringify({ argv, prompt: input }) + "\n");
}
const mcpIndex = argv.indexOf("--mcp-config");
const mcpConfig = mcpIndex >= 0 ? (JSON.parse(argv[mcpIndex + 1]) as { mcpServers: Record<string, any> }) : { mcpServers: {} };

if (script.failOnResume && argv.includes("--resume")) {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: script.failOnResume }) + "\n");
  process.exit(1);
}

const modelFlag = argv.indexOf("--model");
const model = modelFlag >= 0 ? argv[modelFlag + 1] : undefined;
if (model && script.failModels?.includes(model)) {
  // What claude 2.1.296 prints for a model the plan doesn't include (spike S5).
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "fake-session" }) + "\n");
  process.stdout.write(
    JSON.stringify({ type: "assistant", parent_tool_use_id: null, error: "model_not_found", message: { content: [{ type: "text", text: `There's an issue with the selected model (${model}).` }] } }) + "\n",
  );
  process.stdout.write(
    JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 404, terminal_reason: "api_error", result: `There's an issue with the selected model (${model}).` }) + "\n",
  );
  process.exit(1);
}

const steps = script.turns?.find((t) => new RegExp(t.match).test(input))?.steps ?? script.steps;
for (const step of steps) {
  if ("line" in step) process.stdout.write(JSON.stringify(step.line) + "\n");
  else if ("raw" in step) process.stdout.write(step.raw);
  else if ("sleep" in step) await new Promise((r) => setTimeout(r, step.sleep));
  else if ("spawnStubborn" in step) {
    spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: ["ignore", "ignore", "inherit"] });
  } else if ("signal" in step) {
    process.kill(process.pid, step.signal);
    await new Promise((r) => setTimeout(r, 5000));
  } else if ("write" in step) {
    mkdirSync(path.dirname(path.resolve(step.write.path)), { recursive: true });
    writeFileSync(path.resolve(step.write.path), step.write.content);
  } else if ("mcp" in step) {
    const s = mcpConfig.mcpServers[step.mcp.server];
    if (!s) throw new Error(`fake-claude: mcp step names unknown server "${step.mcp.server}" (configured: ${Object.keys(mcpConfig.mcpServers).join(", ") || "none"})`);
    await callMcpTool({ command: s.command, args: s.args ?? [], env: s.env ?? {} }, step.mcp.tool, step.mcp.args);
  }
}
if (script.stderr) process.stderr.write(script.stderr);
process.exitCode = script.exitCode ?? 0;
