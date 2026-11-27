import { defineMod } from "@humanharness/mod-sdk";
import type { ModBlockProps } from "@humanharness/ui";
import type { ComponentProps } from "react";
import { ContextPanel } from "./ContextPanel";

/** The panel as the `context-panel/panel` block: ChatView draws it in the reader's slot with `ContextPanel`'s own props. */
export function PanelBlock({ props, app }: ModBlockProps) {
  return <ContextPanel client={app.client} {...(props as Omit<ComponentProps<typeof ContextPanel>, "client">)} />;
}

export default defineMod({
  id: "context-panel",
  ui: (ctx) => {
    ctx.block("panel", PanelBlock);
  },
});
