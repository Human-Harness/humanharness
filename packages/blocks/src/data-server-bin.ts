import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDataServer } from "./data-server";

try {
  const harnessConfig = process.env.HH_HARNESS;
  const rpcPath = process.env.HH_RPC;
  const token = process.env.HH_RPC_TOKEN;
  if (!harnessConfig || !rpcPath || !token) {
    console.error("HH_HARNESS, HH_RPC and HH_RPC_TOKEN are required");
    process.exit(2);
  }
  const server = await createDataServer(harnessConfig, { path: rpcPath, token });
  await server.connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
