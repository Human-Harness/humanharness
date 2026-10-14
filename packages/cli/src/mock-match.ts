/**
 * The other actions whose brief contains `match`, so replay could pick this action's recording for them.
 * Replay picks the longest `match` found in a task's first message, so an action whose own (longer) match
 * is in its brief is safe. `matchOf` gives each other action's recording match, if it has one.
 */
export function matchClashes(action: string, match: string, briefs: Map<string, string | null | undefined>, matchOf: (action: string) => string | undefined): string[] {
  const clashes: string[] = [];
  for (const [other, text] of briefs) {
    if (other === action || !text?.includes(match)) continue;
    const own = matchOf(other);
    if (own !== undefined && own.length > match.length && text.includes(own)) continue;
    clashes.push(other);
  }
  return clashes;
}

export const clashMessage = (match: string, other: string) => `"${match}" also appears in the brief of "${other}", so replay could pick the wrong recording.`;
