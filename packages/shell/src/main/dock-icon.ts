/**
 * The Dock icon of a development build, which otherwise shows Electron's: the first file, in order, that is a
 * picture the Dock can show (an SVG loads empty). A file that can't be named (`file` throws) is skipped.
 * Packaged apps get their icon from the build instead.
 */
export function devDockIcon<I extends { isEmpty(): boolean }>(files: (() => string | undefined)[], load: (file: string) => I): I | null {
  for (const file of files) {
    let name: string | undefined;
    try {
      name = file();
    } catch {
      continue;
    }
    if (name === undefined) continue;
    const icon = load(name);
    if (!icon.isEmpty()) return icon;
  }
  return null;
}
