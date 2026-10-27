import { FETCH_TIMEOUT_MS, MAX_BYTES, sourceSlug } from "@humanharness/material";

export type Fetched = { ok: true; name: string; data: Buffer; url: string; fetchedAt: string } | { ok: false };

/**
 * A link the person adds (material spec §3 Web): fetched once, now, with Node's `fetch` (never the window's session,
 * so no cookies), only over http(s), at most MAX_BYTES and FETCH_TIMEOUT_MS. The page is kept as the original
 * (`<slug>.html`, or `.pdf` when the link serves a PDF) so reprocessing works offline.
 */
export async function fetchLink(raw: string, now = new Date()): Promise<Fetched> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      credentials: "omit",
      headers: { accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5" },
    });
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
    return { ok: true, name: `${slug}.${pdf ? "pdf" : "html"}`, data: Buffer.concat(chunks), url: url.toString(), fetchedAt: now.toISOString() };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
    // A body left unread (an error, too big) is dropped with its connection.
    controller.abort();
  }
}
