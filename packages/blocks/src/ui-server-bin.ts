import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createUiServer } from "./ui-server";

const harnessConfig = process.env.HH_HARNESS;
const bridgePath = process.env.HH_BRIDGE;
if (!harnessConfig || !bridgePath) {
  console.error("HH_HARNESS and HH_BRIDGE are required");
  process.exit(2);
}
const server = await createUiServer(harnessConfig, bridgePath);
await server.connect(new StdioServerTransport());
