import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MOD_ID, modJsonSchema } from "@humanharness/mod-sdk";
import type { ModReview, ModsView } from "@humanharness/protocol";
import type { InvokeChannel } from "@humanharness/protocol/channels";

const TOKEN = /^[0-9a-f]{32}$/;
type Handle = (channel: InvokeChannel, fn: (...args: never[]) => unknown) => void;

export interface ModsIpcDeps {
  view(): Promise<ModsView>;
  set(id: string, on: boolean): Promise<void>;
  /** Main's folder dialog; null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** Saves the folder in config.json `mods.local`, resolves it, and turns it on (the person already confirmed). */
  addLocal(folder: string): Promise<void>;
  removeLocal(id: string): Promise<void>;
  isLocal(id: string): boolean;
  /** Some mod this app already resolved (declared, core or local) has this id: a local folder can't take it. */
  taken(id: string): boolean;
}

const takenProblem = (id: string) => `A mod with the id "${id}" is already in this app`;

/** Settings › Mods (minimal-core spec §4, §6). Adding a local mod mirrors Settings › Plugins: the renderer never sends a path. */
export function registerModsIpc(handle: Handle, d: ModsIpcDeps): void {
  const pending = new Map<string, { folder: string; id: string }>();
  handle("hh:mods", () => d.view());
  handle("hh:modSet", async (id: unknown, on: unknown) => {
    if (typeof id !== "string" || !MOD_ID.test(id) || typeof on !== "boolean") throw new Error("Invalid mod change");
    await d.set(id, on);
    return d.view();
  });
  handle("hh:modReviewLocal", async (): Promise<{ review: ModReview; token: string } | { problem: string } | null> => {
    const folder = await d.pickFolder();
    if (!folder) return null;
    let json;
    try {
      json = modJsonSchema.parse(JSON.parse(await fs.readFile(path.join(folder, "mod.json"), "utf8")));
    } catch (err) {
      return { problem: `This folder has no valid mod.json (${err instanceof Error ? err.message.slice(0, 200) : "unreadable"})` };
    }
    // A taken id would turn the other mod on and leave this folder stuck as a problem: refused before any token.
    if (d.taken(json.id)) return { problem: takenProblem(json.id) };
    const token = randomBytes(16).toString("hex");
    pending.set(token, { folder, id: json.id });
    return { review: { id: json.id, name: json.name, version: json.version, folder }, token };
  });
  handle("hh:modAddLocal", async (token: unknown) => {
    if (typeof token !== "string" || !TOKEN.test(token)) throw new Error("Unknown review");
    const review = pending.get(token);
    if (review === undefined) throw new Error("Unknown review");
    pending.delete(token);
    // Checked again: another add may have taken the id since the review.
    if (d.taken(review.id)) throw new Error(takenProblem(review.id));
    await d.addLocal(review.folder);
    return d.view();
  });
  handle("hh:modRemoveLocal", async (id: unknown) => {
    if (typeof id !== "string" || !MOD_ID.test(id) || !d.isLocal(id)) throw new Error("Not a local mod");
    await d.removeLocal(id);
    return d.view();
  });
}
