// Duplicate pages at import (spec 10.3). dHash ported from BookSaver `hash.ts`.
import { normalizeLookup } from "./identity";
import { tokens, wordCount } from "./text";

export const NEAR_DUPLICATE_BITS = 3;

/** 9x8 grayscale raster (row-major, 72 values) -> 16 hex chars. */
export function dHash(pixels: ArrayLike<number>): string {
  let hash = "";
  for (let row = 0; row < 8; row++) {
    let v = 0;
    for (let col = 0; col < 8; col++) v = (v << 1) | (pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? 1 : 0);
    hash += v.toString(16).padStart(2, "0");
  }
  return hash;
}

/** RGBA pixels of a 9x8 image -> luminance raster. */
export function luminance(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) out.push(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  return out;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

type DupPage = { text: string; imageHash?: string };

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const stems = (text: string) => new Set(tokens(text).map((t) => t.stem));

export function isDuplicate(a: DupPage, b: DupPage): boolean {
  const ka = normalizeLookup(a.text);
  if (ka && ka === normalizeLookup(b.text) && wordCount(a.text) >= 8) return true;
  if (!a.imageHash || !b.imageHash || hamming(a.imageHash, b.imageHash) > NEAR_DUPLICATE_BITS) return false;
  if (wordCount(a.text) < 8 && wordCount(b.text) < 8) return true;
  return jaccard(stems(a.text), stems(b.text)) >= 0.6;
}

/** New pages that are not duplicates of the library or of each other. */
export function dropDuplicates<T extends DupPage>(existing: DupPage[], incoming: T[]): { fresh: T[]; duplicates: number } {
  const keys = new Set<string>();
  const hashed: DupPage[] = [];
  const remember = (p: DupPage) => {
    if (wordCount(p.text) >= 8) keys.add(normalizeLookup(p.text));
    if (p.imageHash) hashed.push(p);
  };
  existing.forEach(remember);
  const fresh: T[] = [];
  let duplicates = 0;
  for (const p of incoming) {
    const k = normalizeLookup(p.text);
    const dup = (wordCount(p.text) >= 8 && keys.has(k)) || (!!p.imageHash && hashed.some((h) => isDuplicate(p, h)));
    if (dup) duplicates++;
    else {
      fresh.push(p);
      remember(p);
    }
  }
  return { fresh, duplicates };
}
