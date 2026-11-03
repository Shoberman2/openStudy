// Runs inside the host's iframe (spec 15.7). Vanilla DOM on purpose: one inline file with no React.
// Speaks the MCP Apps ui/* bridge and falls back to window.openai. All text goes through textContent.
import katex from "katex";
import { adaptiveFollowups, nextLevel, readAttempts, type Attempt } from "@/engine/tutor/adaptive";
import type { DiagramBlock, FlashcardsBlock, PlotBlock, Question, RenderBlock, StepsBlock } from "@/engine/tutor/blocks";
import { autoRange, compile, fmt, sample, ticks } from "@/engine/tutor/expr";
import { inline, prose, type Inline } from "@/engine/tutor/prose";

type Payload =
  | { kind: "quiz"; quiz: { title: string; concept: string; questions: Question[]; levelReason?: string }; attempts?: Attempt[]; notice?: string }
  | { kind: "flashcards"; flashcards: FlashcardsBlock; notice?: string }
  | { kind: "explanation"; blocks: RenderBlock[]; notice?: string };

type OpenAi = {
  toolOutput?: unknown;
  theme?: string;
  callTool?: (name: string, args: unknown) => Promise<{ structuredContent?: unknown }>;
  sendFollowUpMessage?: (o: { prompt: string }) => Promise<void>;
};
const host = () => (window as unknown as { openai?: OpenAi }).openai;
const root = document.getElementById("root")!;

/* ---------- bridge ---------- */
let seq = 1;
const pending = new Map<number, (v: unknown) => void>();
function rpc(method: string, params: unknown): Promise<unknown> {
  const id = seq++;
  window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  return new Promise((res, rej) => {
    pending.set(id, res);
    setTimeout(() => {
      if (pending.delete(id)) rej(new Error("timeout"));
    }, 15000);
  });
}
const notify = (method: string, params: unknown = {}) => window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");

async function callTool(name: string, args: unknown): Promise<unknown> {
  const o = host();
  if (o?.callTool) return (await o.callTool(name, args)).structuredContent;
  const r = (await rpc("tools/call", { name, arguments: args })) as { structuredContent?: unknown };
  return r.structuredContent;
}
function sendMessage(text: string) {
  const o = host();
  if (o?.sendFollowUpMessage) void o.sendFollowUpMessage({ prompt: text });
  else void rpc("ui/message", { role: "user", content: [{ type: "text", text }] }).catch(() => {});
}
function resized() {
  notify("ui/notifications/size-changed", { height: document.documentElement.scrollHeight });
}

/* ---------- dom ---------- */
type Kid = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}
function button(label: string, cls: string, on: () => void): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  b.onclick = on;
  return b;
}
function math(latex: string, display = false): HTMLElement {
  const s = el("span");
  // KaTeX escapes its input and trust is off. MathML output needs no stylesheet.
  s.innerHTML = katex.renderToString(latex, { output: "mathml", displayMode: display, throwOnError: false, trust: false, strict: "ignore" });
  return s;
}
function runs(parts: Inline[]): Node[] {
  return parts.map((p) => {
    if (p.k === "bold") return el("strong", "", ...runs(inline(p.v)));
    if (p.k === "code") return el("code", "mono", p.v);
    if (p.k === "math") return math(p.v);
    return document.createTextNode(p.v);
  });
}
const line = (tag: "p" | "span" | "div", cls: string, text: string) => el(tag, cls, ...runs(inline(text)));
function md(text: string): HTMLElement {
  const box = el("div", "stack");
  for (const p of prose(text)) {
    if (p.k === "p") box.append(el("p", "", ...runs(p.inline)));
    else if (p.k === "math") box.append(math(p.latex, true));
    else box.append(el(p.k, "", ...p.items.map((it) => el("li", "", ...runs(it)))));
  }
  return box;
}
function show(...nodes: Node[]) {
  root.replaceChildren(...nodes);
  resized();
}

