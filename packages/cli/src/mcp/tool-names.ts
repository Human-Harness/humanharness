import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server";

/**
 * The names of the tools `humanharness mcp` registers, asked of a server in process. The home folder's manual
 * (`AGENTS.md`) is tested against it, so a new tool can't ship undocumented.
 */
export async function registeredToolNames(): Promise<string[]> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ mode: "app", home: "/nonexistent-home" });
  await server.connect(serverSide);
  const client = new Client({ name: "tool-names", version: "0.0.0" });
  await client.connect(clientSide);
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } finally {
    await client.close();
  }
}
