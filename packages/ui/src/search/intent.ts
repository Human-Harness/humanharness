import type { SearchTarget } from "../client";

/** What the window does with a result (search spec §3) or a ⌘Enter question (§5.4). `reveal` is main's; `none` opens nothing. */
export type SearchIntent = Exclude<SearchTarget, { kind: "reveal" } | { kind: "none" }> | { kind: "draft"; text: string };
