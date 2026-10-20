export type Vec = Map<string, number>;

/** Build TF-IDF vectors for a list of documents given as stem arrays. */
export function tfidf(docs: string[][]): { vecs: Vec[]; idf: Map<string, number> } {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((1 + n) / (1 + c)) + 1);
  const vecs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v: Vec = new Map();
    for (const [t, c] of tf) v.set(t, (c / Math.max(1, d.length)) * (idf.get(t) ?? 1));
    return v;
  });
  return { vecs, idf };
}

export function norm(v: Vec): number {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s);
}

export function cosine(a: Vec, b: Vec): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  let dot = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, x] of small) {
    const y = big.get(t);
    if (y) dot += x * y;
  }
  return dot / (na * nb);
}

export function centroid(vs: Vec[]): Vec {
  const c: Vec = new Map();
  for (const v of vs) for (const [t, x] of v) c.set(t, (c.get(t) ?? 0) + x);
  if (vs.length) for (const [t, x] of c) c.set(t, x / vs.length);
  return c;
}

export function sum(v: Vec): number {
  let s = 0;
  for (const x of v.values()) s += x;
  return s;
}
