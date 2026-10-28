import { definePluginBackend } from "@humanharness/harness-sdk/plugin-backend";

type Event = { id: string; year: number; text: string; page?: string };
type Raw = { year?: unknown; text?: unknown; pages?: { content_urls?: { desktop?: { page?: unknown } } }[] };

/** A round anniversary: a whole multiple of this many years ago (Decision 25). */
const ROUND = 25;
const TEXT_MAX = 2000;
const BODY_MAX = 200;
/** Wikimedia's API etiquette: say who is asking. */
const HEADERS = { "Api-User-Agent": "HumanHarness-demo/0.1" };

const two = (n: number) => String(n).padStart(2, "0");

/** The first page's desktop link when it is https on wikipedia.org; anything else is dropped. */
function pageOf(raw: Raw): string | undefined {
  const page = raw.pages?.[0]?.content_urls?.desktop?.page;
  if (typeof page !== "string") return undefined;
  try {
    const u = new URL(page);
    return u.protocol === "https:" && (u.hostname === "wikipedia.org" || u.hostname.endsWith(".wikipedia.org")) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const roundKey = (year: number) => `round-${year}`;

export default definePluginBackend({
  sources: {
    async events(ctx) {
      const { count } = await ctx.settings.get();
      const keep = typeof count === "number" ? count : 25;
      // The person's local date: "today" is theirs, not UTC's.
      const now = new Date();
      const base = "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected";
      const res = await ctx.fetch(`${base}/${two(now.getMonth() + 1)}/${two(now.getDate())}`, { headers: HEADERS });
      if (!res.ok) throw new Error(`api.wikimedia.org answered ${res.status}`);
      const body = res.json() as { selected?: Raw[] };
      const selected = Array.isArray(body?.selected) ? body.selected : [];

      const events: Event[] = [];
      selected.forEach((raw, n) => {
        if (typeof raw?.year !== "number" || !Number.isInteger(raw.year) || typeof raw.text !== "string" || raw.text.trim() === "") return;
        const page = pageOf(raw);
        events.push({ id: `${raw.year}-${n}`, year: raw.year, text: raw.text.slice(0, TEXT_MAX), ...(page ? { page } : {}) });
      });
      const kept = events.slice(0, keep);

      // Yesterday's round items: derived from the stored list before it is replaced (no extra collection).
      const before = await ctx.data.query("events", { fields: ["year"], limit: 500 });
      const year = now.getFullYear();
      const round = kept.filter((e) => year - e.year > 0 && (year - e.year) % ROUND === 0);
      const today = new Set(round.map((e) => roundKey(e.year)));
      // Resolved before the list is replaced: a write that fails can't leave yesterday's items open for good.
      const old = new Set(before.records.map((r) => r.year).filter((y): y is number => typeof y === "number").map(roundKey));
      for (const key of old) if (!today.has(key)) await ctx.attention.resolve(key);

      await ctx.data.replaceAll("events", kept);
      const raised = new Set<string>();
      for (const e of round) {
        const key = roundKey(e.year);
        if (raised.has(key)) continue;
        raised.add(key);
        await ctx.attention.raise({
          key,
          severity: "info",
          title: `${year - e.year} years ago today`,
          body: e.text.slice(0, BODY_MAX),
          target: { panel: "events", focus: e.id },
        });
      }

      const first = round[0];
      await ctx.chip.set("today", { text: first ? `${year - first.year}-year anniversary today` : `${kept.length} events today` });
    },
  },
});
