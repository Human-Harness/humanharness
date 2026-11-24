export interface DiffPart {
  text: string;
  added: boolean;
}

/** What `after` adds to `before`, word by word (LCS over words and the spaces after them); removed words are dropped. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(?<=\s)/);
  const b = after.split(/(?<=\s)/);
  const norm = (w: string) => w.trim().toLowerCase();
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const parts: DiffPart[] = [];
  const push = (text: string, added: boolean) => {
    const last = parts.at(-1);
    if (last && last.added === added) last.text += text;
    else parts.push({ text, added });
  };
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && norm(a[i]) === norm(b[j])) {
      push(b[j], false);
      i++;
      j++;
    } else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else {
      push(b[j], true);
      j++;
    }
  }
  return parts;
}
