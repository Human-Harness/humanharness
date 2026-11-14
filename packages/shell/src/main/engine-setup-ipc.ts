import { execFile } from "node:child_process";
import { type EngineDef, NOTICE_VERSION, getEngine } from "@humanharness/engines";
import { type LoadedHarness, hasEnginePresets } from "@humanharness/harness-sdk";
import type { ConfiguredApp, RunningSetup as SetupInfo, SetupOutput, SetupStep, TestResult, UsageSummary } from "@humanharness/protocol";
import type { PushChannel } from "@humanharness/protocol/channels";
import { profileDir } from "@humanharness/workspace";
import type { ConfigStore } from "./config";
import { testPrompt } from "./engine-check";
import { type CommandDeps, cliCommand, engineCommand, loginShellPath } from "./engine-command";
import type { EngineGuards } from "./engine-guards";
import { detectEngine } from "./engine-status";
import { copySetupStep, installCommandOf, runsInTerminal, terminalCommand } from "./install-help";
import type { Profiles } from "./profiles";
import { type RunningSetup, runSetupProcess, setupCommand } from "./setup-runner";
import { runSetupStep } from "./setup-step";
import type { SharedConfigStore } from "./shared-config";
import { type TestHooks, fakeSetupResult, isMockEngine, testEngineStatus } from "./test-hooks";
import { type UsageRecord, UsageLog, profilesUsage, recentUsage, summarizeUsage, withSpent } from "./usage-log";

const SETUP_STEPS: SetupStep[] = ["install", "update", "login", "logout"];
/** How long each setup step may run before it is stopped (a sign-in left open in the browser, a stuck download). */
const SETUP_TIMEOUT_MS: Record<SetupStep, number> = { install: 20 * 60_000, update: 20 * 60_000, login: 10 * 60_000, logout: 60_000 };

export interface EngineSetupIpcDeps {
  harness(): LoadedHarness;
  config(): ConfigStore;
  shared(): SharedConfigStore;
  quitting(): boolean;
  /** The profiles, or null without them. */
  profilesCtl(): Profiles | null;
  /** The running setup step's process, or null. */
  setupRun(): RunningSetup | null;
  setSetupRun(run: RunningSetup | null): void;
  /** Stops the translation (a reset drops the engine set-up), or nothing without one. */
  stopTranslation(): Promise<void> | undefined;
  hooks: TestHooks;
  commandDeps: CommandDeps;
  guards: EngineGuards;
  engineFor(id: unknown): EngineDef;
  hasNotice(engineId: string): Promise<boolean>;
  engineBusy(): boolean;
  dropRuntime(): Promise<void>;
  sendToWindow(channel: PushChannel, value: unknown): void;
  validConfig(): Promise<ConfiguredApp | null>;
  baseOf(c: { folder: string; profile?: string }): string;
  clipboard: { writeText(text: string): void };
  shell: { showItemInFolder(p: string): void };
}

