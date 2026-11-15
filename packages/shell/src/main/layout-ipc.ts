import { pickLayout } from "./mods/layout";

export interface LayoutIpcDeps {
  /** The app's home folder (its layouts/ and settings.json). */
  home(): string;
}

/** The person's layout pick (0b2): written in the home folder's settings.json; the watcher redraws the window too. */
export function layoutIpc(d: LayoutIpcDeps) {
  return {
    "hh:layoutPick": (name: unknown) => {
      if (name !== null && typeof name !== "string") throw new Error("Invalid layout name");
      return pickLayout(d.home(), name);
    },
  };
}
