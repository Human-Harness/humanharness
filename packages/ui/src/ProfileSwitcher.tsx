import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, ProfileResult, ProfileView, ProfilesState } from "./client";
import { AVATAR_COLORS } from "./profiles";

/** A profile's avatar (spec D7): the title's first letter on its colour; neutral when the colour is not one we draw. */
export function Avatar({ profile }: { profile: Pick<ProfileView, "title" | "color"> }) {
  const color = profile.color && (AVATAR_COLORS as readonly string[]).includes(profile.color) ? profile.color : undefined;
  return (
    <span className="hh-avatar" data-color={color} aria-hidden="true">
      {[...profile.title.trim()][0]?.toUpperCase() ?? ""}
    </span>
  );
}

/** Reads the profiles and follows every change (a change that arrived is newer than the first reply). */
export function useProfiles(client: HarnessClient, on: boolean): ProfilesState | null {
  const [profiles, setProfiles] = useState<ProfilesState | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    let seen = false;
    client.profiles.get().then(
      (s) => {
        if (live && !seen) setProfiles(s);
      },
      () => undefined,
    );
    const off = client.profiles.onChange((s) => {
      seen = true;
      if (live) setProfiles(s);
    });
    return () => {
      live = false;
      off();
    };
  }, [client, on]);
  return profiles;
}

/** The refusal's line; every reason the person can't act on is "didn't work". */
export const refusalKey = (r: Exclude<ProfileResult, { ok: true }>): string =>
  `profiles.refused.${r.reason === "busy" || r.reason === "open" ? r.reason : "failed"}`;

/**
 * Who is using the app (spec §5 "Where the switcher lives"): the active profile's avatar and name, a select when there
 * are several, and Add. Shown only in a harness with profiles.
 */
export function ProfileSwitcher({
  client,
  state,
  onSwitched,
  onAdd,
  disabled = false,
}: {
  client: HarnessClient;
  state: AppState;
  /** A switch went through: the app state with the new profile. */
  onSwitched: (state: AppState) => void;
  /** "Add <label>": the setup screen at its profile step. */
  onAdd: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const profiles = useProfiles(client, state.profiles !== undefined);
  const [error, setError] = useState<string | null>(null);
  if (!state.profiles || !profiles) return null;
  const label = state.profiles.label;
  const shown = profiles.list.filter((p) => !p.archived);
  const active = shown.find((p) => p.id === profiles.active);
  const pick = (id: string) => {
    setError(null);
    client.profiles.open(id).then(
      (r) => (r.ok ? onSwitched(r.state) : setError(t(refusalKey(r)))),
      () => setError(t("profiles.refused.failed")),
    );
  };
  return (
    <div className="hh-profile-switcher">
      {active && <Avatar profile={active} />}
      {/* With none active (a new one whose switch failed), even one profile is a choice: it is opened from here. */}
      {shown.length > 1 || (!active && shown.length > 0) ? (
        <select aria-label={t("profiles.pick", { label })} value={active?.id ?? ""} disabled={disabled} onChange={(e) => pick(e.target.value)}>
          {!active && <option value="" disabled />}
          {shown.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      ) : (
        active && <span className="hh-profile-name">{active.title}</span>
      )}
      <button type="button" disabled={disabled} onClick={onAdd}>
        {t("profiles.add", { label })}
      </button>
      {error && (
        <p role="alert" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
