import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";
import { FETCH_TIMEOUT_MS, MAX_BYTES, sourceSlug } from "@humanharness/material/light";

export type Fetched = { ok: true; name: string; data: Buffer; url: string; fetchedAt: string } | { ok: false };

/** Redirects followed at most, each one checked like the first address. */
export const MAX_REDIRECTS = 5;

/** Addresses a link may never reach: this computer, the local network, link-local and the like. */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

/** Whether an address is a public one (an IPv4-mapped IPv6 address counts as its IPv4 address). */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  const family = isIP(ip);
  if (family === 0) return false;
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Whether every address a host name resolves to is public; a name that doesn't resolve is not. */
export async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPublicAddress(host);
  try {
    const all = await dns.lookup(host, { all: true, verbatim: true });
    return all.length > 0 && all.every((a) => isPublicAddress(a.address));
  } catch {
    return false;
  }
}

export interface FetchOptions {
  now?: Date;
  /** The whole fetch, redirects and body included. */
  timeoutMs?: number;
  /** Whether a host may be reached (default: only public addresses). */
  allowHost?: (hostname: string) => Promise<boolean>;
}

/**
 * A link the person adds (material spec §3 Web): fetched once, now, with Node's `fetch` (never the window's session,
 * so no cookies), only over http(s) and only to public addresses, following at most MAX_REDIRECTS redirects, each
 * checked again; at most MAX_BYTES within FETCH_TIMEOUT_MS. The page is kept as the original (`<slug>.html`, or `.pdf`
 * when the link serves a PDF), named after the address it finally came from, so reprocessing works offline.
 */
export async function fetchLink(raw: string, o: FetchOptions = {}): Promise<Fetched> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false };
  }
  const allowHost = o.allowHost ?? isPublicHost;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
      if (!(await allowHost(url.hostname))) return { ok: false };
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        credentials: "omit",
        headers: { accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" },
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => undefined);
        const location = res.headers.get("location");
        if (!location || hop >= MAX_REDIRECTS) return { ok: false };
        try {
          url = new URL(location, url);
        } catch {
          return { ok: false };
        }
        continue;
      }
      if (!res.ok || !res.body) return { ok: false };
      if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return { ok: false };
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > MAX_BYTES) return { ok: false };
        chunks.push(Buffer.from(chunk));
      }
      const pdf = (res.headers.get("content-type") ?? "").includes("application/pdf");
      // The host name without its port, and the path: `example-org-wiki-fractions`.
      const slug = sourceSlug(`${url.hostname}${url.pathname}`.replace(/\./g, "-"), new Set());
      return { ok: true, name: `${slug}.${pdf ? "pdf" : "html"}`, data: Buffer.concat(chunks), url: url.toString(), fetchedAt: (o.now ?? new Date()).toISOString() };
    }
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
    // A body left unread (an error, too big) is dropped with its connection.
    controller.abort();
  }
}
