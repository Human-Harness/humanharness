import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createToolsServer } from "./tools-server";

try {
  const catalogue = process.env.HH_TOOLS;
  const rpcPath = process.env.HH_RPC;
  const token = process.env.HH_RPC_TOKEN;
  if (!catalogue || !rpcPath || !token) {
    console.error("HH_TOOLS, HH_RPC and HH_RPC_TOKEN are required");
    process.exit(2);
  }
  const server = await createToolsServer(catalogue, { path: rpcPath, token });
  await server.connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