/** The engine's status, notice, setup steps, test prompt, usage and shared config (engine setup screens). */
export function engineSetupIpc(d: EngineSetupIpcDeps) {
  const { hooks, commandDeps, guards, engineFor, hasNotice, dropRuntime, sendToWindow, validConfig, baseOf, clipboard, shell } = d;
  /** The first web address the running step printed, for a screen that reopens while it runs. */
  let setupUrl: string | undefined;
  return {
    "hh:engineStatus": async (engineId: string) => {
      const engine = engineFor(engineId);
      if (hooks.engines?.[engine.id]) return testEngineStatus(engine, await hasNotice(engine.id), hooks.engineProblem);
      return detectEngine(engine, commandDeps, d.shared());
    },
    "hh:acceptNotice": async (engineId: string) => {
      engineFor(engineId);
      await d.shared().update(engineId, { notice: { version: NOTICE_VERSION, acceptedAt: new Date().toISOString() } });
    },
    "hh:runSetup": async (engineId: string, step: SetupStep) => {
      const engine = engineFor(engineId);
      if (!SETUP_STEPS.includes(step)) throw new Error("Unknown setup step");
      // A fake engine has nothing to install or sign in to, and no real CLI may run.
      const fake = fakeSetupResult(hooks, engineId);
      if (fake) return fake;
      // A step the person runs in Terminal (OpenCode's provider picker) is never run by the app.
      if (runsInTerminal(engine, step)) return { ok: false };
      // Start and end are only reported by the call that holds the setup slot, so only it resets these.
      const output = (o: SetupOutput) => {
        if (o.kind === "start") setupUrl = undefined;
        if (o.kind === "url") setupUrl ??= o.url;
        if (o.kind === "end") {
          d.setSetupRun(null);
          setupUrl = undefined;
        }
        sendToWindow("hh:setupOutput", o);
      };
      return runSetupStep(
        {
          guards,
          hasNotice,
          currentEngine: async () => (await d.config().load()).engineId,
          isBusy: d.engineBusy,
          quitting: d.quitting,
          command: async () => {
            const cli = step === "install" ? null : await cliCommand(engine, commandDeps);
            return setupCommand(engine, step, cli, await loginShellPath(commandDeps));
          },
          dropRuntime,
          spawn: (cmd) => {
            const run = runSetupProcess(cmd, output, { timeoutMs: SETUP_TIMEOUT_MS[step] });
            d.setSetupRun(run);
            return run;
          },
          output,
        },
        engineId,
        step,
      );
    },
    "hh:getSetup": (): SetupInfo | null => {
      const s = guards.setup;
      return s ? { ...s, ...(setupUrl ? { url: setupUrl } : {}) } : null;
    },
    "hh:setupInput": (text: string) => {
      if (typeof text === "string") d.setupRun()?.write(text.slice(0, 2000));
    },
    "hh:cancelSetup": () => {
      // Remembered too, for a step whose process hasn't started yet.
      guards.cancelSetup();
      d.setupRun()?.cancel();
    },
    "hh:testEngine": async (engineId: string) => {
      const engine = engineFor(engineId);
      if (d.quitting()) throw new Error("The app is closing");
      // A second request for the same engine (the screen was reopened) gets the running test's result.
      return guards.runTest(engineId, async (signal): Promise<TestResult> => {
        if (!(await hasNotice(engineId))) return { ok: false, error: { code: "notice-required" } };
        // A fake engine is never tested against a real CLI.
        const cmd = fakeSetupResult(hooks, engineId) ? { command: [], env: {} } : await engineCommand(engine, commandDeps, { sharedPath: hasEnginePresets(d.harness()) });
        if (!cmd) return { ok: false, error: { code: "engine-not-installed" } };
        // The app may have started quitting while the CLI was being found.
        if (d.quitting() || signal.aborted) return { ok: false, error: { code: "cancelled" } };
        const result = fakeSetupResult(hooks, engineId) ? { ok: true } : await testPrompt(engine, cmd, { signal });
        if (!result.ok) return result;
        try {
          await d.shared().update(engineId, { verifiedAt: new Date().toISOString() });
        } catch (err) {
          console.error("Could not record the test prompt", err);
          return { ok: true, recorded: false };
        }
        return { ok: true };
      });
    },
    "hh:getUsage": async (): Promise<UsageSummary> => {
      const c = await validConfig();
      if (!c) return { limits: null, estimates: {}, tokens: {} };
      // A mock engine reports no limits, so it measures no window.
      const primary = isMockEngine(hooks, c.engineId) ? undefined : getEngine(c.engineId).limits?.primary;
      const engineOnly = (records: UsageRecord[]) => records.filter((r) => r.engine === c.engineId);
      // Profiles: the app's window is shared, so every profile's log counts (spec §4 "Usage").
      const profilesCtl = d.profilesCtl();
      const ids = profilesCtl && c.profile ? await profilesCtl.state().then((s) => s.list.map((p) => p.id), () => null) : null;
      // An unreadable registry: the active profile's own log, as without profiles.
      // The 30-day spend reads every line, not only the latest 500 (OpenCode; spec §4).
      const reportsCost = !isMockEngine(hooks, c.engineId) && getEngine(c.engineId).reportsCost === true;
      if (ids && c.profile) {
        const logs = await Promise.all(ids.map(async (id) => [id, engineOnly(recentUsage(await new UsageLog(profileDir(c.folder, id)).load(Infinity), 500))] as const));
        const folders = ids.map((id) => profileDir(c.folder, id));
        return withSpent(profilesUsage(Object.fromEntries(logs), c.profile, primary), folders, c.engineId, reportsCost);
      }
      return withSpent(summarizeUsage(engineOnly(recentUsage(await new UsageLog(baseOf(c)).load(Infinity), 500)), primary), [baseOf(c)], c.engineId, reportsCost);
    },
    "hh:revealSharedConfig": () => shell.showItemInFolder(d.shared().path),
    // Installing by hand: copy the official command (chosen here by engine id) and open Terminal,
    // where the user pastes it. Nothing is run for them.
    "hh:copyInstallCommand": (engineId: string) => clipboard.writeText(installCommandOf(engineFor(engineId))),
    "hh:copySetupCommand": async (engineId: string, step: unknown) => {
      if (step !== "login" && step !== "logout") throw new Error("Unknown setup step");
      await copySetupStep(engineFor(engineId), step, {
        copy: (text) => clipboard.writeText(text),
        forgetVerified: async (id) => {
          await d.shared().update(id, { verifiedAt: null });
        },
      });
    },
    "hh:openTerminal": async () => {
      const terminal = terminalCommand(process.platform);
      if (!terminal) throw new Error("No Terminal app to open here");
      await new Promise<void>((resolve, reject) => execFile(terminal.command, terminal.args, (err) => (err ? reject(err) : resolve())));
    },
    "hh:resetSharedConfig": async () => {
      // A reset drops the engine set-up: a translation run must not keep using it.
      await d.stopTranslation()?.catch((err: unknown) => console.error("Could not stop the translation", err));
      await d.shared().reset();
    },
  };
}
