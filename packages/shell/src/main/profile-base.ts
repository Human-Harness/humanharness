import path from "node:path";
import { isProfileId } from "@humanharness/workspace";

/**
 * The folder every path under `.harness/` starts from (packages/workspace/src/layout.ts). Without profiles it is the
 * app's folder (profiles spec D4). With them it is the active profile's folder inside it (D2), or null while no
 * profile is active: then nothing under `.harness/` may be read or written.
 */
export function baseFor(c: { folder: string; profile?: string }, profiles: boolean): string | null {
  if (!profiles) return c.folder;
  return isProfileId(c.profile) ? path.join(c.folder, c.profile) : null;
}

/** The profile a base belongs to: its folder's name when it sits right inside `root`; null otherwise. */
export function profileOfBase(root: string, base: string): string | null {
  const name = path.basename(base);
  return path.dirname(base) === root && isProfileId(name) ? name : null;
}

/** `child` is `parent` or inside it (paths as given). */
export function isInsideFolder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}
