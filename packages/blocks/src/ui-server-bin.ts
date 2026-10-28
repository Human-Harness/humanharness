import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createUiServer } from "./ui-server";

try {
  const harnessConfig = process.env.HH_HARNESS;
  const bridgePath = process.env.HH_BRIDGE;
  const token = process.env.HH_BRIDGE_TOKEN;
  if (!harnessConfig || !bridgePath || !token) {
    console.error("HH_HARNESS, HH_BRIDGE and HH_BRIDGE_TOKEN are required");
    process.exit(2);
  }
  const reviewPath = process.env.HH_REVIEW_RPC;
  const reviewToken = process.env.HH_REVIEW_RPC_TOKEN;
  const review = reviewPath && reviewToken ? { path: reviewPath, token: reviewToken } : undefined;
  const server = await createUiServer(harnessConfig, { path: bridgePath, token }, review);
  await server.connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
