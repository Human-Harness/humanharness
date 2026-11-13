import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient } from "../client";
import { Icon, Rx } from "../guide";

/**
 * The safe-mode notice (minimal-core 0b2): the app started with `--safe` (or HH_SAFE=1), or the escape hatch was
 * pressed, so the person's mods are off and the harness's layout shows. An orange Callout over the screen, bottom
 * centre, that stays until closed: it says what happened and where to undo it.
 */
export function SafeNotice({ client }: { client: Pick<HarnessClient, "safeMode" | "onSafeMode"> }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    const off = client.onSafeMode?.(() => {
      if (live) setShown(true);
    });
    client.safeMode?.().then(
      (on) => {
        if (live && on) setShown(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off?.();
    };
  }, [client]);
  if (!shown) return null;
  return (
    // Over the screen, bottom centre above the footer; the strip lets clicks through, the notice takes them.
    <Rx.Flex position="fixed" bottom="8" left="0" right="0" justify="center" px="4" mx="auto" maxWidth="600px" style={{ zIndex: 1000, pointerEvents: "none" }}>
      <Rx.Callout.Root color="orange" role="status" variant="surface" style={{ pointerEvents: "auto" }}>
        <Rx.Callout.Icon>
          <Icon name="callout-warning" size={14} />
        </Rx.Callout.Icon>
        <Rx.Flex align="center" gap="3">
          <Rx.Callout.Text>{t("mods.safeNotice")}</Rx.Callout.Text>
          <Rx.IconButton variant="ghost" color="gray" size="1" aria-label={t("mods.safeClose")} onClick={() => setShown(false)}>
            <Icon name="close" size={14} />
          </Rx.IconButton>
        </Rx.Flex>
      </Rx.Callout.Root>
    </Rx.Flex>
  );
}
