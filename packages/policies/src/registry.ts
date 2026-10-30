import { DefaultModelPolicy, type ModelPolicy } from "./model";

/** The id every task runs when config.json names none (spec §8). */
export const DEFAULT_POLICY = "default";
const MODEL_POLICIES: ReadonlyMap<string, ModelPolicy> = new Map([[DefaultModelPolicy.id, DefaultModelPolicy]]);
/** Context policies arrive with plan 4; only the default exists until then. */
const CONTEXT_POLICY_IDS: ReadonlySet<string> = new Set([DEFAULT_POLICY]);

export const isModelPolicyId = (id: unknown): id is string => typeof id === "string" && MODEL_POLICIES.has(id);
export const isContextPolicyId = (id: unknown): id is string => typeof id === "string" && CONTEXT_POLICY_IDS.has(id);
/** The policy named `id`; an absent or unknown one runs the default. */
export const modelPolicy = (id: string | undefined): ModelPolicy => (id !== undefined && MODEL_POLICIES.get(id)) || DefaultModelPolicy;