/* ---------- quiz ---------- */
function quiz(p: Extract<Payload, { kind: "quiz" }>) {
  const { questions, title, concept, levelReason } = p.quiz;
  let attempts = readAttempts(p.attempts);
  let at = 0;
  let right = 0;
  let missed: string | undefined;

  const ask = () => {
    const q = questions[at];
    if (!q) return finish();
    let picked: string | null = null;
    const head = el("div", "", el("div", "between", el("h2", "", title), el("span", "mono m s", `${at + 1} of ${questions.length} · level ${q.difficulty}`)), at === 0 && levelReason ? el("p", "m s", levelReason) : null);
    const stem = line("p", "", q.stem);
    const check = button("Check answer", "pill", grade);
    check.disabled = true;
    const list = el("div", "stack");
    list.style.gap = "8px";
    const buttons = q.options.map((o) => {
      const b = el("button", "choice", ...runs(inline(o.text)));
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.onclick = () => {
        picked = o.id;
        check.disabled = false;
        buttons.forEach((x, i) => x.setAttribute("aria-pressed", String(q.options[i].id === o.id)));
      };
      return b;
    });
    list.append(...buttons.map((b) => el("div", "", b)));
    const foot = el("div", "row", check);
    function grade() {
      const o = q.options.find((x) => x.id === picked)!;
      if (o.correct) right++;
      else missed = q.stem;
      attempts = [...attempts, { concept: q.concept, difficulty: q.difficulty, correct: o.correct, at: new Date().toISOString() }];
      q.options.forEach((opt, i) => {
        const b = buttons[i];
        b.disabled = true;
        if (opt.correct) b.classList.add("right");
        else if (opt.id === picked) b.classList.add("wrong");
        b.parentElement!.append(line("p", "why", opt.explanation));
      });
      at++;
      foot.replaceChildren(button(at < questions.length ? "Next question" : "See result", "pill", ask));
      resized();
      // Keeps the host's copy of mastery in step; the widget works without it.
      void callTool("grade_answer", { question: q, selected: o.id, attempts }).catch(() => {});
    }
    show(el("div", "stack", head, stem, list, foot, notice(p.notice)));
  };

  const finish = () => {
    const list = attempts.filter((a) => a.concept.toLowerCase() === concept.toLowerCase());
    const level = nextLevel(list);
    const next = adaptiveFollowups(concept, list, missed);
    show(
      el(
        "div",
        "stack",
        el("h2", "", `${right} of ${questions.length} right`),
        el("p", "m", level.reason),
        el("div", "row", ...next.items.map((f, i) => button(f.label, i ? "pill ghost" : "pill", () => sendMessage(f.prompt)))),
      ),
    );
  };
  ask();
}

/* ---------- flashcards ---------- */
function flashcards(block: FlashcardsBlock, note?: string, into?: HTMLElement) {
  let queue = block.cards;
  let at = 0;
  let back = false;
  let missed: FlashcardsBlock["cards"] = [];
  const box = into ?? el("div");
  const paint = () => {
    const c = queue[at];
    if (!c) {
      box.replaceChildren(
        el(
          "div",
          "stack",
          el("h2", "", "Round done"),
          el(
            "div",
            "row",
            missed.length
              ? button(`Review ${missed.length} missed`, "pill", () => {
                  queue = missed;
                  missed = [];
                  at = 0;
                  paint();
                })
              : null,
            button("Start over", "pill ghost", () => {
              queue = block.cards;
              missed = [];
              at = 0;
              paint();
            }),
          ),
        ),
      );
      return resized();
    }
    const card = el("button", "card", md(back ? c.back : c.front));
    card.type = "button";
    card.onclick = () => {
      back = !back;
      paint();
    };
    const go = (ok: boolean) => {
      if (!ok) missed = [...missed, c];
      back = false;
      at++;
      paint();
    };
    box.replaceChildren(
      el(
        "div",
        "stack",
        el("div", "between", el("h2", "", block.title), el("span", "mono m s", `${at + 1} of ${queue.length}`)),
        card,
        el("div", "row", ...(back ? [button("Knew it", "pill", () => go(true)), button("Still learning", "pill ghost", () => go(false))] : [button("Flip", "pill", () => ((back = true), paint()))])),
        notice(note),
      ),
    );
    resized();
  };
  paint();
  return box;
}

