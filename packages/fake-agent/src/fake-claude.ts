// Stand-in for `claude -p ... --output-format stream-json`. Reads its script from HH_FAKE_SCRIPT
// and records its argv in HH_FAKE_ARGS so tests can assert on the flags the runtime passed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callMcpTool } from "./mcp-call";
import type { ClaudeScript } from "./script";

const argv = process.argv.slice(2);
if (process.env.HH_FAKE_ARGS) writeFileSync(process.env.HH_FAKE_ARGS, JSON.stringify(argv));
const script = JSON.parse(readFileSync(process.env.HH_FAKE_SCRIPT!, "utf8")) as ClaudeScript;
const mcpIndex = argv.indexOf("--mcp-config");
const mcpConfig = mcpIndex >= 0 ? (JSON.parse(argv[mcpIndex + 1]) as { mcpServers: Record<string, any> }) : { mcpServers: {} };

for (const step of script.steps) {
  if ("line" in step) process.stdout.write(JSON.stringify(step.line) + "\n");
  else if ("sleep" in step) await new Promise((r) => setTimeout(r, step.sleep));
  else if ("write" in step) {
    mkdirSync(path.dirname(path.resolve(step.write.path)), { recursive: true });
    writeFileSync(path.resolve(step.write.path), step.write.content);
  } else if ("mcp" in step) {
    const s = mcpConfig.mcpServers[step.mcp.server];
    await callMcpTool({ command: s.command, args: s.args ?? [], env: s.env ?? {} }, step.mcp.tool, step.mcp.args);
  }
}
if (script.stderr) process.stderr.write(script.stderr);
process.exit(script.exitCode ?? 0);
