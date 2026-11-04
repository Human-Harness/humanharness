import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "../guide";
import { PanelFrame } from "./PanelFrame";
import { PLUGINS_SLOT, type PluginSurfaceContextValue, isTarget, reloadOf } from "./surface";

const keyOf = (p: { plugin: string; id: string }) => `${p.plugin}\n${p.id}`;

/**
 * The core's default panel slot (plugins part 2, Decision 2): a "Plugins" section in the left side panel, one tab per
 * panel, the open tab's frame under it with the plugin's name. Nothing while no running plugin has a panel here.
 */
export function PluginsSection({ ctx }: { ctx: PluginSurfaceContextValue }) {
  const { t } = useTranslation();
  const { surface, client, target } = ctx;
  const headingId = useId();
  const baseId = useId();
  const [active, setActive] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const panels = surface.panels.filter((p) => p.slot === PLUGINS_SLOT);
  const shown = panels.find((p) => keyOf(p) === active) ?? panels[0];
  const targetHere = panels.some((p) => isTarget(target, p.plugin, p.id));

  // An open (a chip, an attention item) for a panel here selects its tab and brings the section into view, also when
  // that panel only appears after the open.
  useEffect(() => {
    if (!target || !targetHere) return;
    setActive(keyOf({ plugin: target.plugin, id: target.panel }));
    sectionRef.current?.scrollIntoView?.({ block: "nearest" });
    // Only a new open, or its panel appearing, counts, not the panels' list, which changes on every push.
  }, [target, targetHere]);

  if (!shown) return null;
  const index = panels.indexOf(shown);
  return (
    <section ref={sectionRef} className="hh-pl-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="hh-flow-heading">
        {t("plugins.panels.section")}
      </h2>
      <Tabs
        id={baseId}
        label={t("plugins.panels.tabs")}
        value={keyOf(shown)}
        items={panels.map((p) => ({ id: keyOf(p), label: p.title, title: p.pluginName }))}
        onChange={setActive}
      />
      <div id={`${baseId}-panel`} className="hh-pl-tabpanel" role="tabpanel" aria-labelledby={`${baseId}-tab-${index}`}>
        <p className="hh-pl-panel-head" dir="auto">
          {shown.pluginName}
        </p>
        <PanelFrame
          client={client}
          panel={shown}
          reload={reloadOf(surface, shown.plugin)}
          {...(isTarget(target, shown.plugin, shown.id) && target.focus !== undefined ? { focus: target.focus } : {})}
        />
      </div>
    </section>
  );
}
