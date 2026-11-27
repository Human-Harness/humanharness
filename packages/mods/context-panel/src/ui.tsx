import { defineMod } from "@humanharness/mod-sdk";
import type { ContextApi } from "@humanharness/protocol";
import type { ModBlockProps } from "@humanharness/ui";
import type { ComponentProps } from "react";
import { contextApi } from "./api";
import { ContextPanel } from "./ContextPanel";

/** The panel as the `context-panel/panel` block: ChatView draws it in the reader's slot with `ContextPanel`'s own props. */
export function PanelBlock({ props, app, context }: ModBlockProps & { context: ContextApi }) {
  return <ContextPanel client={app.client} context={context} {...(props as Omit<ComponentProps<typeof ContextPanel>, "client" | "context">)} />;
}

export default defineMod({
  id: "context-panel",
  ui: (ctx) => {
    // The panel's calls go to this mod's own main (`ipc`), and its refreshes come back as a push.
    const context = contextApi(ctx);
    ctx.block("panel", (p: ModBlockProps) => <PanelBlock {...p} context={context} />);
  },
});
