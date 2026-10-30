import type { HarnessSecret } from "@humanharness/harness-sdk";
import type { ConnectionResult, ConnectionsView } from "@humanharness/ui/client";
import type { SecretStore } from "./secret-store";

/** What a tool's call says when a key it needs isn't stored (tools spec §9, §10). Used by slice 2's tool broker. */
export const missingSecretMessage = (label: string): string => `${label} is not set — Settings › Connections`;

export interface ConnectionsDeps {
  /** The manifest's `secrets`. */
  secrets: readonly HarnessSecret[];
  store: Pick<SecretStore, "storedHarness" | "setHarness" | "deleteHarness">;
  /** Tells the window (hh:connectionsChange). */
  changed(view: ConnectionsView): void;
  log?(message: string, err?: unknown): void;
}

/**
 * Settings › Connections and the connect step in main (tools spec §9). Values go in through `set` and never come
 * out: the view says only whether each declared key is stored (S1). Only declared ids are touched (S3).
 */
export class ConnectionsController {
  constructor(private readonly d: ConnectionsDeps) {}

  async view(): Promise<ConnectionsView> {
    const stored = new Set(await this.d.store.storedHarness().catch(() => [] as string[]));
    return { connections: this.d.secrets.map((s) => ({ id: s.id, label: s.label, ...(s.help ? { help: s.help } : {}), set: stored.has(s.id) })) };
  }

  async set(id: string, value: string): Promise<ConnectionResult> {
    if (!this.declared(id)) return { ok: false, message: "This harness declares no such key" };
    // The store never logs a value; nor does this line (the error is the store's, the value stays here).
    const out = await this.d.store.setHarness(id, value).catch((err: unknown) => {
      this.log("Could not store a key", err);
      return { ok: false as const, message: "This key can't be stored" };
    });
    if (out.ok) await this.push();
    return out;
  }

  async delete(id: string): Promise<ConnectionResult> {
    if (!this.declared(id)) return { ok: false, message: "This harness declares no such key" };
    await this.d.store.deleteHarness(id);
    await this.push();
    return { ok: true };
  }

  /** Every id in `ids` is stored (a connect step's Next). An empty list is never all set (fail closed). */
  async allSet(ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) return false;
    const stored = new Set(await this.d.store.storedHarness().catch(() => [] as string[]));
    return ids.every((id) => stored.has(id));
  }

  /** A declared id, found with `some` (never an index into an object, so no prototype name is ever one). */
  private declared(id: unknown): id is string {
    return typeof id === "string" && this.d.secrets.some((s) => s.id === id);
  }
  private async push(): Promise<void> {
    try {
      this.d.changed(await this.view());
    } catch (err) {
      this.log("Could not send the connections to the window", err);
    }
  }
  private log(message: string, err?: unknown): void {
    (this.d.log ?? console.error)(message, err);
  }
}
