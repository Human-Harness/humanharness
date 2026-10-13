import type { Plugin } from "vite";

/** The two lines of electron-vite's ESM shim that define them. */
const SHIM = new Set(["const __filename = import.meta.filename;", "const __dirname = import.meta.dirname;"]);
const BARE = /(?<![\w$.])__(?:dirname|filename)(?![\w$])/;

/**
 * Uses of `__dirname` / `__filename` in built code, outside comments and the shim's own lines. The bundle is
 * ESM: they work only through electron-vite's shim, which it puts after the last `import … from` it finds,
 * and a bundled JSDoc example (isomorphic-git's walkers) once put that shim inside a comment, so the built
 * app threw at load. Main code uses `import.meta.dirname` instead; this keeps it that way.
 */
export function bareDirnameRefs(code: string): { line: number; text: string }[] {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  // Comments become blanks of the same shape, so line numbers stay right.
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank);
  const original = code.split("\n");
  const refs: { line: number; text: string }[] = [];
  stripped.split("\n").forEach((line, i) => {
    if (BARE.test(line) && !SHIM.has(line.trim())) refs.push({ line: i + 1, text: original[i].trim() });
  });
  return refs;
}

/** Fails the main-process build when a chunk uses a bare `__dirname` or `__filename` (see bareDirnameRefs). */
export function noBareDirname(): Plugin {
  return {
    name: "hh-no-bare-dirname",
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const refs = bareDirnameRefs(out.code);
        if (refs.length > 0) {
          this.error(
            `Bare __dirname/__filename in the built main process (use import.meta.dirname): ${refs.map((r) => `${out.fileName}:${r.line} ${r.text.slice(0, 120)}`).join("; ")}`,
          );
        }
      }
    },
  };
}
