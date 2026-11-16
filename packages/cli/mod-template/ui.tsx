import { defineMod } from "@humanharness/mod-sdk";
import { type BlockProps, Rx } from "@humanharness/ui";

const TITLE = "__NAME__";

// A block a layout places as { "mod": "__ID__", "block": "__BLOCK__" }. Built only from the app's pieces (Rx), so
// the theme decides the look: no colours or sizes of its own.
function Block({ props }: BlockProps) {
  return (
    <Rx.Card>
      <Rx.Flex direction="column" gap="1">
        <Rx.Heading as="h2" size="3">
          {TITLE}
        </Rx.Heading>
        <Rx.Text>{String(props.text ?? "Edit ui.tsx to change this block.")}</Rx.Text>
      </Rx.Flex>
    </Rx.Card>
  );
}

export default defineMod({
  id: "__ID__",
  ui(ctx) {
    ctx.block("__BLOCK__", Block);
  },
});
