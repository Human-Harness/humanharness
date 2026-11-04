import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Rx } from "../guide";
import { PanelFrame } from "./PanelFrame";
import { PLUGINS_SLOT, type PluginSurfaceContextValue, isTarget, reloadOf } from "./surface";

const keyOf = (p: { plugin: string; id: string }) => `${p.plugin}\n${p.id}`;

/**
 * The core's default panel slot (plugins part 2, Decision 2): a "Plugins" section in the left side panel, one tab per
 * panel, the open tab's frame under it with the plugin's name. Nothing while no running plugin has a panel here.
 *
 * Radix stage 2e: a 12 grey heading like the column's other sections, Radix tabs at size 1 (the column is narrow), the
 * plugin's name as a 12 grey line over its frame. Only the open tab's frame is mounted.
 */
export function PluginsSection({ ctx }: { ctx: PluginSurfaceContextValue }) {
  const { t } = useTranslation();
  const { surface, client, target } = ctx;
  const headingId = useId();
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
  const value = keyOf(shown);
  return (
    <Rx.Flex asChild direction="column" gap="2" minWidth="0">
      <section ref={sectionRef} aria-labelledby={headingId}>
        <Rx.Heading as="h2" size="1" color="gray" id={headingId}>
          {t("plugins.panels.section")}
        </Rx.Heading>
        <Rx.Tabs.Root value={value} onValueChange={setActive}>
          <Rx.Tabs.List size="1" aria-label={t("plugins.panels.tabs")}>
            {panels.map((p) => (
              <Rx.Tabs.Trigger key={keyOf(p)} value={keyOf(p)} title={p.pluginName}>
                <bdi dir="auto">{p.title}</bdi>
              </Rx.Tabs.Trigger>
            ))}
          </Rx.Tabs.List>
          <Rx.Tabs.Content value={value}>
            <Rx.Flex direction="column" gap="2" pt="2" minWidth="0">
              <Rx.Text as="p" size="1" color="gray">
                <bdi dir="auto">{shown.pluginName}</bdi>
              </Rx.Text>
              <PanelFrame
                client={client}
                panel={shown}
                reload={reloadOf(surface, shown.plugin)}
                {...(isTarget(target, shown.plugin, shown.id) && target.focus !== undefined ? { focus: target.focus } : {})}
              />
            </Rx.Flex>
          </Rx.Tabs.Content>
        </Rx.Tabs.Root>
      </section>
    </Rx.Flex>
  );
}
