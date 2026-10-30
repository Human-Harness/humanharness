import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient } from "../client";
import { useBackend } from "./useBackend";

/**
 * The harness's backend gave up after its restarts (hatches spec §4.3, Decision 9): one card with "Restart". Nothing
 * shows while it starts or runs. HarnessApp mounts it only with `state.hatches.backend` (D0).
 */
export function BackendCard({ client }: { client: HarnessClient }) {
  const { t } = useTranslation();
  const { state } = useBackend(client);
  const [restarting, setRestarting] = useState(false);
  // Any new state ends the wait: a failed Restart shows a fresh button.
  useEffect(() => setRestarting(false), [state]);
  if (state !== "failed") return null;
  const restart = () => {
    setRestarting(true);
    client.backend.restart().catch(() => setRestarting(false));
  };
  return (
    <div className="hh-backend-card" role="alert">
      <p>{t("hatches.backendFailed")}</p>
      <button type="button" onClick={restart} disabled={restarting}>
        {restarting ? t("hatches.backendRestarting") : t("hatches.backendRestart")}
      </button>
    </div>
  );
}
