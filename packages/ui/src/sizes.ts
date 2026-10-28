/** A byte count as the person reads it: "2 KB", "1.5 MB" (at least 1 KB). */
export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
