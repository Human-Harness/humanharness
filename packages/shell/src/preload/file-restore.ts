import type { FileRefusal, FileRestorePrompt, FileRestoreResult } from "@humanharness/ui/client";

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const answer = (v: unknown): { ok: true; prompt?: FileRestorePrompt } | { ok: false; reason: FileRefusal } => {
  if (typeof v === "object" && v !== null && "ok" in v) return v as { ok: true; prompt?: FileRestorePrompt } | { ok: false; reason: FileRefusal };
  return { ok: false, reason: "failed" };
};

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
  const asked = answer(await invoke("hh:fileRestorePrompt", file, commit));
  if (!asked.ok) return { refused: asked.reason };
  if (!confirm || !asked.prompt) return "cancelled";
  let yes = false;
  try {
    yes = (await confirm(asked.prompt)) === true;
  } catch {
    yes = false;
  }
  if (!yes) return "cancelled";
  const done = answer(await invoke("hh:fileRestore", file, commit));
  return done.ok ? "restored" : { refused: done.reason };
}
