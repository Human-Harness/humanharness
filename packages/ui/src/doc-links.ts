import { isMarkdownPath } from "@humanharness/harness-sdk/documents";

/** Where a link goes (document-reader spec §3.4). */
export type LinkTarget =
  | { kind: "doc"; path: string; anchor?: string }
  | { kind: "anchor"; id: string }
  | { kind: "external"; url: string; domain: string }
  | { kind: "text" };

export type ImageTarget = { kind: "local"; path: string } | { kind: "remote"; url: string; domain: string } | { kind: "none" };

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** `rel` resolved against the folder of `base` (a file path inside the folder; "" for the folder itself). */
export function joinPath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel;
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const out: string[] = [];
  for (const part of [...dir.split("/"), ...rel.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function web(href: string): { url: string; domain: string } | null {
  try {
    const u = new URL(href);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? { url: u.href, domain: u.hostname } : null;
  } catch {
    return null;
  }
}

export function linkTarget(href: string, base: string): LinkTarget {
  const h = href.trim();
  if (!h || h.startsWith("//")) return { kind: "text" };
  if (h.startsWith("#")) return h.length > 1 ? { kind: "anchor", id: decode(h.slice(1)) } : { kind: "text" };
  const scheme = SCHEME.exec(h);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return { kind: "text" };
    const w = web(h);
    return w ? { kind: "external", ...w } : { kind: "text" };
  }
  const hash = h.indexOf("#");
  const file = decode((hash < 0 ? h : h.slice(0, hash)).split("?")[0]);
  const anchor = hash < 0 ? "" : decode(h.slice(hash + 1));
  if (!isMarkdownPath(file)) return { kind: "text" };
  return { kind: "doc", path: joinPath(base, file), ...(anchor ? { anchor } : {}) };
}

export function imageTarget(src: string, base: string): ImageTarget {
  const s = src.trim();
  if (!s || s.startsWith("//")) return { kind: "none" };
  const scheme = SCHEME.exec(s);
  if (scheme) {
    const w = /^https?$/i.test(scheme[1]) ? web(s) : null;
    return w ? { kind: "remote", ...w } : { kind: "none" };
  }
  return { kind: "local", path: joinPath(base, decode(s.split(/[?#]/)[0])) };
}

/**
 * An autolink (`<https://…>`, a bare URL, `www.…`, an email): its label is the URL itself, or the URL without the
 * `http://` or `mailto:` that GFM puts before a `www.` or an email. Such a link shows only its label.
 * Never when the URL has a user part (`https://good.com@evil.com`): its real domain must show.
 */
export function isAutolink(label: string, url: string): boolean {
  if (label !== url && `http://${label}` !== url && `mailto:${label}` !== url) return false;
  try {
    const u = new URL(url);
    return u.username === "" && u.password === "";
  } catch {
    return true;
  }
}
