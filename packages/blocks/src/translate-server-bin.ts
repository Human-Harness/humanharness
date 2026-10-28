import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTranslateServer } from "./translate-server";

try {
  const rpcPath = process.env.HH_RPC;
  const token = process.env.HH_RPC_TOKEN;
  if (!rpcPath || !token) {
    console.error("HH_RPC and HH_RPC_TOKEN are required");
    process.exit(2);
  }
  await createTranslateServer({ path: rpcPath, token }).connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
