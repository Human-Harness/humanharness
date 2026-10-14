import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface StdioServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export async function callMcpTool(server: StdioServer, tool: string, args: Record<string, unknown>): Promise<Awaited<ReturnType<Client["callTool"]>>> {
  const client = new Client({ name: "fake-agent", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...(process.env as Record<string, string>), ...server.env },
    }),
  );
  try {
    return await client.callTool({ name: tool, arguments: args });
  } finally {
    await client.close();
  }
}
