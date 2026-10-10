// Stand-in for `claude -p ... --output-format stream-json`. Reads its script from HH_FAKE_SCRIPT
// and records its argv in HH_FAKE_ARGS so tests can assert on the flags the runtime passed.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callMcpTool } from "./mcp-call";
import type { ClaudeScript } from "./script";

const argv = process.argv.slice(2);
if (process.env.HH_FAKE_ARGS) writeFileSync(process.env.HH_FAKE_ARGS, JSON.stringify(argv));
if (process.env.HH_FAKE_STDIN) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  writeFileSync(process.env.HH_FAKE_STDIN, input);
}
const script = JSON.parse(readFileSync(process.env.HH_FAKE_SCRIPT!, "utf8")) as ClaudeScript;
const mcpIndex = argv.indexOf("--mcp-config");
const mcpConfig = mcpIndex >= 0 ? (JSON.parse(argv[mcpIndex + 1]) as { mcpServers: Record<string, any> }) : { mcpServers: {} };

if (script.failOnResume && argv.includes("--resume")) {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: script.failOnResume }) + "\n");
  process.exit(1);
}

for (const step of script.steps) {
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
