import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MOD_ID, modJsonSchema } from "@humanharness/mod-sdk";
import type { ModReview, ModsView } from "@humanharness/protocol";
import type { InvokeChannel } from "@humanharness/protocol/channels";

const TOKEN = /^[0-9a-f]{32}$/;
/**
 * `hh:modReviewUser` is not in the protocol's channel table yet: the window's side (preload, Settings › Mods) lands in
 * the next step of 0b2, with its entry there. Until then index.ts registers it through the same `handle`.
 */
export type ModsChannel = InvokeChannel | "hh:modReviewUser";
type Handle = (channel: ModsChannel, fn: (...args: never[]) => unknown) => void;

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
  /** A user-layer mod the person hasn't reviewed yet (not in `mods.trusted`): turning it on needs a review token. */
  needsReview(id: string): Promise<boolean>;
  /** What the warning shows for a user-layer mod; null when no mod in the home folder has this id. */
  reviewUser(id: string): Promise<ModReview | null>;
  /** The person accepted the warning: records the id in `mods.trusted` and turns the mod on. */
  trustUser(id: string): Promise<void>;
}

const takenProblem = (id: string) => `A mod with the id "${id}" is already in this app`;
const validId = (id: unknown): id is string => typeof id === "string" && MOD_ID.test(id);

/** Settings › Mods (minimal-core spec §4, §6). Adding a local mod mirrors Settings › Plugins: the renderer never sends a path. */
export function registerModsIpc(handle: Handle, d: ModsIpcDeps): void {
  const pending = new Map<string, { kind: "folder"; folder: string; id: string } | { kind: "user"; id: string }>();
  const issue = (review: { kind: "folder"; folder: string; id: string } | { kind: "user"; id: string }) => {
    const token = randomBytes(16).toString("hex");
    pending.set(token, review);
    return token;
  };
  handle("hh:mods", () => d.view());
  handle("hh:modSet", async (id: unknown, on: unknown) => {
    if (!validId(id) || typeof on !== "boolean") throw new Error("Invalid mod change");
    // A mod from the home folder runs code nobody shipped: the first time, only through the warning (D2).
    if (on && (await d.needsReview(id))) throw new Error("This mod needs your review first");
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
    const token = issue({ kind: "folder", folder, id: json.id });
    return { review: { id: json.id, name: json.name, version: json.version, folder }, token };
  });
  handle("hh:modReviewUser", async (id: unknown): Promise<{ review: ModReview; token: string } | { problem: string }> => {
    if (!validId(id)) throw new Error("Invalid mod id");
    const review = await d.reviewUser(id);
    if (!review) return { problem: `No mod in the app's home folder has the id "${id}"` };
    return { review, token: issue({ kind: "user", id }) };
  });
  handle("hh:modAddLocal", async (token: unknown) => {
    if (typeof token !== "string" || !TOKEN.test(token)) throw new Error("Unknown review");
    const review = pending.get(token);
    if (review === undefined) throw new Error("Unknown review");
    pending.delete(token);
    if (review.kind === "user") {
      // Checked again: the folder may have gone, or changed its id, since the review.
      if (!(await d.reviewUser(review.id))) throw new Error(`No mod in the app's home folder has the id "${review.id}"`);
      await d.trustUser(review.id);
      return d.view();
    }
    // Checked again: another add may have taken the id since the review.
    if (d.taken(review.id)) throw new Error(takenProblem(review.id));
    await d.addLocal(review.folder);
    return d.view();
  });
  handle("hh:modRemoveLocal", async (id: unknown) => {
    if (!validId(id) || !d.isLocal(id)) throw new Error("Not a local mod");
    await d.removeLocal(id);
    return d.view();
  });
}
