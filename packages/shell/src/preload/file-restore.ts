import type { FileRefusal, FileRestoreResult } from "@humanharness/protocol";

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/** `client.files.timeline` and `client.files.diff`: main's answer, or "failed" when the invoke rejects (data, never a throw). */
export function askFile<T>(invoke: Invoke, channel: "hh:fileTimeline" | "hh:fileDiff", ...args: unknown[]): Promise<T | { ok: false; reason: "failed" }> {
  return invoke(channel, ...args).then(
    (v) => v as T,
    () => ({ ok: false as const, reason: "failed" as const }),
  );
}

/**
 * `client.files.restore` (file-timeline spec §5, §6.3): main checks, asks with its native dialog and goes back. Its
 * answer becomes "restored", "cancelled" (the person said no) or a refusal; a rejected invoke is "failed".
 */
export async function restoreFlow(invoke: Invoke, file: string, commit: string): Promise<FileRestoreResult> {
  const v = await invoke("hh:fileRestore", file, commit).catch(() => null);
  if (typeof v !== "object" || v === null || !("ok" in v)) return { refused: "failed" };
  const answer = v as { ok: boolean; reason?: FileRefusal | "cancelled" };
  if (answer.ok === true) return "restored";
  if (answer.reason === "cancelled") return "cancelled";
  return { refused: answer.reason ?? "failed" };
}
