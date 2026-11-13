import { defineMod } from "@humanharness/mod-sdk";

// The hello mod with a syntax error (an unclosed call): the build fails, the window keeps the last good version.
export default defineMod({
  id: "hello",
  ui(ctx) {
    ctx.block("hello", () => <p>Hello broken</p>;
  },
});
