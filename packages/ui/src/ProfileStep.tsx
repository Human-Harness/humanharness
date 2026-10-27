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
  onCreated,
  onStranded,
}: {
  client: HarnessClient;
  state: AppState;
  formId: string;
  /** How many profiles are there already (not archived). */
  others: number;
  onCreated: (state: AppState) => void;
  /** The profile was made but couldn't be opened: another Next would make a second one. */
  onStranded: () => void;
}) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState<InputIssue[]>([]);
  const [sending, setSending] = useState(false);
  /** The title of a profile made but not opened (its switch failed): it is opened from the switcher. */
  const [stranded, setStranded] = useState<string | null>(null);
  if (!state.profiles) return null;
  const listNow = () =>
    client.profiles.get().then(
      (s) => s.list,
      () => null,
    );
  const submit = async (value: Record<string, unknown>) => {
    setSending(true);
    setErrors([]);
    try {
      const before = await listNow();
      const r = await client.profiles.create(value);
      if (r.ok) return onCreated(r.state);
      if (r.errors && r.errors.length > 0) return setErrors(r.errors);
      // `failed` also answers a switch that failed after the profile was made (it is registered, not active).
      const made = r.reason === "failed" && before ? (await listNow())?.find((p) => !before.some((b) => b.id === p.id)) : undefined;
      if (made) {
        setStranded(made.title);
        onStranded();
      } else setErrors([{ path: "", message: t(refusalKey(r)) }]);
    } catch {
      setErrors([{ path: "", message: t("profiles.refused.failed") }]);
    } finally {
      setSending(false);
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
