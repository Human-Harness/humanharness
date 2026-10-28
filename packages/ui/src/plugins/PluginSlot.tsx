import { useContext, useEffect, useRef } from "react";
import type { PluginPanelView } from "../client";
import { PanelFrame } from "./PanelFrame";
import { PluginChips } from "./PluginChips";
import { type PluginSurfaceContextValue, PluginSurfaceContext, isTarget, reloadOf } from "./surface";

/**
 * A slot the harness declared (manifest `slots`, plugins spec §3.4), drawn where the harness's own UI mounts it: a
 * panel slot stacks its panels, each headed "<title> · <plugin>"; a chip slot shows its chips. Main has already sent
 * each panel and chip to its slot (an unknown slot falls back to the core's default one). Outside the chat, or with no
 * surface (no plugins, D0), it draws nothing.
 */
export function PluginSlot({ id }: { id: string }) {
  const ctx = useContext(PluginSurfaceContext);
  if (!ctx) return null;
  const panels = ctx.surface.panels.filter((p) => p.slot === id);
  if (panels.length > 0)
    return (
      <div className="hh-pl-slot">
        {panels.map((p) => (
          <SlotPanel key={`${p.plugin}\n${p.id}`} ctx={ctx} panel={p} />
        ))}
      </div>
    );
  const chips = ctx.surface.chips.filter((c) => c.slot === id);
  return <PluginChips chips={chips} onOpen={(plugin, panel) => ctx.open(plugin, panel)} />;
}

function SlotPanel({ ctx, panel }: { ctx: PluginSurfaceContextValue; panel: PluginPanelView }) {
  const ref = useRef<HTMLElement>(null);
  const { target } = ctx;
  const targeted = isTarget(target, panel.plugin, panel.id);
  useEffect(() => {
    if (targeted) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [target, targeted]);
  const head = `${panel.title} · ${panel.pluginName}`;
  return (
    <section ref={ref} className="hh-pl-slot-panel" aria-label={head}>
      <p className="hh-pl-panel-head" dir="auto">
        {head}
      </p>
      <PanelFrame
        client={ctx.client}
        panel={panel}
        reload={reloadOf(ctx.surface, panel.plugin)}
        {...(targeted && target.focus !== undefined ? { focus: target.focus } : {})}
      />
    </section>
  );
}
