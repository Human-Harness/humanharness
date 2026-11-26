/** Sidekick shows only in a harness whose manifest has `mods.sidekick` (`{}` is enough); the same rule gates what main starts on its own. */
export function sidekickView(harness: { mods?: Readonly<Record<string, unknown>> }): { id: "sidekick"; name: "Sidekick"; mark: "coach" } | undefined {
  return harness.mods?.sidekick ? { id: "sidekick", name: "Sidekick", mark: "coach" } : undefined;
}
