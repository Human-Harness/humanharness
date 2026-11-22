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
  /** A user-layer mod the person hasn't reviewed yet (not in `mods.trusted`): turning it on needs a review token. */
  needsReview(id: string): Promise<boolean>;
  /** What the warning shows for a user-layer mod; null when no mod in the home folder has this id. */
  reviewUser(id: string): Promise<ModReview | null>;
  /** The person accepted the warning: records the id in `mods.trusted` and turns the mod on. */
  trustUser(id: string): Promise<void>;
  /** A mod's ui calling its own main by name (`ModHost.call`); rejects when the mod is off or has no such name. */
  call?(id: string, name: string, payload: unknown): Promise<unknown>;
}

/** A mod's own channel name: never an app channel (`hh:…`), which has its own handler. */
const validName = (name: unknown): name is string => typeof name === "string" && name.length > 0 && name.length <= 128 && !name.startsWith("hh:");

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
  const reviewUser = async (id: unknown): Promise<{ review: ModReview; token: string } | { problem: string }> => {
    if (!validId(id)) throw new Error("Invalid mod id");
    const review = await d.reviewUser(id);
    if (!review) return { problem: `No mod in the app's home folder has the id "${id}"` };
    return { review, token: issue({ kind: "user", id }) };
  };
  handle("hh:mods", () => d.view());
  handle("hh:modSet", async (id: unknown, on: unknown) => {
    if (!validId(id) || typeof on !== "boolean") throw new Error("Invalid mod change");
    // A mod from the home folder runs code nobody shipped: the first time, only through the warning (D2).
    if (on && (await d.needsReview(id))) throw new Error("This mod needs your review first");
    await d.set(id, on);
    return d.view();
  });
  // With an id: a mod already in the home folder's `mods/` (0b2), reviewed through the same warning and token; no dialog.
  handle("hh:modReviewLocal", async (id?: unknown): Promise<{ review: ModReview; token: string } | { problem: string } | null> => {
    if (id !== undefined) return reviewUser(id);
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
  handle("hh:modCall", async (id: unknown, name: unknown, payload: unknown) => {
    if (!validId(id) || !validName(name)) throw new Error("Invalid mod call");
    if (!d.call) throw new Error(`Mod "${id}" is off`);
    return d.call(id, name, payload);
  });
  handle("hh:modRemoveLocal", async (id: unknown) => {
    if (!validId(id) || !d.isLocal(id)) throw new Error("Not a local mod");
    await d.removeLocal(id);
    return d.view();
  });
}

/**
 * App channels a core mod handles (mods-1a): each declared name is registered once, at startup like every other
 * channel, and each call goes to the mod that is on and handles it (`ModHost.channel`), arguments as an array.
 */
export function registerModChannels(handle: Handle, names: readonly InvokeChannel[], host: () => { channel(name: string, args: unknown[]): Promise<unknown> } | null): void {
  for (const name of names) {
    handle(name, (async (...args: unknown[]) => {
      const h = host();
      if (!h) throw new Error(`No mod handles ${name}`);
      return h.channel(name, args);
    }) as never);
  }
}
