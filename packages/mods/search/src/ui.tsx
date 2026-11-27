import { defineMod } from "@humanharness/mod-sdk";
import type { ModBlockProps } from "@humanharness/ui";
import { SearchHost } from "./SearchHost";

/**
 * The ⌘K palette as the `search/palette` overlay block (the default layout places it): it listens for ⌘K, for
 * `client.search.open()` and for the window's own opens, and shows the palette over the whole screen.
 */
export function PaletteBlock({ app }: ModBlockProps) {
  return <SearchHost client={app.client} state={app.state} openScope={app.openScope} onIntent={app.nav.open} chatContext={app.chatContext} />;
}

export default defineMod({
  id: "search",
  ui: (ctx) => {
    ctx.block("palette", PaletteBlock);
  },
});
