import { createHmac, timingSafeEqual } from "node:crypto";
import type { EngineApproval } from "@humanharness/workspace";

// A scope's engine approval is signed by the app (hatches spec §5.3, E1, E10). `.harness/scopes.json` sits in the
// folder the agent can write and the hash has no secret, so without a tag the agent could approve its own config.
// The key is the links' one (`linkedSecret` in linked-ipc.ts). An old signed approval can be pasted back: each tag
// carries the scope's epoch (epochs.ts, outside the folder), which a revoke bumps, so one made before a revoke stops
// verifying. Epoch 0 signs as before epochs existed (`hh-engine-v1`), so approvals made then keep working.

/** HMAC-SHA256 with the app's key over one unambiguous encoding of `parts`, hex. */
const hmac = (secret: Buffer, parts: string[]): string => createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex");

/** Whether `got` is `want`, in constant time. */
function same(want: string, got: unknown): boolean {
  if (typeof got !== "string") return false;
  const w = Buffer.from(want);
  const g = Buffer.from(got);
  return w.length === g.length && timingSafeEqual(w, g);
}

/** HMAC-SHA256 with the app's key over profile ("" without profiles), scope, the scope's epoch, hash and time. */
export function engineApprovalTag(profile: string, scope: string, a: { hash: string; at: string }, secret: Buffer, epoch = 0): string {
  return hmac(secret, epoch === 0 ? ["hh-engine-v1", profile, scope, a.hash, a.at] : ["hh-engine-v2", profile, scope, String(epoch), a.hash, a.at]);
}

/**
 * Whether `a` carries the tag the app made for it in `profile`/`scope` at the scope's `epoch`. No approval, no key or
 * no epoch (a damaged record): not valid.
 */
export function engineApprovalValid(a: EngineApproval | undefined, profile: string, scope: string, secret: Buffer | null, epoch: number | null = 0): boolean {
  if (!a || !secret || epoch === null || typeof a.tag !== "string" || typeof a.hash !== "string" || typeof a.at !== "string") return false;
  return same(engineApprovalTag(profile, scope, a, secret, epoch), a.tag);
}

// A task's pin (Decision 2) sits in tasks.json, which the agent can write too: a task keeps a hash the scope no longer
// approves only with the app's tag over that task and hash.

/** The tag of task `task`'s pin to `hash` in `profile`/`scope` at the scope's `epoch` (a revoke ends every pin). */
export function enginePinTag(profile: string, scope: string, task: string, hash: string, secret: Buffer, epoch = 0): string {
  return hmac(secret, epoch === 0 ? ["hh-engine-pin-v1", profile, scope, task, hash] : ["hh-engine-pin-v2", profile, scope, String(epoch), task, hash]);
}

/** Whether `tag` is the app's for task `task`'s pin to `hash` in `profile`/`scope` at `epoch`. No tag, key or epoch: not valid. */
export function enginePinValid(tag: unknown, profile: string, scope: string, task: string, hash: string, secret: Buffer | null, epoch: number | null = 0): boolean {
  return secret !== null && epoch !== null && same(enginePinTag(profile, scope, task, hash, secret, epoch), tag);
}
