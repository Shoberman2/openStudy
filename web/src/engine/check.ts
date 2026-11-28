// Answer checking (spec 5.3).
import { isCode, typedCodeTokens } from "./code";
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
const MAGNITUDE: Record<string, number> = { k: 1e3, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const QUANTITY = /^(?:about|around|roughly|approximately|approx\.?|nearly|almost|~)?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(k|thousand|million|billion|trillion)?(?![a-z])\s*([a-z%][a-z% ]*)?\.?$/i;

/**
 * A number with a unit or a size word ("About 238,900 miles", "8 billion people"), or null.
 * A bare number such as a year is not a quantity, so it keeps exact checking.
 */
export function quantity(s: string): { n: number; unit: string } | null {
  const m = s.trim().match(QUANTITY);
  if (!m) return null;
  const unit = (m[3] ?? "").trim().toLowerCase();
  if (!unit && !m[2]) return null;
  if (unit.split(/\s+/).length > 3) return null;
  const n = parseFloat(m[1].replace(/,/g, "")) * (MAGNITUDE[(m[2] ?? "").toLowerCase()] ?? 1);
  return Number.isFinite(n) ? { n, unit } : null;
}

/** Typed numbers for a quantity: within 2% is right, within 10% is close. A different unit is wrong. */
function checkQuantity(input: string, target: { n: number; unit: string }): Verdict | null {
  const m = input.trim().match(QUANTITY);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, "")) * (MAGNITUDE[(m[2] ?? "").toLowerCase()] ?? 1);
  if (!Number.isFinite(n)) return null;
  const unit = (m[3] ?? "").trim().toLowerCase();
  if (unit && target.unit && unit.split(/\s+/)[0].replace(/s$/, "") !== target.unit.split(/\s+/)[0].replace(/s$/, "")) return "wrong";
  const off = target.n === 0 ? Math.abs(n) : Math.abs(n - target.n) / Math.abs(target.n);
  return off <= 0.02 ? "correct" : off <= 0.1 ? "close" : "wrong";
}

export function checkTyped(input: string, accepted: string | string[]): Verdict {
  const user = normalizeAnswer(input);
  if (!user && !input.trim()) return "wrong";
  let best: Verdict = "wrong";
  for (const a of Array.isArray(accepted) ? accepted : [accepted]) {
    if (isCode(a)) {
      const u = typedCodeTokens(input);
      const t = typedCodeTokens(a);
      if (!u.length || u.length !== t.length) continue;
      if (u.every((token, i) => token === t[i])) return "correct";
      // Keep the existing case hint for standalone constants. An altered call or argument is wrong.
      if (t.length === 1 && u[0].toLowerCase() === t[0].toLowerCase()) best = "close";
      continue;
    }
    const q = quantity(a);
    const qv = q ? checkQuantity(input, q) : null;
    if (qv === "correct") return "correct";
    if (qv) {
      if (qv === "close") best = "close";
      continue;
    }
    const target = normalizeAnswer(a);
    if (!target || !user) continue;
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
