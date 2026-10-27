import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, InputIssue, InputSpec, ProfileResult } from "./client";
import { InputForm } from "./InputForm";
import { PROFILE_COLLECTION } from "./profiles";
import { Avatar, refusalKey, shownTitle, useProfiles } from "./ProfileSwitcher";

/**
 * Settings › General › People (profiles spec §5): every profile; the active one can be edited, any other archived,
 * brought back or deleted (asked twice; its folder and history go to the Trash).
 */
export function ProfilesSection({ client, state, onChange }: { client: HarnessClient; state: AppState; onChange: (s: AppState) => void }) {
  const { t } = useTranslation();
  const headingId = useId();
  const people = useProfiles(client, state.profiles !== undefined);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; stage: 1 | 2 } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!state.profiles || !people) return null;
  const form = state.profiles.form;
  const act = (call: Promise<ProfileResult>) => {
    setError(null);
    call.then(
      (r) => (r.ok ? onChange(r.state) : setError(t(refusalKey(r)))),
      () => setError(t("profiles.refused.failed")),
    );
  };
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>{t("profiles.sectionTitle")}</h3>
      <ul className="hh-rows" aria-labelledby={headingId}>
        {people.list.map((p) => {
          const active = p.id === people.active;
          const name = shownTitle(p.title);
          return (
            <li key={p.id} className="hh-row hh-row-wrap" aria-label={name}>
              <Avatar profile={p} />
              <span className="hh-profile-row-name" title={name}>
                {name}
              </span>
              {active && <span className="hh-caption">{t("profiles.active")}</span>}
              {p.archived && <span className="hh-caption">{t("profiles.archived")}</span>}
              {active ? (
                <button aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
                  {t("profiles.edit")}
                </button>
              ) : (
                <>
                  <button onClick={() => act(p.archived ? client.profiles.unarchive(p.id) : client.profiles.archive(p.id))}>
                    {t(p.archived ? "profiles.unarchive" : "profiles.archive")}
                  </button>
                  <button onClick={() => setConfirm({ id: p.id, stage: 1 })}>{t("profiles.delete")}</button>
                </>
              )}
              {confirm?.id === p.id && (
                <div className="hh-row-note">
                  <p>{t(confirm.stage === 1 ? "profiles.deleteFirst" : "profiles.deleteSecond", { name })}</p>
                  <button
                    onClick={() => {
                      if (confirm.stage === 1) return setConfirm({ id: p.id, stage: 2 });
                      setConfirm(null);
                      act(client.profiles.delete(p.id));
                    }}
                  >
                    {t(confirm.stage === 1 ? "profiles.deleteGo" : "profiles.deleteConfirm")}
                  </button>
                  <button onClick={() => setConfirm(null)}>{t("profiles.cancel")}</button>
                </div>
              )}
              {active && editing && (
                <div className="hh-row-note">
                  <ProfileEdit client={client} form={form} onSaved={() => setEditing(false)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** The active profile's fields, saved as the person's write (its checks, its `Data: profile` commit). */
function ProfileEdit({ client, form, onSaved }: { client: HarnessClient; form: InputSpec; onSaved: () => void }) {
  const { t } = useTranslation();
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<InputIssue[]>([]);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let live = true;
    client.data.get(PROFILE_COLLECTION).then(
      (r) => {
        if (live) setInitial(r ?? {});
      },
      () => {
        if (live) setInitial({});
      },
    );
    return () => {
      live = false;
    };
  }, [client]);
  if (initial === null) return <div aria-busy="true" />;
  const submit = (value: Record<string, unknown>) => {
    setSending(true);
    setErrors([]);
    // The record keeps the fields the form doesn't ask for (its colour, anything the agent wrote).
    client.data
      .put(PROFILE_COLLECTION, { ...initial, ...value })
      .then(onSaved, () => setErrors([{ path: "", message: t("profiles.refused.failed") }]))
      .finally(() => setSending(false));
  };
  return <InputForm spec={{ ...form, submitLabel: t("profiles.save") }} data={null} initial={initial} disabled={false} sending={sending} errors={errors} submit={submit} />;
}
