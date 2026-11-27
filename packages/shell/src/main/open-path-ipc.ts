import type { AppConfig, ConfiguredApp } from "@humanharness/protocol";
import { openIfStillSafe, openRoots, openableFile, revealIfStillSafe, revealableFile } from "./open-path";
import type { ResolvedReference } from "./references";

export interface OpenPathIpcDeps {
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  workReferences(c: AppConfig, base: string): Promise<ResolvedReference[]>;
  shell: { openPath(p: string): Promise<string>; showItemInFolder(p: string): void };
}

/** Opens a file, or shows it in Finder, inside the folder or a reference folder (`hh:openPath`, `hh:revealPath`). */
export function openPathIpc(d: OpenPathIpcDeps) {
  const { validConfig, baseOf, workReferences, shell } = d;
  return {
    "hh:openPath": async (file: unknown) => {
      const c = await validConfig();
      if (!c) return false;
      const roots = openRoots(baseOf(c), (await workReferences(c, baseOf(c))).map((r) => r.path));
      const target = await openableFile(file, roots);
      if (!target) return false;
      // Checked again right before opening: the file or a folder above it may have been swapped for a link meanwhile.
      return openIfStillSafe(target, roots, (p) => shell.openPath(p));
    },
    // Shows a file in Finder (it never opens it): any kind of file, with the same checks as hh:openPath.
    "hh:revealPath": async (file: unknown) => {
      const c = await validConfig();
      if (!c) return false;
      const roots = openRoots(baseOf(c), (await workReferences(c, baseOf(c))).map((r) => r.path));
      const target = await revealableFile(file, roots);
      if (!target) return false;
      return revealIfStillSafe(target, roots, (p) => shell.showItemInFolder(p));
    },
  };
}
