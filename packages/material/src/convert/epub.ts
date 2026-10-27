import path from "node:path";
import { MaterialRefused, withEstimatedPages } from "../blocks";
import type { MdBlock } from "../types";
import { htmlBlocks } from "./html";
import { type XNode, attr, findNode, kids, tagOf, zipXml } from "./word";
import { openZip, zipText } from "./zip";

const EMPTY: XNode = {};

/** An href inside the package, `%20` and the like decoded; a broken escape leaves it as it is. */
const unescape = (href: string): string => {
  try {
    return decodeURIComponent(href.split("#")[0]);
  } catch {
    return href.split("#")[0];
  }
};

/** EPUB: the chapters in spine order, each read by the HTML walker under `ch. N` (§3 Ebooks). DRM-locked: refused. */
export async function epubBlocks(buf: Buffer): Promise<MdBlock[]> {
  const zip = await openZip(buf);
  if (zip.file("META-INF/encryption.xml")) throw new MaterialRefused("protected");
  const container = await zipXml(zip, "META-INF/container.xml");
  const rootfile = container && findNode(container, "rootfile");
  const opfPath = rootfile && attr(rootfile, "full-path");
  const opf = opfPath ? await zipXml(zip, opfPath) : null;
  if (!opf || !opfPath) throw new MaterialRefused("unreadable");
  const manifest = new Map(
    kids(findNode(opf, "manifest") ?? EMPTY)
      .filter((i) => tagOf(i) === "item")
      .map((i) => [attr(i, "id") ?? "", attr(i, "href") ?? ""]),
  );
  const out: MdBlock[] = [];
  let ch = 0;
  for (const ref of kids(findNode(opf, "spine") ?? EMPTY).filter((i) => tagOf(i) === "itemref")) {
    const href = manifest.get(attr(ref, "idref") ?? "");
    if (!href) continue;
    const html = await zipText(zip, path.posix.join(path.posix.dirname(opfPath), unescape(href)));
    if (html === null) continue;
    ch++;
    out.push(...htmlBlocks(html, { prefix: `ch. ${ch}` }));
  }
  // Each chapter estimated its own pages from 1: the book's pages run on.
  return withEstimatedPages(out);
}
