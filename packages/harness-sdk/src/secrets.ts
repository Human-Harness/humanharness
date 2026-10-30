import { z } from "zod";
import { HIDDEN_CHARS, PLUGIN_LOCAL_ID } from "./plugin";

/** The most keys a harness declares (as a plugin's `permissions.secrets`). */
export const SECRETS_MAX = 10;
/** One English line the person reads in Settings › Connections: no line break, no hidden character. */
const shown = (max: number) =>
  z.string().min(1).max(max).refine((t) => !/[\r\n]/.test(t) && !HIDDEN_CHARS.test(t), { message: "One line, without hidden characters" });

/** A key the person pastes for the harness's tools (tools spec §9, D9). Its value never reaches a renderer or a tool. */
export const harnessSecretSchema = z.strictObject({ id: z.string().regex(PLUGIN_LOCAL_ID), label: shown(80), help: shown(200).optional() });
export type HarnessSecret = z.output<typeof harnessSecretSchema>;

export const secretsSchema = z
  .array(harnessSecretSchema)
  .min(1)
  .max(SECRETS_MAX)
  .refine((list) => new Set(list.map((s) => s.id)).size === list.length, { message: "Each secret id is declared once" });

/** The harness declares secrets. False: no Connections tab, no channel, no harness key folder (D0). */
export const hasSecrets = (h: { secrets?: readonly unknown[] }): boolean => (h.secrets?.length ?? 0) > 0;
