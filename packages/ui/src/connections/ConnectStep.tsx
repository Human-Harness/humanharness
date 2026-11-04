import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionResult, HarnessClient, SetupStepView } from "../client";
import { useConnections } from "./ConnectionsTab";
import { SecretField } from "./SecretField";
import { Rx } from "../guide";

/**
 * A `connect` setup step's body (tools spec §9): one field per key the step lists, in the step's order, as Settings ›
 * Connections shows them. Once the keys are known, it tells its parent whether every one is set (`onReady`): then Next
 * may go on.
 */
export function ConnectStep({ client, step, onReady }: { client: HarnessClient; step: SetupStepView; onReady: (ready: boolean) => void }) {
  const { t } = useTranslation();
  const { view, unavailable, error, save, remove, test } = useConnections(client);
  const ids = (step.secrets ?? []).map((s) => s.id);
  const rows = view && !unavailable ? ids.flatMap((id) => view.connections.filter((c) => c.id === id)) : [];
  // Every listed key is declared and set; a step listing none never counts as ready (main refuses it too).
  const ready = ids.length > 0 && rows.length === ids.length && rows.every((c) => c.set);
  // Told once the keys are known, so a step whose keys are all set already never reads as "just became ready".
  const known = view !== null || unavailable;
  const told = useRef(onReady);
  told.current = onReady;
  useEffect(() => {
    if (known) told.current(ready);
  }, [known, ready]);
  // Each refusal is a new alert (a new node), so the same text twice is announced twice, as in Settings › Connections.
  const [refusals, setRefusals] = useState(0);
  const counted = (result: ConnectionResult) => {
    if (!result.ok) setRefusals((n) => n + 1);
    return result;
  };
  return (
    <>
      {unavailable && (
        <Rx.Callout.Root color="red" role="alert">
          <Rx.Callout.Text>{t("connections.unavailable")}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      {rows.length > 0 && (
        // A card as Group draws it, without Group's bottom margin: the step's column already spaces its parts.
        <Rx.Card size="3">
          {rows.map((c, i) => (
            <Fragment key={c.id}>
              {i > 0 && <Rx.Separator size="4" />}
              <SecretField
                connection={c}
                onSave={(value) => save(c.id, value).then(counted)}
                onDelete={() => remove(c.id).then(counted)}
                {...(c.test ? { onTest: () => test(c.id) } : {})}
              />
            </Fragment>
          ))}
        </Rx.Card>
      )}
      {error && (
        <Rx.Callout.Root key={refusals} color="red" role="alert">
          <Rx.Callout.Text>{error}</Rx.Callout.Text>
        </Rx.Callout.Root>
      )}
      {!ready && view && !unavailable && (
        <Rx.Text as="p" size="1" color="gray">
          {t("connections.stepNext")}
        </Rx.Text>
      )}
    </>
  );
}
