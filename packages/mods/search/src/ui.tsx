import { defineMod } from "@humanharness/mod-sdk";
import type { ModBlockProps } from "@humanharness/ui";
import { type SearchApi, searchApi } from "./api";
import { SearchHost } from "./SearchHost";

/**
 * The ⌘K palette as the `search/palette` overlay block (the default layout places it): it listens for ⌘K, for
 * `client.search.open()` and for the window's own opens, and shows the palette over the whole screen.
 */
export function PaletteBlock({ app, api }: ModBlockProps & { api: SearchApi }) {
  return <SearchHost client={app.client} api={api} state={app.state} openScope={app.openScope} onIntent={app.nav.open} chatContext={app.chatContext} />;
}

export default defineMod({
  id: "search",
  ui: (ctx) => {
    // The palette's calls go to this mod's own main (`ipc`), and the index's progress comes back as a push.
    const api = searchApi(ctx);
    ctx.block("palette", (p: ModBlockProps) => <PaletteBlock {...p} api={api} />);
  },
});
