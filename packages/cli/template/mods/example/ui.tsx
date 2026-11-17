import { defineMod } from "@humanharness/mod-sdk";
import { type BlockProps, Rx } from "@humanharness/ui";

// The block `card`: layouts/main.json places it as { "mod": "example", "block": "card" }, in the header of home.
// Built only from the app's pieces (Rx), so the theme decides the look: no colours or sizes of its own.
function Card({ props }: BlockProps) {
  return (
    <Rx.Card>
      <Rx.Flex direction="column" gap="1">
        <Rx.Heading as="h2" size="3">
          {String(props.title ?? "This harness is made of mods")}
        </Rx.Heading>
        <Rx.Text>{String(props.text ?? "Edit mods/example/ui.tsx to change this block, or layouts/main.json to move it.")}</Rx.Text>
      </Rx.Flex>
    </Rx.Card>
  );
}

export default defineMod({
  id: "example",
  ui(ctx) {
    ctx.block("card", Card);
  },
});
