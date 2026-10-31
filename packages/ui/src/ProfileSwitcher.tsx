import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppState, HarnessClient, ProfileResult, ProfileView, ProfilesState } from "./client";
import { AVATAR_COLORS } from "./profiles";

/** An avatar's letter: the title's first character (a whole code point), upper-cased. */
const initialOf = (title: string): string => [...title.trim()][0]?.toUpperCase() ?? "";

/** An avatar's colour: only one we draw; anything else is neutral. */
const knownColor = (color: string | undefined): string | undefined => (color && (AVATAR_COLORS as readonly string[]).includes(color) ? color : undefined);

/** A profile's avatar (spec D7): the title's first letter on its colour; neutral when the colour is not one we draw. */
export function Avatar({ profile }: { profile: Pick<ProfileView, "title" | "color"> }) {
  return (
    <span className="hh-avatar" data-color={knownColor(profile.color)} aria-hidden="true">
      {initialOf(profile.title)}
    </span>
  );
}

/** A stored title on one line: it isn't cleaned again when read, so it may hold line breaks or runs of spaces. */
export const shownTitle = (title: string): string => title.replace(/\s+/g, " ").trim();

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

/**
 * The top bar's profile avatar (UI refresh spec §4.1): the active profile's initial on its colour, opening the
 * switcher under it. Shown only in a harness with profiles (Q2).
 */
export function ProfileAvatar({
  client,
  state,
  onSwitched,
  onAdd,
  disabled = false,
}: {
  client: HarnessClient;
  state: AppState;
  onSwitched: (state: AppState) => void;
  onAdd: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const profiles = useProfiles(client, state.profiles !== undefined);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!state.profiles || !profiles) return null;
  const label = state.profiles.label;
  const active = profiles.list.find((p) => p.id === profiles.active && !p.archived);
  const color = knownColor(active?.color);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    setOpen(false);
    button.current?.focus();
  };
  const onBlur = (e: FocusEvent) => {
    if (open && e.relatedTarget instanceof Node && !wrap.current?.contains(e.relatedTarget)) setOpen(false);
  };
  return (
    <div className="hh-avatar-menu" ref={wrap} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="hh-avatar hh-avatar-button"
        data-color={color}
        aria-label={active ? t("profiles.avatar", { name: shownTitle(active.title) }) : t("profiles.pick", { label })}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-switcher` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {active ? initialOf(active.title) : ""}
      </button>
      {open && (
        <div id={`${id}-switcher`} className="hh-pl-popover hh-avatar-popover" role="dialog" aria-label={t("profiles.pick", { label })}>
          <ProfileSwitcher client={client} state={state} onSwitched={onSwitched} onAdd={onAdd} disabled={disabled} />
        </div>
      )}
    </div>
  );
}
