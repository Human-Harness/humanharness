import { defineMod } from "@humanharness/mod-sdk";
import { type BlockProps, Rx } from "@humanharness/ui";

const NAME = "__NAME__";

// A block a layout places with { "mod": "__ID__", "block": "__BLOCK__" }. Build it only with the app's pieces
// (Rx, Icon, Hidden): the theme decides colours and sizes.
function Main({ props }: BlockProps) {
  return (
    <Rx.Card>
      <Rx.Flex direction="column" gap="1">
        <Rx.Heading size="3">{NAME}</Rx.Heading>
        <Rx.Text color="gray">{typeof props.text === "string" ? props.text : "Edit ui.tsx to change this block."}</Rx.Text>
      </Rx.Flex>
    </Rx.Card>
  );
}

export default defineMod({
  id: "__ID__",
  ui(ctx) {
    ctx.block("__BLOCK__", Main);
  },
});
