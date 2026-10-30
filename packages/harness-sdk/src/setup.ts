import { z } from "zod";
import type { Collection } from "./data";
import { type InputField, type InputSpec, inputFields } from "./input";
import { PLUGIN_LOCAL_ID } from "./plugin";
import { SECRETS_MAX } from "./secrets";
import { type HarnessSettings, inferSetting } from "./settings";

/** A setup step's id (setup-steps spec §3): it keys `.harness/setup.json`. */
export const SETUP_STEP_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** A component step's name: the key the harness registers its component under (`setupSteps: { AccountsStep }`). */
export const SETUP_COMPONENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** The most steps a harness may add to the setup screen. */
export const SETUP_STEPS_MAX = 8;

const text = z.string().min(1);
const common = {
  id: z.string().regex(SETUP_STEP_ID),
  label: text.max(80),
  /** One line under the step's heading. */
  description: text.max(300).optional(),
  /** A required step not done keeps Home on "Set up" (D5); otherwise the person may skip it. */
  required: z.boolean().default(false),
};

/** One harness setup step (spec §3). The structural rules that need the whole manifest are in its superRefine. */
export const setupStepSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("form"),
    /** A one-record app-wide collection, and the fields of it the form asks for. */
    collection: z.string().min(1).optional(),
    fields: z.array(z.string().min(1)).min(1).optional(),
    /** Or: names of the harness's settings fields. */
    settings: z.array(z.string().min(1)).min(1).optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("interview"),
    /** The action whose task runs the conversation. */
    action: z.string().min(1),
    /** The one-record collection the agent fills; the step is done once it holds a valid record. */
    writes: z.string().min(1),
  }),
  z.object({
    ...common,
    kind: z.literal("component"),
    component: z.string().regex(SETUP_COMPONENT),
    /** What the component writes, for the reader and `check`. */
    writes: z.string().min(1).optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("connect"),
    /** The declared secrets this step asks for (tools spec §9). A test tool comes with slice 2. */
    secrets: z.array(z.string().regex(PLUGIN_LOCAL_ID)).min(1).max(SECRETS_MAX),
  }),
]);
export type HarnessSetupStep = z.output<typeof setupStepSchema>;
export type SetupFormStep = Extract<HarnessSetupStep, { kind: "form" }>;

export const setupStepsSchema = z.array(setupStepSchema).min(1).max(SETUP_STEPS_MAX);

/** The harness declares setup steps. False: everything stays as before (D0). */
export const hasSetup = (h: { setup?: readonly unknown[] }): boolean => (h.setup?.length ?? 0) > 0;

/** Each interview step's action and the collection it writes ({} without interviews). */
export function interviewCollections(h: { setup?: readonly HarnessSetupStep[] }): Record<string, string> {
  return Object.fromEntries((h.setup ?? []).flatMap((s) => (s.kind === "interview" ? [[s.action, s.writes]] : [])));
}

/**
 * The form a `form` step draws (spec §3): the collection's chosen fields as the input-block form infers them, or the
 * settings' fields with their labels and option labels. Unknown names are left out (the manifest refuses them).
 */
export function setupFormSpec(step: SetupFormStep, h: { data: Record<string, Collection>; settings?: HarnessSettings }): InputSpec {
  if (step.settings) {
    const fields = h.settings?.fields ?? {};
    return {
      fields: step.settings
        .filter((name) => Object.hasOwn(fields, name))
        .map((name): InputField => {
          const f = fields[name];
          return { ...inferSetting(f.schema), name, label: f.label, optional: false, ...(f.options ? { optionLabels: { ...f.options } } : {}) };
        }),
    };
  }
  const c = step.collection !== undefined && Object.hasOwn(h.data, step.collection) ? h.data[step.collection] : undefined;
  const shape = (c?.schema.shape ?? {}) as Record<string, z.ZodType>;
  const picked = Object.fromEntries((step.fields ?? []).filter((f) => Object.hasOwn(shape, f)).map((f) => [f, shape[f]]));
  return { fields: inputFields({ input: z.object(picked), schema: z.object({}) }) };
}
