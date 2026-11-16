import { defineMod } from "@humanharness/mod-sdk";
import { Rx } from "@humanharness/ui";

function Home() {
  return <Rx.Text>Home</Rx.Text>;
}

export default defineMod({
  id: "home",
  ui(ctx) {
    ctx.block("home", Home);
  },
});
