/** The review round never reached the agent (no turn started): its items go back to what they were (§5.3). */
export class RoundNotStarted extends Error {
  constructor(readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = "RoundNotStarted";
  }
}
