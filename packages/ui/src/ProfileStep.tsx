import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, InputIssue } from "./client";
import { InputForm } from "./InputForm";
import { refusalKey } from "./ProfileSwitcher";

/**
 * The profile step's body (profiles spec §5 "Creating a profile"): the `profiles.fields` form; its submit creates the
 * profile, which becomes the active one. The privacy note shows while the second profile is made (§6). The setup
 * screen's footer submits it (`formId`).
 */
export function ProfileStep({
  client,
  state,
  formId,
  others,
  stranded,
  onCreated,
  onStranded,
  onSending,
}: {
  client: HarnessClient;
  state: AppState;
  formId: string;
  /** How many profiles are there already (not archived). */
  others: number;
  /** The title of a profile this run made but couldn't open (the setup screen keeps it); null when there is none. */
  stranded: string | null;
  onCreated: (state: AppState) => void;
  /** The profile `id` was made but its switch failed: another Next would make a second one. `name`: what was typed. */
  onStranded: (id: string, name: string) => void;
  /** A create is on its way, or it ended. */
  onSending: (sending: boolean) => void;
}) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<InputIssue[]>([]);
  const [sending, setSending] = useState(false);
  if (!state.profiles) return null;
  const sendingNow = (on: boolean) => {
    setSending(on);
    onSending(on);
  };
  const submit = async (value: Record<string, unknown>) => {
    sendingNow(true);
    setErrors([]);
    try {
      const r = await client.profiles.create(value);
      if (r.ok) return onCreated(r.state);
      if (r.errors && r.errors.length > 0) return setErrors(r.errors);
      // A switch that failed after the profile was made: it exists, and it is opened from the switcher.
      if (r.made !== undefined) onStranded(r.made, typeof value.name === "string" ? value.name.trim() : r.made);
      else setErrors([{ path: "", message: t(refusalKey(r)) }]);
    } catch {
      setErrors([{ path: "", message: t("profiles.refused.failed") }]);
    } finally {
      sendingNow(false);
    }
  };
  return (
    <>
      {others === 1 && <p className="hh-caption">{t("profiles.privacy")}</p>}
      <InputForm
        spec={state.profiles.form}
        data={null}
        formId={formId}
        disabled={stranded !== null}
        sending={sending}
        errors={errors}
        submit={(v) => void submit(v)}
      />
      {stranded !== null && (
        <p className="hh-save-error" role="alert">
          {t("profiles.addedNotOpened", { title: stranded })}
        </p>
      )}
    </>
  );
}
