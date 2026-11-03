// Deterministic concept map layout (spec 15.2): rows from the graph's depth, fitted to the width
// available, so a map is readable on a phone at real text size instead of a shrunken picture.
import type { DiagramBlock } from "./blocks";

export type Placed = { id: string; label: string; detail?: string; x: number; y: number; w: number; h: number };
export type Wire = { from: Placed; to: Placed; label?: string };
export type Layout = { nodes: Placed[]; wires: Wire[]; width: number; height: number };

const NODE_H = 60;
const ROW_GAP = 56;
const GAP = 12;
const CHAR = 8.2;
/** Narrowest box that still holds two lines of 15px text. */
const MIN_W = 88;

type Node = DiagramBlock["nodes"][number];

/** Longest path depth from any root; a cycle's back edge is ignored rather than looping. */
function depths(d: DiagramBlock): Map<string, number> {
  const depth = new Map(d.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < d.nodes.length; pass++) {
    let moved = false;
    for (const e of d.edges) {
      const next = depth.get(e.from)! + 1;
      if (next > depth.get(e.to)! && next < d.nodes.length) {
        depth.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return depth;
}

export function layoutDiagram(d: DiagramBlock, width: number): Layout {
  const depth = depths(d);
  const byDepth = new Map<number, Node[]>();
  for (const n of d.nodes) byDepth.set(depth.get(n.id)!, [...(byDepth.get(depth.get(n.id)!) ?? []), n]);

  const placed = new Map<string, Placed>();
  const natural = (n: Node) => Math.min(width, Math.max(MIN_W, n.label.length * CHAR + 28));
  const perRow = Math.max(1, Math.floor((width + GAP) / (MIN_W + GAP)));
  let y = 0;

  for (const level of [...byDepth.keys()].sort((a, b) => a - b)) {
    // Sit each node under its parents, which keeps wires from crossing other boxes.
    const parentX = (n: Node) => {
      const xs = d.edges.filter((e) => e.to === n.id && placed.has(e.from)).map((e) => placed.get(e.from)!);
      return xs.length ? xs.reduce((a, p) => a + p.x + p.w / 2, 0) / xs.length : Infinity;
    };
    const order = byDepth.get(level)!.map((n, i) => ({ n, i, at: parentX(n) })).sort((a, b) => a.at - b.at || a.i - b.i).map((o) => o.n);

    for (let i = 0; i < order.length; i += perRow) {
      const chunk = order.slice(i, i + perRow);
      const room = width - GAP * (chunk.length - 1);
      const wants = chunk.map(natural);
      const total = wants.reduce((a, w) => a + w, 0);
      // Natural widths when they fit, otherwise equal cells and the labels wrap to two lines.
      const widths = total <= room ? wants : chunk.map(() => room / chunk.length);
      let x = (width - widths.reduce((a, w) => a + w, 0) - GAP * (chunk.length - 1)) / 2;
      chunk.forEach((n, j) => {
        placed.set(n.id, { ...n, x, y, w: widths[j], h: NODE_H });
        x += widths[j] + GAP;
      });
      y += NODE_H + ROW_GAP;
    }
  }
  const nodes = d.nodes.map((n) => placed.get(n.id)!);
  const wires = d.edges.map((e) => ({ from: placed.get(e.from)!, to: placed.get(e.to)!, label: e.label }));
  return { nodes, wires, width, height: Math.max(0, y - ROW_GAP) };
}
