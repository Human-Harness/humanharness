import type { LayoutView } from "@humanharness/protocol";
import type { ModsSettings } from "./config";
import { pickLayout } from "./layout";
import { readModJson } from "./resolve";

/** The key fields of Electron's `before-input-event` input the matcher reads. */
export interface KeyInput {
  type: string;
  key: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
}

/** ⌘⌥⇧Esc on macOS, Ctrl+Alt+Shift+Esc elsewhere: the escape hatch, checked before any other shortcut. */
export function isEscapeHatch(input: KeyInput, platform: NodeJS.Platform): boolean {
  if (input.type !== "keyDown" || input.key !== "Escape" || !input.alt || !input.shift) return false;
  return platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
}

/** The app starts in safe mode: a `--safe` argument, or `HH_SAFE=1` (`humanharness dev --safe`). */
export function safeAtStart(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): boolean {
  return argv.includes("--safe") || env.HH_SAFE === "1";
}

/**
 * Safe mode: the home folder's layout pick goes (the harness's layout shows) and every local mod, from the user layer
 * or a folder the person added, is set off in config.json; core and harness mods stay as they are. `folders` are the
 * local mods' folders; one whose mod.json can't be read is skipped (the host never runs it). The caller restarts the
 * host, sends the layout and the window shows the notice (`mods.safeNotice` in the locales).
 */
export async function enterSafeMode(o: {
  home: string;
  folders: readonly string[];
  mods: { load(): Promise<ModsSettings | undefined>; save(m: ModsSettings | undefined): Promise<void> };
}): Promise<{ layout: LayoutView; off: string[] }> {
  const layout = await pickLayout(o.home, null);
  const off: string[] = [];
  for (const dir of o.folders) {
    const json = await readModJson(dir).catch(() => null);
    if (json && !off.includes(json.id)) off.push(json.id);
  }
  if (off.length > 0) {
    const m = await o.mods.load();
    await o.mods.save({ ...m, on: { ...m?.on, ...Object.fromEntries(off.map((id) => [id, false])) } });
  }
  return { layout, off };
}
