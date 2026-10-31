import { type ContextPolicy, DefaultContextPolicy } from "./context";
import { DefaultModelPolicy, type ModelPolicy } from "./model";

/** The id every task runs when config.json names none (spec §8). */
export const DEFAULT_POLICY = "default";
const MODEL_POLICIES = new Map<string, ModelPolicy>([[DefaultModelPolicy.id, DefaultModelPolicy]]);
const CONTEXT_POLICIES = new Map<string, ContextPolicy>([[DefaultContextPolicy.id, DefaultContextPolicy]]);

/** Adds `policy` under its id; the returned function removes it again. An id that exists already throws. */
function register<P extends { id: string }>(map: Map<string, P>, kind: string, policy: P): () => void {
  if (map.has(policy.id)) throw new Error(`A ${kind} policy "${policy.id}" exists already`);
  map.set(policy.id, policy);
  return () => {
    if (map.get(policy.id) === policy) map.delete(policy.id);
  };
}

/** Makes a model policy selectable from config.json like a built-in one (variants and tests). */
export const registerModelPolicy = (policy: ModelPolicy): (() => void) => register(MODEL_POLICIES, "model", policy);
/** Makes a context policy selectable from config.json like a built-in one (variants and tests). */
export const registerContextPolicy = (policy: ContextPolicy): (() => void) => register(CONTEXT_POLICIES, "context", policy);

export const isModelPolicyId = (id: unknown): id is string => typeof id === "string" && MODEL_POLICIES.has(id);
export const isContextPolicyId = (id: unknown): id is string => typeof id === "string" && CONTEXT_POLICIES.has(id);
/** The policy named `id`; an absent or unknown one runs the default. */
export const modelPolicy = (id: string | undefined): ModelPolicy => (id !== undefined && MODEL_POLICIES.get(id)) || DefaultModelPolicy;
/** The context policy named `id`; an absent or unknown one runs the default. */
export const contextPolicy = (id: string | undefined): ContextPolicy => (id !== undefined && CONTEXT_POLICIES.get(id)) || DefaultContextPolicy;
