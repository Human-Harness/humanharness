import path from "node:path";
import { MaterialRefused, plainLine } from "../blocks";
import type { MdBlock } from "../types";
import { type XNode, attr, findNode, kids, odfText, tagOf, zipXml } from "./word";
import { openZip } from "./zip";

/** Every `a:t` text under a node, paragraph by paragraph (`a:p`). */
function drawingParas(n: XNode): string[] {
  const out: string[] = [];
  const collect = (x: XNode): string => (tagOf(x) === "#text" ? String(x["#text"]) : tagOf(x) === "a:br" ? "\n" : kids(x).map(collect).join(""));
  const walk = (x: XNode) => {
    if (tagOf(x) === "a:p") {
      const text = collect(x).trim();
      if (text) out.push(text);
      return;
    }
    kids(x).forEach(walk);
  };
  walk(n);
  return out;
}

/** A shape's placeholder type (`title`, `ctrTitle`, `body`, `sldNum`…), if any. */
const placeholder = (sp: XNode): string | undefined => {
  const ph = findNode([sp], "p:ph");
  return ph ? (attr(ph, "type") ?? "body") : undefined;
};

const EMPTY: XNode = {};

/** The target of the first relationship that matches. */
const relsTarget = (rels: XNode[] | null, pred: (r: XNode) => boolean): string | undefined => {
  const list = rels ? kids(findNode(rels, "Relationships") ?? EMPTY) : [];
  const r = list.find((x) => tagOf(x) === "Relationship" && pred(x));
  return r ? attr(r, "Target") : undefined;
};

/** A relationship's target as a path inside the zip: relative to `dir`, or from the root when it starts with `/`. */
const resolve = (dir: string, target: string) => (target.startsWith("/") ? path.posix.normalize(target.slice(1)) : path.posix.join(dir, target));

/** A slide's text is the person's, never Markdown: each line that would read as structure is escaped. */
const plain = (text: string) => text.split("\n").map(plainLine).join("\n");

/** One slide's blocks: `## <title or Slide n>`, its text, images, then `**Notes:** …` (§3 Presentations). */
function slideBlocks(n: number, title: string | undefined, paras: string[], images: number, notes: string[]): MdBlock[] {
  const loc = `slide ${n}`;
  return [
    { kind: "heading", level: 2, md: `## ${title?.replace(/\s+/g, " ") || `Slide ${n}`}`, loc, page: n },
    ...paras.map((md): MdBlock => ({ kind: "para", md: plain(md), loc, page: n })),
    ...Array.from({ length: images }, (): MdBlock => ({ kind: "image", md: `[image, ${loc}]`, loc, page: n })),
    ...(notes.length ? [{ kind: "para", md: `**Notes:** ${notes.join(" ").replace(/\s+/g, " ")}`, loc, page: n } as MdBlock] : []),
  ];
}

/** The shapes of a slide tree, groups (`p:grpSp`) opened. */
const shapesOf = (tree: XNode): XNode[] => kids(tree).flatMap((k) => (tagOf(k) === "p:grpSp" ? shapesOf(k) : [k]));

/** pptx: slides in the presentation's order (`p:sldIdLst`), not the file names'. */
export async function pptxBlocks(buf: Buffer): Promise<MdBlock[]> {
  const zip = await openZip(buf);
  const pres = await zipXml(zip, "ppt/presentation.xml");
  const rels = await zipXml(zip, "ppt/_rels/presentation.xml.rels");
  if (!pres) throw new MaterialRefused("unreadable");
  const ids = kids(findNode(pres, "p:sldIdLst") ?? EMPTY)
    .map((s) => attr(s, "r:id"))
    .filter((x): x is string => !!x);
  const out: MdBlock[] = [];
  let n = 0;
  for (const rid of ids) {
    const target = relsTarget(rels, (r) => attr(r, "Id") === rid);
    if (!target) continue;
    const file = resolve("ppt", target);
    const slide = await zipXml(zip, file);
    if (!slide) continue;
    n++;
    const tree = findNode(slide, "p:spTree");
    let title: string | undefined;
    const paras: string[] = [];
    let images = 0;
    for (const sp of tree ? shapesOf(tree) : []) {
      if (tagOf(sp) === "p:pic") images++;
      if (tagOf(sp) !== "p:sp") continue;
      const ph = placeholder(sp);
      const text = drawingParas(sp);
      if ((ph === "title" || ph === "ctrTitle") && !title) title = text.join(" ");
      else if (ph !== "sldNum" && ph !== "dt" && ph !== "ftr") paras.push(...text);
    }
    const dir = path.posix.dirname(file);
    const slideRels = await zipXml(zip, path.posix.join(dir, "_rels", `${path.posix.basename(file)}.rels`));
    const notesTarget = relsTarget(slideRels, (r) => (attr(r, "Type") ?? "").endsWith("/notesSlide"));
    const notesXml = notesTarget ? await zipXml(zip, resolve(dir, notesTarget)) : null;
    const notesTree = notesXml ? findNode(notesXml, "p:spTree") : null;
    const notes = notesTree ? shapesOf(notesTree).filter((sp) => tagOf(sp) === "p:sp" && placeholder(sp) === "body").flatMap(drawingParas) : [];
    out.push(...slideBlocks(n, title, paras, images, notes));
  }
  return out;
}

/** Each `text:p` under a node, trimmed, empty ones left out. */
function textParas(n: XNode): string[] {
  if (tagOf(n) === "text:p") {
    const t = odfText(n).trim();
    return t ? [t] : [];
  }
  return kids(n).flatMap(textParas);
}

/** odp: each `draw:page` is a slide; a frame of class `title` is its title; `presentation:notes` its notes. */
export async function odpBlocks(buf: Buffer): Promise<MdBlock[]> {
  const content = await zipXml(buf, "content.xml");
  const pres = content && findNode(content, "office:presentation");
  if (!pres) throw new MaterialRefused("unreadable");
  const out: MdBlock[] = [];
  let n = 0;
  for (const page of kids(pres).filter((k) => tagOf(k) === "draw:page")) {
    n++;
    let title: string | undefined;
    const paras: string[] = [];
    let images = 0;
    const notes: string[] = [];
    for (const f of kids(page).flatMap((k) => (tagOf(k) === "draw:g" ? kids(k) : [k]))) {
      if (tagOf(f) === "presentation:notes") {
        notes.push(...kids(f).flatMap(textParas));
        continue;
      }
      if (tagOf(f) !== "draw:frame") continue;
      const cls = attr(f, "presentation:class");
      if (cls === "page-number" || cls === "date-time" || cls === "footer" || cls === "header") continue;
      if (findNode([f], "draw:image")) images++;
      const text = textParas(f);
      if (cls === "title" && !title) title = text.join(" ");
      else paras.push(...text);
    }
    out.push(...slideBlocks(n, title, paras, images, notes));
  }
  return out;
}
