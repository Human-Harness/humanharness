import { createRequire } from "node:module";
import { type EngineDef, type ModelProfile, type ModelSpec, defaultTier } from "@humanharness/engines";
import { type LoadedHarness, SIDEKICK_PROCESS, TIERS, type Tier, resolveInHarness } from "@humanharness/harness-sdk";
import { type PickInput, modelPolicy } from "@humanharness/policies";
import type { AppConfig, ModelsView } from "@humanharness/protocol";
import { DEFAULT_PINNED_TOKENS } from "@humanharness/workspace";
import { imageDataUrl } from "./assets";
import { materialRecommended } from "./material-ipc";
import { QUESTIONS, engineOffer, offeredEffort } from "./models";
import { type ResolvedReference, usableReferences } from "./references";
import type { SharedConfigStore, SharedEngineRecord } from "./shared-config";
import { MOCK_MODEL, type TestHooks, isMockEngine, mockModels } from "./test-hooks";

const requireFromHere = createRequire(import.meta.url);

/** What the app's views read from the main entry. Getters for what changes after they are built. */
export interface AppViewsDeps {
  harness(): LoadedHarness;
  shared(): SharedConfigStore;
  hooks: TestHooks;
  /** The manifest's reference folders on this machine, resolved once the app is ready. */
  references(): Promise<ResolvedReference[]>;
  profilesOn(): boolean;
  /** The engines this app offers. */
  offered(): EngineDef[];
}

/** Settings › Modelos, the profile a turn runs on, the logos and the reference folders. */
export function createAppViews(d: AppViewsDeps) {
  const { hooks, offered } = d;
  /** Logos as data: URLs, read once. */
  const logos = new Map<string, Promise<string | null>>();

  /**
   * The reference folders usable with the working folder: one that is or contains it is left out (its
   * read-only rules would block the person's own files), with `log` saying why.
   */
  async function referencesFor(folder: string | undefined, log = false): Promise<ResolvedReference[]> {
    const refs = await d.references();
    if (!folder) return refs;
    return usableReferences(refs, folder, log ? (message) => console.error(message) : undefined);
  }

  /**
   * The reference folders the agent and `hh:openPath`/`hh:revealPath` use: those usable with the working folder `base`
   * and, with profiles, none inside the app's folder (another profile's folder never reaches them). Without profiles,
   * `referencesFor(base)` as before (D0).
   */
  async function workReferences(c: AppConfig, base: string, log = false): Promise<ResolvedReference[]> {
    if (!d.profilesOn() || !c.folder) return referencesFor(base, log);
    return usableReferences(await d.references(), base, log ? (message) => console.error(message) : undefined, c.folder);
  }

  function logo(key: string, file: () => string): Promise<string | null> {
    if (!logos.has(key)) {
      logos.set(
        key,
        (async () => {
          try {
            return await imageDataUrl(file());
          } catch {
            return null;
          }
        })(),
      );
    }
    return logos.get(key)!;
  }

  const harnessLogo = () => {
    const harness = d.harness();
    return harness.logo ? logo("harness", () => resolveInHarness(harness, harness.logo!)) : Promise.resolve(null);
  };
  // Engine logos ship in the engines package (exported as "./assets/*").
  const engineLogo = (e: EngineDef) => (e.logo ? logo(e.id, () => requireFromHere.resolve(`@humanharness/engines/${e.logo}`)) : Promise.resolve(null));

  /** What the engine was saved offering (engines.json); empty when the file can't be read. */
  const savedOffer = (engineId: string) => d.shared().engine(engineId).catch((): SharedEngineRecord => ({}));

  /** Settings › Modelos: the harness's recommendations, the core's tables and what each engine offers. */
  async function modelsView(): Promise<ModelsView> {
    const harness = d.harness();
    const engines = offered();
    const saved = await d.shared().load().catch(() => ({ version: 1 as const, engines: {} as Record<string, SharedEngineRecord> }));
    // Mock mode: a faked engine offers only the test model, and every tier uses it (effort and cap kept).
    const tierSpec = (engineId: string, tier: Tier): ModelSpec =>
      isMockEngine(hooks, engineId) ? { ...defaultTier(engineId, tier), model: MOCK_MODEL } : defaultTier(engineId, tier);
    const offer = (e: EngineDef) => {
      const real = engineOffer(e, saved.engines[e.id] ?? {});
      return isMockEngine(hooks, e.id) ? { ...real, models: mockModels() } : real;
    };
    return {
      recommended: {
        ...Object.fromEntries(Object.entries(harness.actions).map(([id, a]) => [id, a.tier ?? "standard"])),
        [QUESTIONS]: harness.questions?.tier ?? "standard",
        // Material spec §8: each AI stage is a process, only with material (D0); links only with items.
        ...(harness.material ? materialRecommended(harness.material) : {}),
        // Sidekick is a process of its own (sidekick spec §5), light by default.
        [SIDEKICK_PROCESS]: "light",
      },
      defaults: Object.fromEntries(
        engines.map((e) => [e.id, Object.fromEntries(TIERS.map((t) => [t, tierSpec(e.id, t)])) as Record<Tier, ModelSpec>]),
      ),
      offered: Object.fromEntries(engines.map((e) => [e.id, offer(e)])),
      pinnedTokens: harness.context?.pinnedTokens ?? DEFAULT_PINNED_TOKENS,
    };
  }

  /**
   * `p` with an effort its engine offers, so an unsupported one never reaches argv or CODEX_CONFIG. An engine
   * this build doesn't offer leaves `p` as it is (its turn fails on the engine check anyway).
   */
  async function supportedEffort(p: ModelProfile, saved?: SharedEngineRecord): Promise<ModelProfile> {
    const engine = offered().find((e) => e.id === p.engine);
    return engine ? offeredEffort(p, engine, saved ?? (await savedOffer(p.engine))) : p;
  }

  /**
   * The profile `input` runs on, picked by the model policy `policyId` (spec §6; config.json's, cleaned when read).
   * The offer is what the engine was saved offering: a model off its saved list (Codex) falls back before the turn,
   * then the effort is fitted as `supportedEffort` does (none for an engine this build doesn't offer: an empty list
   * fits nothing).
   */
  async function pickProfile(policyId: string | undefined, input: Omit<PickInput, "offer">): Promise<ModelProfile> {
    const saved = await savedOffer(input.engine);
    const engine = offered().find((e) => e.id === input.engine);
    return modelPolicy(policyId).pick({ ...input, offer: { models: saved.models ?? [], efforts: engine ? engineOffer(engine, saved).efforts : [] } });
  }

  return { referencesFor, workReferences, harnessLogo, engineLogo, modelsView, supportedEffort, pickProfile };
}
