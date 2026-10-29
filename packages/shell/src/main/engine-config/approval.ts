import { createHmac, timingSafeEqual } from "node:crypto";
import type { EngineApproval } from "@humanharness/workspace";

// A scope's engine approval is signed by the app (hatches spec §5.3, E1, E10). `.harness/scopes.json` sits in the
// folder the agent can write and the hash has no secret, so without a tag the agent could approve its own config.
// The key is the links' one (`linkedSecret` in linked-ipc.ts). An old signed approval can be pasted back; it
// only restores a config the person approved once, so no nonce is kept.

/** HMAC-SHA256 with the app's key over one unambiguous encoding of `parts`, hex. */
const hmac = (secret: Buffer, parts: string[]): string => createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex");

/** Whether `got` is `want`, in constant time. */
function same(want: string, got: unknown): boolean {
  if (typeof got !== "string") return false;
  const w = Buffer.from(want);
  const g = Buffer.from(got);
  return w.length === g.length && timingSafeEqual(w, g);
}

/** HMAC-SHA256 with the app's key over profile ("" without profiles), scope, hash and time. */
export function engineApprovalTag(profile: string, scope: string, a: { hash: string; at: string }, secret: Buffer): string {
  return hmac(secret, ["hh-engine-v1", profile, scope, a.hash, a.at]);
}

/** Whether `a` carries the tag the app made for it in `profile`/`scope`. No approval or no key: not valid. */
export function engineApprovalValid(a: EngineApproval | undefined, profile: string, scope: string, secret: Buffer | null): boolean {
  if (!a || !secret || typeof a.tag !== "string" || typeof a.hash !== "string" || typeof a.at !== "string") return false;
  return same(engineApprovalTag(profile, scope, a, secret), a.tag);
}

// A task's pin (Decision 2) sits in tasks.json, which the agent can write too: a task keeps a hash the scope no longer
// approves only with the app's tag over that task and hash.

/** The tag of task `task`'s pin to `hash` in `profile`/`scope`. */
export function enginePinTag(profile: string, scope: string, task: string, hash: string, secret: Buffer): string {
  return hmac(secret, ["hh-engine-pin-v1", profile, scope, task, hash]);
}

/** Whether `tag` is the app's for task `task`'s pin to `hash` in `profile`/`scope`. No tag or no key: not valid. */
export function enginePinValid(tag: unknown, profile: string, scope: string, task: string, hash: string, secret: Buffer | null): boolean {
  return secret !== null && same(enginePinTag(profile, scope, task, hash, secret), tag);
}
