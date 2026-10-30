// No Node imports: every tool's sandbox bundle includes this file (tools spec D2).
import { z } from "zod";
export { z };

/** What a refused `ctx` call throws (tools spec §4.2): `name` is "ToolRefused", `message` the reason. */
export interface ToolRefusedError extends Error {
  name: "ToolRefused";
}

/** What a tool may reach (tools spec D7, §3.1). Anything not declared here answers `ToolRefused`. */
export interface ToolUses {
  /** Host patterns (as a plugin's `permissions.hosts`): needs the harness's `web`. */
  hosts?: string[];
  /** Ids of the harness's `secrets`, named as `{{secret:<id>}}` in a fetch's headers or body. */
  secrets?: string[];
  /** Command patterns (as a plugin's `permissions.exec`): needs the harness's `exec`. */
  exec?: { cmd: string; args: string[] }[];
  /** The harness's collections this tool reads and writes. */
  data?: { read?: string[]; write?: string[] };
  /** `"read"`: the person's folder and its references (`"write"` comes in a later slice). */
  files?: "read" | "write";
}

export interface ToolResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text(): string;
  json(): unknown;
}

/** The only way a tool reaches the world (tools spec D2, §4.2). Each call is checked against the tool's `uses`. */
export interface ToolContext {
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<ToolResponse>;
  exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  data: {
    get(collection: string, key?: string | number): Promise<Record<string, unknown> | null>;
    query(
      collection: string,
      q?: { where?: Record<string, unknown>; fields?: string[]; limit?: number },
    ): Promise<{ records: Record<string, unknown>[]; total: number }>;
    put(collection: string, record: Record<string, unknown>): Promise<void>;
    patch(collection: string, key: string | number | undefined, patch: Record<string, unknown>): Promise<void>;
    delete(collection: string, key?: string | number): Promise<void>;
  };
  files: { read(path: string): Promise<string>; list(dir: string, glob?: string): Promise<string[]> };
  /** The scope of the calling task or job run, or null. */
  scope: string | null;
  /** The results named by the step's input (tools spec §6, §7); {} for a call that isn't a step. Frozen. */
  readonly inputs: Readonly<Record<string, unknown>>;
  log(level: "info" | "warn" | "error", message: string): void;
  /** Sets the job run's summary line (tools spec §7.4); the last one of a run counts. Ignored outside a job run. */
  summary(text: string): Promise<void>;
  /**
   * Asks the runner for another AI round with `input` as its data (tools spec §7.3). Only in a job's post-step, once
   * per call, at most 1 MB of JSON; the round runs after this call returns. Throws ToolRefused anywhere else.
   */
  requestAi(input: unknown): Promise<void>;
}

export interface ToolDefinition<P extends z.ZodObject = z.ZodObject, R extends z.ZodType = z.ZodType> {
  description: string;
  params: P;
  returns?: R;
  agent: "call" | "none";
  uses: ToolUses;
  /** Seconds, 1–120; default 30. */
  timeout?: number;
  /** One line for the trace; default a generic one ("12 items"). */
  summary?(result: z.output<R>): string;
  run(args: z.output<P>, ctx: ToolContext): Promise<z.output<R>>;
}

type ToolInput<P extends z.ZodObject, R extends z.ZodType> = Omit<ToolDefinition<P, R>, "agent" | "uses"> & {
  agent?: "call" | "none";
  uses?: ToolUses;
};

/** A tool file's default export (tools spec §3.1). `humanharness build` reads it; the app never imports it. */
export function defineTool<P extends z.ZodObject, R extends z.ZodType = z.ZodType>(d: ToolInput<P, R>): ToolDefinition<P, R> {
  if (d.timeout !== undefined && (!Number.isInteger(d.timeout) || d.timeout < 1 || d.timeout > 120)) {
    throw new Error("timeout is a whole number of seconds from 1 to 120");
  }
  return { ...d, agent: d.agent ?? "call", uses: d.uses ?? {} };
}
