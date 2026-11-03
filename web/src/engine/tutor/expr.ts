// Safe math expressions for the plot block (spec 15.2). A small parser, never eval, so a model or
// a pasted formula can only ever produce numbers. Used by the web chat and the MCP widget bundle.

type Node =
  | { k: "num"; v: number }
  | { k: "var"; n: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { k: "call"; f: string; args: Node[] };

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

const FN: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

export class ExprError extends Error {}

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`bad number at ${i}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if ("+-*/^(),".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new ExprError(`unexpected "${c}"`);
    }
  }
  return out;
}

function parse(src: string): Node {
  if (src.length > 200) throw new ExprError("too long");
  const toks = tokenize(src.replace(/\*\*/g, "^"));
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek().v === v;
  const eat = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected "${v}"`);
    p++;
  };
  const sum = (): Node => {
    if (++depth > 40) throw new ExprError("too deep");
    let a = product();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: "+" | "-" }).v;
      a = { k: "bin", op, a, b: product() };
    }
    depth--;
    return a;
  };
  const startsAtom = () => peek() && (peek().t !== "op" || peek().v === "(");
  const product = (): Node => {
    let a = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (toks[p++] as { v: "*" | "/" }).v;
        a = { k: "bin", op, a, b: unary() };
      } else if (startsAtom()) {
        // Implied multiplication: 2x, 3(x+1), x sin(x).
        a = { k: "bin", op: "*", a, b: power() };
      } else {
        return a;
      }
    }
  };
  const unary = (): Node => {
    if (isOp("-")) {
      p++;
      return { k: "neg", a: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): Node => {
    const base = atom();
    if (isOp("^")) {
      p++;
      return { k: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  };
  const atom = (): Node => {
    const t = peek();
    if (!t) throw new ExprError("unexpected end");
    if (t.t === "num") {
      p++;
      return { k: "num", v: t.v };
    }
    if (t.t === "id") {
      p++;
      if (isOp("(")) {
        if (!Object.hasOwn(FN, t.v)) throw new ExprError(`unknown function ${t.v}`);
        p++;
        const args = [sum()];
        while (isOp(",")) {
          p++;
          args.push(sum());
        }
        eat(")");
        return { k: "call", f: t.v, args };
      }
      return { k: "var", n: t.v };
    }
    if (t.v === "(") {
      p++;
      const a = sum();
      eat(")");
      return a;
    }
    throw new ExprError(`unexpected "${t.v}"`);
  };
  const out = sum();
  if (p !== toks.length) throw new ExprError("trailing input");
  return out;
}

function run(n: Node, env: Record<string, number>): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "var":
      return Object.hasOwn(env, n.n) ? env[n.n] : CONSTS[n.n];
    case "neg":
      return -run(n.a, env);
    case "call":
      return FN[n.f](...n.args.map((a) => run(a, env)));
    case "bin": {
      const a = run(n.a, env);
      const b = run(n.b, env);
      if (n.op === "+") return a + b;
      if (n.op === "-") return a - b;
      if (n.op === "*") return a * b;
      if (n.op === "/") return a / b;
      return Math.pow(a, b);
    }
  }
}

function names(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === "var") out.add(n.n);
  if (n.k === "neg") names(n.a, out);
  if (n.k === "bin") {
    names(n.a, out);
    names(n.b, out);
  }
  if (n.k === "call") n.args.forEach((a) => names(a, out));
  return out;
}

export type Compiled = { eval: (env: Record<string, number>) => number; vars: string[] };

/** Parses once; throws ExprError on bad syntax. `vars` lists free names that are not constants. */
export function compile(src: string): Compiled {
  const tree = parse(src);
  return { eval: (env) => run(tree, env), vars: [...names(tree)].filter((v) => !Object.hasOwn(CONSTS, v)) };
}

/** The error for an expression given the names it may use, or null when it is fine. */
export function checkExpr(src: string, allowed: string[]): string | null {
  try {
    const free = compile(src).vars.filter((v) => !allowed.includes(v));
    return free.length ? `unknown name ${free[0]}` : null;
  } catch (e) {
    return e instanceof ExprError ? e.message : "bad expression";
  }
}

export type Seg = { x: number; y: number }[];

/** Samples into unbroken segments: a gap at each non-finite value or vertical asymptote. */
export function sample(c: Compiled, x: string, from: number, to: number, env: Record<string, number>, n = 320, clip = Infinity): Seg[] {
  const segs: Seg[] = [];
  let cur: Seg = [];
  let prev: number | null = null;
  const jump = clip === Infinity ? Infinity : clip * 2;
  for (let i = 0; i <= n; i++) {
    const xv = from + ((to - from) * i) / n;
    const y = c.eval({ ...env, [x]: xv });
    if (!Number.isFinite(y) || (prev !== null && Math.abs(y - prev) > jump)) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
      prev = Number.isFinite(y) ? y : null;
      if (Number.isFinite(y)) cur.push({ x: xv, y });
      continue;
    }
    cur.push({ x: xv, y });
    prev = y;
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

/** A readable y window from the finite samples: robust to spikes near an asymptote. */
export function autoRange(values: number[]): [number, number] {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return [-1, 1];
  const lo = v[Math.floor(v.length * 0.02)];
  const hi = v[Math.ceil(v.length * 0.98) - 1];
  if (lo === hi) return [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** About `count` round tick values across a range. */
export function ticks(lo: number, hi: number, count = 6): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(10)));
  return out;
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "undefined";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(2);
  return String(Number(v.toFixed(3)));
}
