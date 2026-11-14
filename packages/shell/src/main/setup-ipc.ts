import type { SetupStepResult, SetupStepsState } from "@humanharness/protocol";
import type { SetupSteps } from "./setup-steps";

const NO_SETUP_STEPS: SetupStepsState = { steps: {}, blocking: [] };
const NO_SETUP_STEP: SetupStepResult = { ok: false, reason: "unknown" };

export interface SetupIpcDeps {
  /** The harness's setup steps, or null without any. */
  setupCtl(): SetupSteps | null;
}

/**
 * The harness's setup steps (setup-steps spec §4, §5). Without any, nothing to read and every change refused (D0).
 * A call that fails (a setup.json that can't be saved, a settings write that throws) is a refusal, or the state as
 * it stands, never a thrown error.
 */
export function setupIpc(d: SetupIpcDeps) {
  const stepRefused = (err: unknown): SetupStepResult => {
    console.error("A setup step call failed", err);
    return { ok: false, reason: "not-ready" };
  };
  const stepsAsTheyStand = (err: unknown): Promise<SetupStepsState> => {
    console.error("A setup step call failed", err);
    const setupCtl = d.setupCtl();
    return setupCtl ? setupCtl.state().catch(() => NO_SETUP_STEPS) : Promise.resolve(NO_SETUP_STEPS);
  };
  return {
    "hh:setupStepsGet": () => {
      const setupCtl = d.setupCtl();
      return setupCtl ? setupCtl.state().catch(() => NO_SETUP_STEPS) : NO_SETUP_STEPS;
    },
    "hh:setupStepValues": (id: unknown) => {
      const setupCtl = d.setupCtl();
      return setupCtl ? setupCtl.values(id).catch(() => ({})) : {};
    },
    "hh:setupStepSubmit": (id: unknown, value: unknown) => {
      const setupCtl = d.setupCtl();
      return setupCtl ? setupCtl.submit(id, value).catch(stepRefused) : NO_SETUP_STEP;
    },
    "hh:setupStepComplete": (id: unknown) => {
      const setupCtl = d.setupCtl();
      return setupCtl ? setupCtl.complete(id).catch(stepRefused) : NO_SETUP_STEP;
    },
    "hh:setupStepSkip": (id: unknown) => {
      const setupCtl = d.setupCtl();
      return setupCtl ? setupCtl.skip(id).catch(stepRefused) : NO_SETUP_STEP;
    },
    "hh:setupStepsFinish": () => {
      const setupCtl = d.setupCtl();
      return setupCtl ? setupCtl.finish().catch(stepsAsTheyStand) : NO_SETUP_STEPS;
    },
    "hh:setupStepsAcknowledge": () => {
      const setupCtl = d.setupCtl();
      return setupCtl ? setupCtl.acknowledge().catch(stepsAsTheyStand) : NO_SETUP_STEPS;
    },
  };
}
