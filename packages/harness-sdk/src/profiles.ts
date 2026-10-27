import { z } from "zod";
import type { Collection } from "./data";
import { type InputSpec, inputFields } from "./input";

/** The collection that says who a profile is (profiles spec D7): one app-wide record in each profile's own folder. */
export const PROFILE_COLLECTION = "profile";
/** The colours an avatar can take. A `color` the window doesn't know draws the neutral avatar. */
export const PROFILE_COLORS = ["coral", "amber", "green", "teal", "blue", "violet", "pink", "gray"] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];
/** The most fields the add and edit form asks for. */
export const PROFILE_FIELDS_MAX = 6;

/** The manifest's `profiles` (spec §3). The rules that need the whole manifest are in its superRefine. */
export const profilesSchema = z.object({
  /** What the app calls one profile, singular ("student"): "Add student". */
  label: z.string().min(1).max(40),
  /** The `profile` collection's fields the add and edit form asks for, in order; `name` first. */
  fields: z.array(z.string().min(1)).min(1).max(PROFILE_FIELDS_MAX),
});
export type HarnessProfiles = z.output<typeof profilesSchema>;

/** Whether the harness has profiles; without them there is one implicit profile at the folder's root (D4). */
export const hasProfiles = (h: { profiles?: unknown }): boolean => h.profiles !== undefined;

/** The add and edit form: the listed fields of the `profile` collection, drawn by the core form. Empty without profiles. */
export function profileFormSpec(h: { profiles?: HarnessProfiles; data: Record<string, Collection> }): InputSpec {
  if (!h.profiles || !Object.hasOwn(h.data, PROFILE_COLLECTION)) return { fields: [] };
  const shape = h.data[PROFILE_COLLECTION].schema.shape as Record<string, z.ZodType>;
  const picked = Object.fromEntries(h.profiles.fields.filter((f) => Object.hasOwn(shape, f)).map((f) => [f, shape[f]]));
  return { fields: inputFields({ input: z.object(picked), schema: z.object({}) }) };
}
