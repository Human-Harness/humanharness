import path from "node:path";
import type JSZip from "jszip";
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

/** A path inside the package: relative to `dir`, or from the root when it starts with `/`. */
const inZip = (dir: string, href: string) => (href.startsWith("/") ? path.posix.normalize(href.slice(1)) : path.posix.join(dir, href));

/** Font obfuscation (IDPF's and Adobe's): it hides embedded fonts only, the text stays readable. */
const FONT_OBFUSCATION = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];

/** A tag without its namespace prefix (`enc:EncryptedData` → `EncryptedData`). */
const local = (n: XNode) => tagOf(n).split(":").pop() ?? "";
const allLocal = (nodes: XNode[], name: string): XNode[] => nodes.flatMap((n) => [...(local(n) === name ? [n] : []), ...allLocal(kids(n), name)]);

/**
 * Whether `META-INF/encryption.xml` locks the text: any algorithm other than font obfuscation, or anything encrypted
 * that the reading order needs (a spine document, the package file).
 */
async function locked(zip: JSZip, needed: Set<string>): Promise<boolean> {
  const enc = await zipXml(zip, "META-INF/encryption.xml");
  if (!enc) return false;
  return allLocal(enc, "EncryptedData").some((d) => {
    const method = allLocal([d], "EncryptionMethod")[0];
    const ref = allLocal([d], "CipherReference")[0];
    const algorithm = method ? attr(method, "Algorithm") : undefined;
    const uri = ref ? attr(ref, "URI") : undefined;
    if (!algorithm || !FONT_OBFUSCATION.includes(algorithm)) return true;
    return uri !== undefined && needed.has(inZip("", unescape(uri)));
  });
}

/**
 * EPUB: the chapters in spine order, each read by the HTML walker under `ch. N` (§3 Ebooks). DRM-locked: refused;
 * fonts obfuscated the standard way are not a lock.
 */
export async function epubBlocks(buf: Buffer): Promise<MdBlock[]> {
  const zip = await openZip(buf);
  const container = await zipXml(zip, "META-INF/container.xml");
  const rootfile = container && findNode(container, "rootfile");
  const fullPath = rootfile && attr(rootfile, "full-path");
  const opfPath = fullPath ? inZip("", fullPath) : null;
  const opf = opfPath ? await zipXml(zip, opfPath) : null;
  if (!opf || !opfPath) throw new MaterialRefused("unreadable");
  const manifest = new Map(
    kids(findNode(opf, "manifest") ?? EMPTY)
      .filter((i) => tagOf(i) === "item")
      .map((i) => [attr(i, "id") ?? "", attr(i, "href") ?? ""]),
  );
  const spine = kids(findNode(opf, "spine") ?? EMPTY)
    .filter((i) => tagOf(i) === "itemref")
    .map((ref) => manifest.get(attr(ref, "idref") ?? ""))
    .filter((href): href is string => !!href)
    .map((href) => inZip(path.posix.dirname(opfPath), unescape(href)));
  if (await locked(zip, new Set([...spine, opfPath]))) throw new MaterialRefused("protected");
  const out: MdBlock[] = [];
  let ch = 0;
  for (const file of spine) {
    const html = await zipText(zip, file);
    if (html === null) continue;
    ch++;
    out.push(...htmlBlocks(html, { prefix: `ch. ${ch}` }));
  }
  // Each chapter estimated its own pages from 1: the book's pages run on.
  return withEstimatedPages(out);
}
