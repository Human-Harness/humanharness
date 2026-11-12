/** Sidekick shows only in a harness whose manifest has a `sidekick` key (`{}` is enough); the same rule gates what main starts on its own. */
export function sidekickView(harness: { sidekick?: object | undefined }): { id: "sidekick"; name: "Sidekick"; mark: "coach" } | undefined {
  return harness.sidekick ? { id: "sidekick", name: "Sidekick", mark: "coach" } : undefined;
}
