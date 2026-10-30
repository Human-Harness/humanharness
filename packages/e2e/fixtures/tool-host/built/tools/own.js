// The control: a second tool of the same harness. Built bundles end in `export { … as default }`.
const own = { run: async () => "own" };
export const reached = true;
export { own as default };
