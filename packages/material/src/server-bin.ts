import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMaterialServer } from "./server";
import "./stages";

try {
  const rpcPath = process.env.HH_RPC;
  const token = process.env.HH_RPC_TOKEN;
  const mode = process.env.HH_MATERIAL_MODE === "system" ? "system" : "person";
  const tools = (process.env.HH_MATERIAL_TOOLS ?? "").split(",").filter(Boolean);
  if (!rpcPath || !token) {
    console.error("HH_RPC and HH_RPC_TOKEN are required");
    process.exit(2);
  }
  await createMaterialServer({ path: rpcPath, token }, mode, tools).connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
