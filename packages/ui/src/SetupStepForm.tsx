import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HarnessClient, InputIssue, SetupStepView, SetupStepsState } from "./client";
import { InputForm } from "./InputForm";

/**
 * A `form` step (setup-steps spec §3): the core form over the step's fields, starting from their saved values (no
 * `blockId`, so no kept draft wins over them). Its submit saves through the main process (the same checks as any
 * write); a refusal shows by field, or as one line when it has none (a setup.json that can't be saved, say). With
 * `formId` the setup screen's footer submits it; without, it has its own button (`submitLabel`, Settings' Save).
 */
export function SetupStepForm({
  client,
  step,
  formId,
  submitLabel,
  onDone,
}: {
  client: HarnessClient;
  step: SetupStepView;
  formId?: string;
  submitLabel?: string;
  onDone: (state: SetupStepsState) => void;
}) {
  const { t } = useTranslation();
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<InputIssue[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    client.setupSteps.values(step.id).then(
      (v) => {
        if (live) setInitial(v);
      },
      () => {
        if (live) setInitial({});
      },
    );
    return () => {
      live = false;
    };
  }, [client, step.id]);

  if (!step.form || initial === null) return <div aria-busy="true" />;
  const failed: InputIssue[] = [{ path: "", message: t("setupSteps.failed") }];
  const submit = (value: Record<string, unknown>) => {
    setSending(true);
    setErrors([]);
    client.setupSteps
      .submit(step.id, value)
      .then(
        (r) => {
          if (r.ok) onDone(r.state);
          else setErrors(r.errors && r.errors.length > 0 ? r.errors : failed);
        },
        () => setErrors(failed),
      )
      .finally(() => setSending(false));
  };
  return (
    <InputForm
      spec={submitLabel ? { ...step.form, submitLabel } : step.form}
      data={null}
      initial={initial}
      {...(formId ? { formId } : {})}
      disabled={false}
      sending={sending}
      errors={errors}
      submit={submit}
    />
  );
}