/* ---------- plot ---------- */
const SVG = "http://www.w3.org/2000/svg";
const COLORS = ["var(--ink)", "var(--blue)", "var(--green)", "var(--red)"];
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
function plot(b: PlotBlock): HTMLElement {
  const vals: Record<string, number> = Object.fromEntries(b.sliders.map((s) => [s.name, s.value]));
  const curves = b.curves.map((c) => compile(c.expr));
  const [W, H, L, R, T, B] = [640, 340, 52, 14, 10, 34];
  const [x0, x1] = b.domain;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const draw = () => {
    const raw = curves.flatMap((c) => sample(c, b.variable, x0, x1, vals).flat());
    const [y0, y1] = b.range ?? autoRange(raw.map((p) => p.y));
    const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
    const sy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    const kids: SVGElement[] = [];
    const label = (x: number, y: number, s: string, a: string) => {
      const t = svgEl("text", { x, y, "font-size": 15, "text-anchor": a, fill: "var(--muted)" });
      t.textContent = s;
      kids.push(t);
    };
    for (const t of ticks(x0, x1)) {
      kids.push(svgEl("line", { x1: sx(t), x2: sx(t), y1: T, y2: H - B, stroke: "var(--line)" }));
      label(sx(t), H - B + 20, fmt(t), "middle");
    }
    for (const t of ticks(y0, y1, 5)) {
      kids.push(svgEl("line", { x1: L, x2: W - R, y1: sy(t), y2: sy(t), stroke: "var(--line)" }));
      label(L - 8, sy(t) + 5, fmt(t), "end");
    }
    const clip = svgEl("clipPath", { id: "c" });
    clip.append(svgEl("rect", { x: L, y: T, width: W - L - R, height: H - T - B }));
    kids.push(clip);
    const g = svgEl("g", { "clip-path": "url(#c)" });
    curves.forEach((c, i) => {
      for (const seg of sample(c, b.variable, x0, x1, vals, 320, (y1 - y0) * 3)) {
        const d = seg.map((p, j) => `${j ? "L" : "M"}${sx(p.x).toFixed(1)} ${Math.max(-200, Math.min(H + 200, sy(p.y))).toFixed(1)}`).join("");
        g.append(svgEl("path", { d, fill: "none", stroke: COLORS[i], "stroke-width": 3, "stroke-linejoin": "round" }));
      }
    });
    kids.push(g);
    svg.replaceChildren(...kids);
  };
  draw();
  const legend = el("p", "m s", b.curves.map((c) => c.label).join(" · "));
  const sliders = b.sliders.map((s) => {
    const value = el("span", "mono", fmt(s.value));
    const input = el("input");
    input.type = "range";
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(s.value);
    input.setAttribute("aria-label", s.label);
    input.oninput = () => {
      vals[s.name] = Number(input.value);
      value.textContent = fmt(vals[s.name]);
      draw();
    };
    return el("label", "m s", el("span", "between", s.label, value), input);
  });
  return el("div", "stack", el("h2", "", b.title), svg, legend, ...sliders, b.hint ? el("p", "m", b.hint) : null);
}

