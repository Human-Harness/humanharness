import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EngineOption, LimitWindow } from "../client";
import { Rx } from "../guide";
import { shownLanguage } from "../language";
import { useCurrentWindows } from "../UsageMeter";
import { compactTokens, formatReset, percent } from "../usage";

/**
 * The bar's "Context n%" chip (task view one column): a popover with the task's context, the plan's usage and Open
 * context, which opens the context panel. The same data as ContextMeter and UsageMeter, in one place.
 */
export function ContextChip({
  used,
  cap,
  engine,
  limits: reported,
  lastTokens,
  onOpen,
}: {
  used: number;
  cap: number;
  engine: EngineOption | undefined;
  limits: LimitWindow[] | null;
  lastTokens: number | null;
  onOpen: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const limits = useCurrentWindows(reported);
  if (!(cap > 0)) return null;
  const lang = shownLanguage(i18n);
  const pct = Math.max(0, Math.min(100, Math.round((used / cap) * 100)));
  const fmt = (n: number) => n.toLocaleString(lang);
  let plan: string[];
  if (!engine) plan = [];
  else if (!engine.reportsLimits) {
    const line = engine.mock
      ? t("usage.mock")
      : t("usage.noLimits", { engine: engine.name });
    plan = [
      lastTokens !== null
        ? `${line} ${t("usage.lastTurn", { tokens: compactTokens(lastTokens, lang) })}`
        : line,
    ];
  } else if (!limits?.length) plan = [t("usage.unknown")];
  else
    plan = limits.map((w) => {
      const part = t("usage.window", {
        label: t(`usage.${w.kind}`, { defaultValue: w.kind }),
        percent: percent(w.utilization),
      });
      return w.kind === "five_hour"
        ? `${part} · ${t("usage.resets", { time: formatReset(w.resetsAt, lang) })}`
        : part;
    });
  return (
    <Rx.Popover.Root open={open} onOpenChange={setOpen}>
      <Rx.Popover.Trigger>
        <Rx.Button ref={chip} variant="outline" color="gray" size="1">
          {t("context.pill", { pct })}
        </Rx.Button>
      </Rx.Popover.Trigger>
      {open && (
        <Rx.Popover.Content
          className="hh-tb-popover"
          align="end"
          aria-label={t("context.title")}
        >
          <Rx.Flex direction="column" gap="2">
            <Rx.Text size="2" weight="bold">
              {t("models.context")}
            </Rx.Text>
            <Rx.Progress
              value={pct}
              color={pct >= 80 ? "orange" : "gray"}
              aria-label={t("models.context")}
            />
            <Rx.Text size="1" color="gray">
              {t("context.inUse", { used: fmt(used), cap: fmt(cap) })}
            </Rx.Text>
            {plan.length > 0 && (
              <>
                <Rx.Separator size="4" />
                <Rx.Text size="2" weight="bold">
                  {t("taskBar.planUsage", { defaultValue: "Plan usage" })}
                </Rx.Text>
                {plan.map((line, i) => (
                  <Rx.Text key={i} size="1" color="gray">
                    {line}
                  </Rx.Text>
                ))}
              </>
            )}
            {onOpen && <Rx.Flex justify="end">
              <Rx.Button
                variant="outline"
                color="gray"
                size="1"
                onClick={() => {
                  setOpen(false);
                  // The panel gives focus back to what opened it: the chip, not this button, which goes away.
                  chip.current?.focus();
                  onOpen();
                }}
              >
                {t("taskBar.openContext", { defaultValue: "Open context" })}
              </Rx.Button>
            </Rx.Flex>}
          </Rx.Flex>
        </Rx.Popover.Content>
      )}
    </Rx.Popover.Root>
  );
}
