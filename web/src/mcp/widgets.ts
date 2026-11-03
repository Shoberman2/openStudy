// MCP Apps resources (spec 15.7). One bundle, three templates: self-contained, no network, so the
// strictest host CSP is fine. Math renders as MathML, which needs no fonts or CSS.
import { WIDGET_JS } from "./widget-bundle.generated";

export const WIDGET_MIME = "text/html;profile=mcp-app";
export type WidgetKind = "quiz" | "flashcards" | "explanation";

export const WIDGETS: Record<WidgetKind, { uri: string; title: string; description: string }> = {
  quiz: { uri: "ui://openstudy/quiz.html", title: "OpenStudy quiz", description: "One question at a time with an explanation for every option." },
  flashcards: { uri: "ui://openstudy/flashcards.html", title: "OpenStudy flashcards", description: "Flip, mark what you know, and review what you missed." },
  explanation: { uri: "ui://openstudy/explanation.html", title: "OpenStudy explanation", description: "Formulas, interactive graphs, concept maps and step by step solutions." },
};

const CSS = `
:root{--bg:#fff;--soft:#f4f3ef;--ink:#141414;--muted:#6e6e6e;--line:#e5e4df;--blue:#2f5bea;--green:#1fa35b;--green-soft:#e6f7ee;--red:#e8423a;--red-soft:#fdeceb;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#101012;--soft:#1f1f23;--ink:#f3f3f3;--muted:#a0a0a6;--line:#2a2a2e;--green-soft:#10301f;--red-soft:#3a1513;color-scheme:dark}}
:root[data-theme=light]{--bg:#fff;--soft:#f4f3ef;--ink:#141414;--muted:#6e6e6e;--line:#e5e4df;--green-soft:#e6f7ee;--red-soft:#fdeceb;color-scheme:light}
:root[data-theme=dark]{--bg:#101012;--soft:#1f1f23;--ink:#f3f3f3;--muted:#a0a0a6;--line:#2a2a2e;--green-soft:#10301f;--red-soft:#3a1513;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;padding:14px;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
h2{font-size:18px;font-weight:600;margin:0 0 4px}
p{margin:0}
.m{color:var(--muted)}.s{font-size:14px}
.stack{display:grid;gap:12px}.row{display:flex;flex-wrap:wrap;gap:8px}.between{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.mono{font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
button{font:inherit;color:inherit;cursor:pointer}
.pill{min-height:36px;padding:0 14px;border-radius:999px;border:0;background:var(--ink);color:var(--bg);font-weight:600;font-size:15px}
.pill.ghost{background:var(--soft);color:var(--ink)}.pill:disabled{opacity:.4;cursor:default}
.choice{display:block;width:100%;text-align:left;padding:12px 14px;border-radius:14px;border:2px solid transparent;background:var(--soft);font-size:16px}
.choice[aria-pressed=true]{border-color:var(--ink)}.choice:disabled{cursor:default}
.choice.right{border-color:var(--green);background:var(--green-soft)}.choice.wrong{border-color:var(--red);background:var(--red-soft)}
.why{padding:4px 12px 0;font-size:15px;color:var(--muted)}
.card{width:100%;min-height:170px;padding:22px;border:0;border-radius:16px;background:var(--soft);font-size:18px;text-align:center}
.step{padding:12px;border-radius:14px;background:var(--soft)}
input[type=range]{width:100%;accent-color:var(--ink)}
input[type=text]{flex:1;min-width:0;padding:8px 12px;border-radius:999px;border:2px solid var(--line);background:var(--soft);color:var(--ink);font:inherit}
svg{display:block;width:100%;height:auto}
.node{padding:8px 12px;border-radius:12px;background:var(--soft);font-size:15px;font-weight:600;border:0}
.map{display:grid;gap:8px}
ul,ol{margin:0;padding-left:22px}
math{font-size:1.08em}math[display=block]{overflow-x:auto;padding:4px 0}
`;

export function widgetHtml(kind: WidgetKind): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${WIDGETS[kind].title}</title><style>${CSS}</style></head><body data-kind="${kind}"><div id="root"><p class="m">Loading</p></div><script>${WIDGET_JS}</script></body></html>`;
}
