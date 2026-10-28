import type { FileRefusal, FileRestorePrompt, FileRestoreResult } from "@humanharness/ui/client";

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const answer = (v: unknown): { ok: true; prompt?: FileRestorePrompt } | { ok: false; reason: FileRefusal } => {
  if (typeof v === "object" && v !== null && "ok" in v) return v as { ok: true; prompt?: FileRestorePrompt } | { ok: false; reason: FileRefusal };
  return { ok: false, reason: "failed" };
};

/** `client.files.timeline` and `client.files.diff`: main's answer, or "failed" when the invoke rejects (data, never a throw). */
export function askFile<T>(invoke: Invoke, channel: "hh:fileTimeline" | "hh:fileDiff", ...args: unknown[]): Promise<T | { ok: false; reason: "failed" }> {
  return invoke(channel, ...args).then(
    (v) => v as T,
    () => ({ ok: false as const, reason: "failed" as const }),
  );
}

/**
 * `client.files.restore` (file-timeline spec §5, §6.3): main's prompt, then the core's confirmation, then the go-back.
 * Without a confirmer (no core chat on screen) or on any failure to ask, nothing goes back: "cancelled".
 */
export async function restoreFlow(
  invoke: Invoke,
  confirm: ((prompt: FileRestorePrompt) => Promise<boolean>) | null,
  file: string,
  commit: string,
): Promise<FileRestoreResult> {
  // A rejected invoke (no handler, a closing window) is a failure like any other: data, never a throw.
  const ask = (channel: string) => invoke(channel, file, commit).then(answer, () => answer(null));
  const asked = await ask("hh:fileRestorePrompt");
  if (!asked.ok) return { refused: asked.reason };
  if (!confirm || !asked.prompt) return "cancelled";
  let yes = false;
  try {
    yes = (await confirm(asked.prompt)) === true;
  } catch {
    yes = false;
  }
  if (!yes) return "cancelled";
  const done = await ask("hh:fileRestore");
  return done.ok ? "restored" : { refused: done.reason };
}
