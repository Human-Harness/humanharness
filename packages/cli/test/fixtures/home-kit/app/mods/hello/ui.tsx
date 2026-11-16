import { defineMod } from "@humanharness/mod-sdk";
import { Rx } from "@humanharness/ui";

function Hello() {
  return <Rx.Text>Hello</Rx.Text>;
}

export default defineMod({
  id: "hello",
  ui(ctx) {
    ctx.block("hello", Hello);
    ctx.block("wave", Hello);
  },
});
