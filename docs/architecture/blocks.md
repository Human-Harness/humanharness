# Blocks

Blocks let the agent show structured pieces of interface instead of loose text.

- A harness declares blocks in its manifest with `defineBlock`. A visible block becomes a `show_<name>` tool and is drawn by the React component the harness registers under that name; a state-only block becomes `update_<name>` and feeds the side panel.
- Every harness also gets two core blocks (`packages/harness-sdk/src/core-blocks.ts`): `choices` (visible, `show_choices`: up to four ways to continue, which move the task along) and `save_note` (hidden, tool `save_note`: the summary that closes a task; the app writes it, never the agent).
- `packages/blocks/src/ui-server.ts` is an MCP server with one tool per block. Its arguments are checked against the block's schema, and valid calls go to the runtime through the bridge (`packages/blocks/src/bridge.ts`): a socket in a private folder, with a random token per runtime.
- The managed section of `AGENTS.md` lists every tool with its description, an example and its JSON schema (`packages/workspace/src/instructions.ts`).
- The runtime turns each forwarded call into a `block` event. The screen draws it with the registered component (`Blocks` in `packages/ui/src/Message.tsx`); `choices` is drawn by the core (`packages/ui/src/ChoicesBlock.tsx`), and a pick goes back to the main process through `client.choose`.
- Calls to our own tools never show as activity: Claude's `mcp__ui__*` and Codex's `ui` server calls are hidden.
