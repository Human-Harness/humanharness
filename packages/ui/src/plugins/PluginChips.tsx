import { useTranslation } from "react-i18next";
import type { PluginChipView } from "../client";

/**
 * Chips (plugins part 2, Decision 13): short texts a running plugin set, drawn by the core as plain text (P9). A chip
 * whose plugin has a panel is a button that opens it; any other is text only.
 */
export function PluginChips({ chips, onOpen }: { chips: PluginChipView[]; onOpen: (plugin: string, panel: string) => void }) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <span className="hh-pl-chips">
      {chips.map((c) => {
        const className = `hh-pl-chip ${c.severity === "warn" || c.severity === "action" ? c.severity : "info"}`;
        const title = `${c.pluginName}: ${c.text}`;
        const key = `${c.plugin}\n${c.id}`;
        const panel = c.panel;
        if (panel === undefined)
          return (
            <span key={key} className={className} title={title} dir="auto">
              {c.text}
            </span>
          );
        return (
          <button key={key} type="button" className={className} title={title} dir="auto" onClick={() => onOpen(c.plugin, panel)}>
            {c.text}
            <span className="hh-sr-only"> {t("plugins.chips.open", { name: c.pluginName })}</span>
          </button>
        );
      })}
    </span>
  );
}
