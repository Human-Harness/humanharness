import { JOB_ID } from "@humanharness/harness-sdk";
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
  // A recipe's AI step (tools spec §7.1): empty is no step; anything else must be a job id.
  const step = process.env.HH_STEP ?? "";
  if (step !== "" && !JOB_ID.test(step)) {
    console.error("HH_STEP is not a job id");
    process.exit(1);
  }
  const server = await createUiServer(harnessConfig, { path: bridgePath, token }, { job: process.env.HH_JOB === "1", ...(review ? { review } : {}), ...(step ? { step } : {}) });
  await server.connect(new StdioServerTransport());
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
