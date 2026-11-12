import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Layout, ModsView } from "../client";
import { Rx } from "../guide";
import { useApp } from "./app";
import { BlockBoundary } from "./BlockBoundary";
import { useBlocks } from "./registry";

type BlockContent = Extract<Layout, { type: "block" }>["content"];
type ModContent = Extract<BlockContent, { mod: string }>;
/** Where a node sits: its sizes are widths in a row, heights in a column or a stack. */
type Axis = "row" | "column";

/** The mods' on/off as main last said, and the way to change it. */
interface Mods {
  view: ModsView | null;
  set(id: string, on: boolean): void;
}
const ModsContext = createContext<Mods>({ view: null, set: () => undefined });

/**
 * Draws a layout (minimal-core spec §5.2): rows and columns as flex containers, a stack showing one child (`shown` for
 * the stacks that have a child with that id, else their first visible one) under its header, `{ core: "task" }` through
 * `task`, and each mod's block in its own error boundary.
 */
export function LayoutView({ layout, shown, task }: { layout: Layout; shown: string; task: () => ReactNode }) {
  const { client } = useApp();
  const [view, setView] = useState<ModsView | null>(null);
  useEffect(() => {
    let live = true;
    let seen = false;
    const off = client.mods?.onChanged?.((v) => {
      seen = true;
      if (live) setView(v);
    });
    client.mods?.view?.().then(
      (v) => {
        if (live && !seen) setView(v);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off?.();
    };
  }, [client]);
  const mods: Mods = {
    view,
    set: (id, on) => {
      client.mods.set(id, on).then(setView, () => undefined);
    },
  };
  return (
    <ModsContext.Provider value={mods}>
      <Node node={layout} axis="column" shown={shown} task={task} root />
    </ModsContext.Provider>
  );
}

const px = (n: number | undefined) => (n === undefined ? undefined : `${n}px`);

/** A node's flex and min/max props along its parent's axis. */
function sizeProps(node: Layout, axis: Axis) {
  const size = node.size;
  const grow = size && "weight" in size ? String(size.weight) : size ? "0" : "1";
  const basis = size && "px" in size ? `${size.px}px` : "0";
  return {
    flexGrow: grow,
    flexShrink: size && "px" in size ? "0" : "1",
    flexBasis: basis,
    ...(axis === "row" ? { minWidth: px(node.min) ?? "0", maxWidth: px(node.max) } : { minHeight: px(node.min) ?? "0", maxHeight: px(node.max) }),
  };
}

function Node({ node, axis, shown, task, root = false }: { node: Layout; axis: Axis; shown: string; task: () => ReactNode; root?: boolean }) {
  if (node.hidden) return null;
  const sizes = root ? { height: "100%", minHeight: "0", minWidth: "0" } : sizeProps(node, axis);
  const data = { "data-layout": node.type, ...(node.id ? { "data-layout-id": node.id } : {}) };
  if (node.type === "block")
    return (
      <Rx.Flex direction="column" {...sizes} {...data}>
        <Content content={node.content} task={task} />
      </Rx.Flex>
    );
  if (node.type === "stack") {
    const visible = node.children.filter((c) => !c.hidden);
    const child = visible.find((c) => c.id === shown) ?? visible[0];
    return (
      <Rx.Flex direction="column" {...sizes} {...data}>
        {node.header && (
          <Rx.Flex direction="column" flexShrink="0">
            <Content content={node.header} task={task} />
          </Rx.Flex>
        )}
        {child && <Node key={child.id ?? visible.indexOf(child)} node={child} axis="column" shown={shown} task={task} />}
      </Rx.Flex>
    );
  }
  return (
    <Rx.Flex direction={node.type} {...sizes} {...data}>
      {node.children.map((c, i) => (
        <Node key={c.id ?? i} node={c} axis={node.type} shown={shown} task={task} />
      ))}
    </Rx.Flex>
  );
}

function Content({ content, task }: { content: BlockContent; task: () => ReactNode }) {
  if ("core" in content) return <>{task()}</>;
  return <ModBlock key={`${content.mod}/${content.block}`} content={content} />;
}

function ModBlock({ content }: { content: ModContent }) {
  const { t } = useTranslation();
  const app = useApp();
  const registry = useBlocks();
  const mods = useContext(ModsContext);
  const row = mods.view?.mods.find((m) => m.id === content.mod);
  if (row && !row.on)
    return (
      <Placeholder text={t("layout.off", { name: row.name })}>
        <Rx.Button variant="outline" color="gray" size="1" onClick={() => mods.set(content.mod, true)}>
          {t("layout.turnOn")}
        </Rx.Button>
      </Placeholder>
    );
  const Block = registry.get(content.mod, content.block);
  if (!Block) return <Placeholder text={t("layout.missing")} />;
  return (
    <BlockBoundary name={row?.name ?? content.mod} onTurnOff={() => mods.set(content.mod, false)}>
      <Block props={content.props ?? {}} app={app} />
    </BlockBoundary>
  );
}

/**
 * The empty block of an off or missing part: a grey notice a dialog's width (440, like Home's notices, DESIGN.md), and
 * the one way on when there is one.
 */
function Placeholder({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <Rx.Box p="4">
      <Rx.Box maxWidth="440px">
        <Rx.Callout.Root color="gray" role="status">
          <Rx.Callout.Text>{text}</Rx.Callout.Text>
          {children && <Rx.Flex>{children}</Rx.Flex>}
        </Rx.Callout.Root>
      </Rx.Box>
    </Rx.Box>
  );
}