/* ---------- concept map: reads top to bottom as text, which suits a narrow host column ---------- */
function diagram(d: DiagramBlock): HTMLElement {
  const label = new Map(d.nodes.map((n) => [n.id, n.label]));
  const detail = el("p", "m");
  const nodes = d.nodes.map((n) => {
    const out = d.edges.filter((e) => e.from === n.id).map((e) => `${e.label ? `${e.label}: ` : "to "}${label.get(e.to)}`);
    const b = button(n.label, "node", () => (detail.textContent = n.detail ?? n.label));
    return el("div", "row", b, out.length ? el("span", "m s", out.join(", ")) : null);
  });
  return el("div", "stack", el("h2", "", d.title), el("div", "map", ...nodes), detail);
}

/* ---------- steps ---------- */
function steps(s: StepsBlock): HTMLElement {
  let at = 0;
  const shown = el("div", "stack");
  const foot = el("div", "stack");
  const paint = () => {
    const next = s.steps[at];
    if (!next) {
      foot.replaceChildren(el("p", "m s", "Answer"), md(s.answer));
      return resized();
    }
    foot.replaceChildren(
      line("p", "", next.ask),
      el(
        "div",
        "row",
        button("Show step", "pill", () => {
          shown.append(el("div", "step", md(next.work), line("p", "m", next.why)));
          at++;
          paint();
        }),
      ),
    );
    resized();
  };
  paint();
  return el("div", "stack", el("h2", "", s.title), md(s.problem), shown, foot);
}

function notice(text?: string) {
  return text ? el("p", "m s", text) : null;
}

function explanation(p: Extract<Payload, { kind: "explanation" }>) {
  const out: Node[] = [];
  for (const b of p.blocks) {
    if (b.type === "text") out.push(md(b.markdown));
    if (b.type === "formula") out.push(el("div", "", math(b.latex, true), b.caption ? line("p", "m s", b.caption) : null));
    if (b.type === "plot") out.push(plot(b));
    if (b.type === "diagram") out.push(diagram(b));
    if (b.type === "steps") out.push(steps(b));
    if (b.type === "flashcards") out.push(flashcards(b));
    if (b.type === "followups") out.push(el("div", "row", ...b.items.map((f) => button(f.label, "pill ghost", () => sendMessage(f.prompt)))));
  }
  show(el("div", "stack", ...out, notice(p.notice) ?? ""));
}

/* ---------- entry ---------- */
let drawn = false;
function render(data: unknown) {
  const p = data as Payload | undefined;
  if (!p?.kind || drawn) return;
  if (p.kind === "quiz" && !p.quiz) return;
  drawn = true;
  if (p.kind === "quiz") quiz(p);
  if (p.kind === "flashcards") show(flashcards(p.flashcards, p.notice));
  if (p.kind === "explanation") explanation(p);
}

const message = (text: string) => el("p", "m", text);

window.addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const m = e.data as { id?: number; method?: string; result?: unknown; error?: unknown; params?: { structuredContent?: unknown; content?: { text?: string }[]; styles?: unknown; theme?: string } };
  if (m?.id !== undefined && pending.has(m.id)) {
    const done = pending.get(m.id)!;
    pending.delete(m.id);
    done(m.result);
  }
  if (m?.method === "ui/notifications/tool-result") {
    if (m.params?.structuredContent) render(m.params.structuredContent);
    else if (!drawn) show(message(m.params?.content?.[0]?.text ?? "Nothing to show."));
  }
  if (m?.method === "ui/notifications/host-context-changed" && m.params?.theme) document.documentElement.dataset.theme = m.params.theme;
});
window.addEventListener("openai:set_globals", () => render(host()?.toolOutput));

if (host()?.theme) document.documentElement.dataset.theme = host()!.theme;
render(host()?.toolOutput);
if (!drawn && window.parent !== window) {
  rpc("ui/initialize", { protocolVersion: "2026-01-26", appInfo: { name: "openstudy", version: "1.0.0" }, appCapabilities: {} })
    .then((r) => {
      const theme = (r as { hostContext?: { theme?: string } })?.hostContext?.theme;
      if (theme) document.documentElement.dataset.theme = theme;
      notify("ui/notifications/initialized");
    })
    .catch(() => {});
}
