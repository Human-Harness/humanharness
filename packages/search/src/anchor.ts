import { createSlugger, splitFrontMatter } from "@humanharness/harness-sdk/documents";

const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** What the reader's heading text loses: link and image syntax, code ticks, emphasis stars and strikes. */
const plain = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*~]/g, "")
    .trim();

/**
 * The id the reader gives the heading above `offset` (an index into `markdown`), so a result opens there (§3, §10).
 * ATX headings only, with the reader's own slugger in document order; none before the first heading.
 */
export function headingAnchorAt(markdown: string, offset: number): string | undefined {
  const { body } = splitFrontMatter(markdown);
  const slug = createSlugger();
  let pos = markdown.length - body.length;
  let fence: string | null = null;
  let found: string | undefined;
  for (const line of body.split("\n")) {
    if (pos > offset) break;
    const f = FENCE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    } else if (fence === null) {
      const h = ATX.exec(line);
      if (h) found = slug(plain(h[2]));
    }
    pos += line.length + 1;
  }
  return found;
}
