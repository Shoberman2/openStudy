// Answer checking (spec 5.3).
import { normalizeAnswer } from "./text";

export type Verdict = "correct" | "close" | "wrong";

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Typed answer vs one or more accepted answers. */
export function checkTyped(input: string, accepted: string | string[]): Verdict {
  const user = normalizeAnswer(input);
  if (!user) return "wrong";
  let best: Verdict = "wrong";
  for (const a of Array.isArray(accepted) ? accepted : [accepted]) {
    const target = normalizeAnswer(a);
    if (!target) continue;
    if (user === target) return "correct";
    const tol = Math.max(1, Math.floor(target.length * 0.15));
    if (levenshtein(user, target) <= tol) best = "close";
  }
  return best;
}

export type DiffToken = { word: string; status: "ok" | "missing" | "extra" };

function rawWords(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Word-level LCS between user and target quote, with a renderable diff. */
export function scoreQuote(input: string, target: string): { ratio: number; verdict: Verdict; diff: DiffToken[] } {
  const tRaw = rawWords(target);
  const t = tRaw.map((w) => normalizeAnswer(w) || w.toLowerCase());
  const uRaw = rawWords(input);
  const u = uRaw.map((w) => normalizeAnswer(w) || w.toLowerCase());
  const n = t.length;
  const m = u.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = t[i] === u[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lcs = dp[0][0];
  const diff: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && t[i] === u[j]) {
      diff.push({ word: tRaw[i], status: "ok" });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      diff.push({ word: uRaw[j], status: "extra" });
      j++;
    } else {
      diff.push({ word: tRaw[i], status: "missing" });
      i++;
    }
  }
  // Extra words also dilute the score so pasting noise cannot pass.
  const ratio = n ? lcs / Math.max(n, m * 0.9) : 0;
  const verdict: Verdict = ratio >= 0.9 ? "correct" : ratio >= 0.75 ? "close" : "wrong";
  return { ratio, verdict, diff };
}
