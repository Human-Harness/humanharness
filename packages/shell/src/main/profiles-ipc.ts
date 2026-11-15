import type { AppState, ProfileResult, ProfilesState } from "@humanharness/protocol";
import { type ProfileOutcome, type Profiles, profileResult } from "./profiles";

const NO_PROFILES: ProfilesState = { active: null, list: [] };

export interface ProfilesIpcDeps {
  /** The profiles, or null without them. */
  profilesCtl(): Profiles | null;
  appState(): Promise<AppState>;
  /** The last app state read. */
  lastAppState(): AppState | null;
}

/** Profiles (profiles spec §5). Without them, nothing to read and every change refused (D4). Refusals come back as data. */
export function profilesIpc(d: ProfilesIpcDeps) {
  const { appState } = d;
  const profileAnswer = (outcome: Promise<ProfileOutcome>): Promise<ProfileResult> =>
    profileResult(
      outcome,
      appState,
      () => d.lastAppState(),
      async () => {
        const profilesCtl = d.profilesCtl();
        return profilesCtl ? (await profilesCtl.state()).active : null;
      },
    );
  const noProfiles = (): ProfileResult => ({ ok: false, reason: "not-ready" });
  return {
    "hh:profilesGet": () => {
      const profilesCtl = d.profilesCtl();
      return profilesCtl ? profilesCtl.state().catch(() => NO_PROFILES) : NO_PROFILES;
    },
    "hh:profileCreate": (values: unknown) => {
      const profilesCtl = d.profilesCtl();
      return profilesCtl ? profileAnswer(profilesCtl.create(values)) : noProfiles();
    },
    "hh:profileOpen": (id: unknown) => {
      const profilesCtl = d.profilesCtl();
      return profilesCtl ? profileAnswer(profilesCtl.open(id)) : noProfiles();
    },
    "hh:profileArchive": (id: unknown, archived: unknown) => {
      const profilesCtl = d.profilesCtl();
      return profilesCtl && typeof archived === "boolean" ? profileAnswer(profilesCtl.setArchived(id, archived)) : noProfiles();
    },
    "hh:profileEdit": (values: unknown) => {
      const profilesCtl = d.profilesCtl();
      return profilesCtl ? profileAnswer(profilesCtl.edit(values)) : noProfiles();
    },
    "hh:profileDelete": (id: unknown) => {
      const profilesCtl = d.profilesCtl();
      return profilesCtl ? profileAnswer(profilesCtl.remove(id)) : noProfiles();
    },
  };
}
