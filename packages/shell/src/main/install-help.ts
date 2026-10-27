import type { EngineDef } from "@humanharness/engines";
import type { EngineOption, SetupStep } from "@humanharness/ui/client";

/**
 * The engine's official install command, for the user to copy and run themselves. Only this text is
 * ever copied: the window names the engine, never the text.
 */
export function installCommandOf(engine: EngineDef): string {
  const command = engine.setup?.install?.command;
  if (!command) throw new Error(`${engine.id} has no install command`);
  return command;
}

/**
 * How to open Terminal so the user can paste the install command: the app only opens it and runs
 * nothing in it. Null where there is no Terminal app to open (only macOS is supported).
 */
export function terminalCommand(platform: NodeJS.Platform): { command: string; args: string[] } | null {
  return platform === "darwin" ? { command: "/usr/bin/open", args: ["-a", "Terminal"] } : null;
}

/** Whether the person runs this step in Terminal (OpenCode's provider picker): the app never runs it. */
export function runsInTerminal(engine: EngineDef, step: SetupStep): boolean {
  return (step === "login" || step === "logout") && engine.setup?.inTerminal?.includes(step) === true;
}

/** The command for a step the person runs in Terminal: the binary's name and the step's args, never a path. */
export function setupCommandText(engine: EngineDef, step: "login" | "logout"): string {
  const setup = engine.setup;
  if (!setup || !runsInTerminal(engine, step)) throw new Error(`${engine.id} runs ${step} itself`);
  return [engine.detect.binary, ...setup[step]].join(" ");
}

/** What the window learns beyond the common fields; empty for engines without these facts (D0). */
export function engineOptionExtras(
  engine: EngineDef,
): Pick<EngineOption, "reportsCost" | "userProvider" | "providersUrl" | "terminalSteps"> {
  const setup = engine.setup;
  const steps = Object.fromEntries((setup?.inTerminal ?? []).map((s) => [s, setupCommandText(engine, s)]));
  return {
    ...(engine.reportsCost ? { reportsCost: true } : {}),
    ...(setup?.providersUrl ? { userProvider: true, providersUrl: setup.providersUrl } : {}),
    ...(Object.keys(steps).length ? { terminalSteps: steps } : {}),
  };
}
