import { defineMod } from "@humanharness/mod-sdk";

// A user mod written by hand: one block, "hello", that says Hello.
export default defineMod({
  id: "hello",
  ui(ctx) {
    ctx.block("hello", () => <p>Hello</p>);
  },
});
