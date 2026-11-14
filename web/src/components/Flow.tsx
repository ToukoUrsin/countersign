/**
 * Flow: the diagram renderer. Takes a layout-free Diagram spec, ranks it with dagre and draws
 * crisp nodes (HTML) over routed edges (SVG). Colour only ever means: touched by this PR (accent),
 * fails (red), holds (green). Everything else is neutral.
 *
 *  - before-after diagrams are two columns that can be played: a marker walks the old path until it
 *    breaks, then the new path until it holds.
 *  - a map uses one box width and equal heights per rank. Its lines run only horizontally and
 *    vertically, merge where they share an end, and carry their relation beside the arrowhead.
 *  - pointing at a box or a line dims everything that is not connected to it and names the relation.
 *  - a node that belongs to a change unit is a button that opens that unit.
 */
import dagre from '@dagrejs/dagre';
import { FlaskConical, Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Diagram, DiagramEdge, DiagramNode } from '../../../shared/dossier';
import { cx, tidy } from '../lib/util';

/** One scale of box widths for every diagram. A diagram uses a single width: the widest that fits. */
const SIZES = [232, 208, 184, 160] as const;
const PAD_X = 12;
const PAD_Y = 8;
const LABEL_LH = 18;
const SUB_LH = 16;
const ARROW = 6;
/** vertical distance between two boxes of a chain */
const CHAIN_GAP = 36;
/** a channel between two ranks of a map: room above the first track, between tracks, and under the last for the arrow and its label */
const CH_TOP = 10;
const CH_TRACK = 10;
const CH_BOTTOM = 26;
const CH_MIN = 32;
const FONT = "'Inter Variable', ui-sans-serif, system-ui, sans-serif";
const LABEL_FONT = `500 13px ${FONT}`;
const SUB_FONT = `400 12px ${FONT}`;
const EDGE_FONT = `400 12px ${FONT}`;

interface Pt {
  x: number;
  y: number;
}
interface PNode extends DiagramNode {
  x: number;
  y: number;
  w: number;
  h: number;
  labelLines: string[];
  subLines: string[];
  order: number;
}
interface PEdge extends DiagramEdge {
  key: string;
  d: string;
  /** where the label is written, and from which end */
  lx?: number;
  ly?: number;
  anchor: 'start' | 'end';
  /** the label has a free place of its own; otherwise it appears when the line is pointed at */
  shown: boolean;
  order: number;
  /** arrowhead tip and direction (degrees) */
  ax: number;
  ay: number;
  aa: number;
  /** a straight line of a chain: the walk can travel it */
  side: boolean;
}
interface PGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Laid {
  w: number;
  h: number;
  nodes: PNode[];
  edges: PEdge[];
  groups: PGroup[];
  columns: boolean;
  /** a map of boxes and routed lines, as opposed to a chain */
  map: boolean;
  /** some text was left out to fit the pane: pointing at a box reads it out in full */
  terse: boolean;
}

/**
 * How much a box of a map says. A map is drawn at the richest level that fits its pane; what a level
 * leaves out is read out under the map when the box is pointed at.
 */
interface Lod {
  label: number;
  sub: number;
}
const LODS: Lod[] = [
  { label: 4, sub: 3 },
  { label: 4, sub: 2 },
  { label: 4, sub: 0 },
];
/** the narrowest box of a map that is too wide for its pane at any wider box */
const MIN_W = 136;

let ctx: CanvasRenderingContext2D | null = null;
function measure(text: string, font: string): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

function greedy(pieces: { t: string; glue: boolean }[], font: string, max: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const p of pieces) {
    const sep = p.glue || !cur ? '' : ' ';
    if (cur && measure(cur + sep + p.t, font) > max) {
      lines.push(cur);
      cur = p.t;
    } else cur = cur + sep + p.t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Wrap to a box. A token wider than the box (a long identifier) breaks only where a reader would:
 * after a dot, slash, underscore or bracket, or before a capitalised word. Lines are then balanced so
 * a two-line title does not leave one word alone.
 */
function wrap(text: string, font: string, max: number, maxLines: number): string[] {
  const pieces: { t: string; glue: boolean }[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const parts = measure(word, font) <= max ? [word] : word.split(/(?<=[./_<(,:])(?=[A-Za-z0-9])|(?<=[a-z0-9])(?=[A-Z][a-z])/).filter(Boolean);
    parts.forEach((t, i) => pieces.push({ t, glue: i > 0 }));
  }
  let lines = greedy(pieces, font, max);
  if (lines.length > 1 && lines.length <= maxLines) {
    let lo = Math.max(...pieces.map((p) => measure(p.t, font)));
    let hi = max;
    for (let i = 0; i < 7 && hi - lo > 2; i++) {
      const mid = (lo + hi) / 2;
      if (greedy(pieces, font, mid).length <= lines.length) hi = mid;
      else lo = mid;
    }
    lines = greedy(pieces, font, hi);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 3 && measure(last + '…', font) > max) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + '…';
    return kept;
  }
  return lines;
}

const touched = (r: DiagramNode['role']) => r === 'changed' || r === 'added';
const markW = (n: DiagramNode) => (touched(n.role) || n.role === 'removed' || n.role === 'affected' ? 13 : n.role === 'test' ? 17 : 0);
/** room for the unit id written in the corner of a box that opens a unit */
const chipW = (n: DiagramNode) => (n.unitId ? measure(n.unitId, `500 11px ${FONT}`) + 10 : 0);

type Size = Pick<PNode, 'w' | 'h' | 'labelLines' | 'subLines'>;
function sized(n: DiagramNode, w: number, lod: Lod = LODS[0]): Size {
  const inner = w - PAD_X * 2 - markW(n);
  const labelLines = wrap(n.label, LABEL_FONT, inner - chipW(n), lod.label);
  const subLines = n.sublabel && lod.sub ? wrap(n.sublabel, SUB_FONT, inner, lod.sub) : [];
  return { w, h: PAD_Y * 2 + labelLines.length * LABEL_LH + (subLines.length ? 2 + subLines.length * SUB_LH : 0), labelLines, subLines };
}

const labelW = (e: DiagramEdge) => (e.label ? Math.ceil(measure(e.label, EDGE_FONT)) : 0);
function edgeColor(e: DiagramEdge): 'accent' | 'red' | 'neutral' {
  return e.role === 'broken' || e.role === 'removed' ? 'red' : e.role === 'new' ? 'accent' : 'neutral';
}

/** The nodes of a single path in walking order, or null when the graph is anything else. */
function pathOrder<N extends { id: string }>(ns: N[], es: DiagramEdge[]): N[] | null {
  if (!ns.length || es.length !== ns.length - 1) return null;
  if (ns.some((n) => es.filter((e) => e.from === n.id).length > 1 || es.filter((e) => e.to === n.id).length > 1)) return null;
  const seq: N[] = [];
  let cur = ns.find((n) => !es.some((e) => e.to === n.id));
  while (cur && !seq.includes(cur)) {
    seq.push(cur);
    const next = es.find((e) => e.from === cur!.id);
    cur = next ? ns.find((n) => n.id === next.to) : undefined;
  }
  return seq.length === ns.length ? seq : null;
}

/** A path of horizontal and vertical runs with rounded corners. */
function ortho(raw: Pt[], r = 7): string {
  const pts = raw.filter((p, i) => i === 0 || Math.abs(p.x - raw[i - 1].x) > 0.01 || Math.abs(p.y - raw[i - 1].y) > 0.01);
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    d += `L${c.x + ((p.x - c.x) / l1) * rr},${c.y + ((p.y - c.y) / l1) * rr}Q${c.x},${c.y} ${c.x + ((n.x - c.x) / l2) * rr},${c.y + ((n.y - c.y) / l2) * rr}`;
  }
  const z = pts[pts.length - 1];
  return `${d}L${z.x},${z.y}`;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** One horizontal run in a channel, shared by every line that leaves the same box or arrives at the same box. */
interface Net {
  x0: number;
  x1: number;
  from: number[];
  to: number[];
  segs: { key: string; i: number }[];
  track: number;
}

/**
 * A map. dagre decides the rank and the left-to-right order of the boxes; everything else is drawn
 * here: one box width, equal heights per rank, lines that run only horizontally and vertically and
 * merge where they share an end, and the relation written at the end of the line that is its own.
 */
function layMap(nodes: DiagramNode[], edges: DiagramEdge[], avail: number, out: Laid, lod: Lod, minScale: number) {
  let dims = new Map<string, Size>();
  let g = new dagre.graphlib.Graph({ multigraph: true });
  const run = (w: number) => {
    const sep = w >= 208 ? 32 : w >= 184 ? 28 : w >= 160 ? 24 : 16;
    dims = new Map(nodes.map((n) => [n.id, sized(n, w, lod)]));
    g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({ rankdir: 'TB', nodesep: sep, ranksep: 48, edgesep: 18, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) g.setNode(n.id, { width: w, height: dims.get(n.id)!.h });
    edges.forEach((e, i) => g.setEdge(e.from, e.to, {}, `e${i}`));
    dagre.layout(g);
    return g.graph().width ?? 0;
  };
  // the widest box, down to the narrowest that still reads, at which the map fits the stage
  let W: number = SIZES[0];
  let width = run(W);
  for (let i = 0; avail && width > avail && W > SIZES[3] && i < 4; i++) {
    const across = Math.max(1, Math.round(width / (W + 28)));
    W = Math.max(SIZES[3], Math.floor((W - (width - avail) / across) / 4) * 4);
    width = run(W);
  }
  // still too wide: the picture may be drawn one size smaller, and only then are the boxes narrowed further
  const room = avail / minScale;
  for (let i = 0; avail && width > room && W > MIN_W && i < 4; i++) {
    const across = Math.max(1, Math.round(width / (W + 20)));
    W = Math.max(MIN_W, Math.floor((W - (width - room) / across) / 4) * 4);
    width = run(W);
  }
  const half = (x: number) => Math.round(x) + 0.5;
  const rankYs = [...new Set(nodes.map((n) => Math.round(g.node(n.id).y)))].sort((a, b) => a - b);
  const rankOf = (id: string) => rankYs.indexOf(Math.round(g.node(id).y));
  const rowH = rankYs.map((_, r) => Math.max(...nodes.filter((n) => rankOf(n.id) === r).map((n) => dims.get(n.id)!.h)));
  const cx = (id: string) => half(g.node(id).x);
  /** x is clear of every box in a rank */
  const clear = (r: number, x: number, but?: string) => !nodes.some((n) => n.id !== but && rankOf(n.id) === r && Math.abs(x - cx(n.id)) < W / 2 + 10);

  // every edge as a run of x positions, one per rank it touches, from the upper box to the lower one
  const runs = edges.map((e, i) => {
    const key = `${e.from}>${e.to}:${i}`;
    const rev = rankOf(e.from) > rankOf(e.to);
    const [u, l] = rev ? [e.to, e.from] : [e.from, e.to];
    const [ru, rl] = [rankOf(u), rankOf(l)];
    const pts = (g.edge({ v: e.from, w: e.to, name: `e${i}` })?.points ?? []) as Pt[];
    const xs = [cx(u)];
    for (let r = ru + 1; r < rl; r++) {
      const near = [...pts].sort((a, b) => Math.abs(a.y - rankYs[r]) - Math.abs(b.y - rankYs[r]))[0];
      xs.push(near ? half(near.x) : xs[xs.length - 1]);
    }
    xs.push(cx(l));
    return { e, key, rev, u, l, ru, rl, xs };
  });
  // straighten. A box whose line would jog by a few pixels moves its port instead; a long line keeps
  // one lane where it can, and enters its box straight from that lane when the lane is over the box.
  const NEAR = 16;
  for (const n of nodes) {
    const outs = runs.filter((r) => r.u === n.id);
    const to = outs.map((r) => r.xs[1]).filter((x) => x !== cx(n.id) && Math.abs(x - cx(n.id)) <= NEAR)[0];
    if (to !== undefined) for (const r of outs) r.xs[0] = to;
  }
  for (const r of runs) {
    const n = r.xs.length - 1;
    for (let i = 1; i < n; i++) if (Math.abs(r.xs[i] - r.xs[i - 1]) <= NEAR && clear(r.ru + i, r.xs[i - 1])) r.xs[i] = r.xs[i - 1];
    for (let i = n - 1; i >= 1; i--) if (r.xs[i] !== r.xs[i + 1] && clear(r.ru + i, r.xs[i + 1]) && (i > 1 || Math.abs(r.xs[i + 1] - r.xs[0]) > NEAR)) r.xs[i] = r.xs[i + 1];
    const alone = runs.filter((o) => o.l === r.l).length === 1;
    const over = Math.abs(r.xs[n - 1] - r.xs[n]) < W / 2 - 18;
    if (r.xs[n - 1] !== r.xs[n] && over && (n > 1 || alone) && (n > 1 || Math.abs(r.xs[n - 1] - r.xs[n]) <= NEAR)) r.xs[n] = r.xs[n - 1];
  }

  // tracks: in each channel, the horizontal runs are grouped into nets and stacked so that none overlap
  const channels = rankYs.length - 1;
  const nets: Net[][] = Array.from({ length: channels }, () => []);
  for (let c = 0; c < channels; c++) {
    const segs = runs.flatMap((r) => {
      const i = c - r.ru;
      if (i < 0 || i >= r.xs.length - 1 || Math.abs(r.xs[i] - r.xs[i + 1]) < 1) return [];
      return [{ key: r.key, i, a: r.xs[i], b: r.xs[i + 1], src: i === 0 ? `n${r.u}` : `l${r.key}`, dst: i === r.xs.length - 2 ? `n${r.l}@${r.xs[i + 1]}` : `l${r.key}` }];
    });
    // lines that share a start or an end are one component; it is one net only if every start reaches every end
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      const p = parent.get(k);
      if (p === undefined || p === k) {
        parent.set(k, k);
        return k;
      }
      const root = find(p);
      parent.set(k, root);
      return root;
    };
    for (const s of segs) parent.set(find(`s${s.src}`), find(`d${s.dst}`));
    const groups = new Map<string, typeof segs>();
    for (const s of segs) {
      const k = find(`s${s.src}`);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    const list: Net[] = [];
    for (const all of groups.values()) {
      const srcs = new Set(all.map((s) => s.src));
      const dsts = new Set(all.map((s) => s.dst));
      const parts = all.length === srcs.size * dsts.size ? [all] : [...srcs].map((k) => all.filter((s) => s.src === k));
      for (const p of parts) {
        const xs = p.flatMap((s) => [s.a, s.b]);
        list.push({ x0: Math.min(...xs), x1: Math.max(...xs), from: [...new Set(p.map((s) => s.a))], to: [...new Set(p.map((s) => s.b))], segs: p.map((s) => ({ key: s.key, i: s.i })), track: 0 });
      }
    }
    list.sort((a, b) => a.x0 - b.x0 || a.x1 - b.x1);
    const over = (a: Net, b: Net) => a.x0 < b.x1 - 1 && b.x0 < a.x1 - 1;
    const inside = (xs: number[], n: Net) => xs.filter((x) => x > n.x0 + 1 && x < n.x1 - 1).length;
    const stack = (order: Net[]) => {
      const tr = new Map<Net, number>();
      let cross = 0;
      order.forEach((n, i) => {
        const above = order.slice(0, i).filter((m) => over(m, n));
        tr.set(n, above.length ? Math.max(...above.map((m) => tr.get(m)!)) + 1 : 0);
        // a net above is crossed by this one's stems; this one is crossed by the drops of a net above
        for (const m of above) cross += inside(n.from, m) + inside(m.to, n);
      });
      return { tr, cost: cross * 100 + Math.max(0, ...tr.values()) };
    };
    let best = stack(list);
    if (list.length > 1 && list.length <= 6)
      for (const p of permutations(list)) {
        const s = stack(p);
        if (s.cost < best.cost) best = s;
      }
    for (const n of list) n.track = best.tr.get(n)!;
    nets[c] = list;
  }

  // labels. A relation is written at the end of the line that belongs to it alone: beside the arrowhead
  // when nothing else arrives there, else under the box it leaves when nothing else leaves it. A line
  // with no end of its own names its relation when it is pointed at.
  const down = runs.filter((r) => !r.rev);
  const taken: { zone: string; x0: number; x1: number }[] = [];
  const said = new Map<string, { x: number; anchor: 'start' | 'end'; shown: boolean }>();
  let maxX = width;
  const slots = new Map<string, { x: number; end: 'head' | 'tail'; anchor: 'start' | 'end'; shown: boolean }>();
  for (const r of [...runs].sort((a, b) => a.rl - b.rl || a.xs[a.xs.length - 1] - b.xs[b.xs.length - 1])) {
    if (!r.e.label) continue;
    const lw = labelW(r.e);
    const n = r.xs.length - 1;
    if (r.rev) {
      slots.set(r.key, { x: r.xs[0] + 9, end: 'tail', anchor: 'start', shown: false });
      continue;
    }
    const oneIn = new Set(down.filter((o) => o.l === r.l && o.xs[o.xs.length - 1] === r.xs[n]).map((o) => o.e.label ?? '')).size === 1;
    const oneOut = new Set(down.filter((o) => o.u === r.u).map((o) => o.e.label ?? '')).size === 1;
    const end = oneIn || !oneOut ? 'head' : 'tail';
    const [c, x] = end === 'head' ? [r.rl - 1, r.xs[n]] : [r.ru, r.xs[0]];
    const zone = `${c}${end}`;
    const id = `${end === 'head' ? r.l : r.u}|${end}|${r.e.label}`;
    const same = said.get(id);
    if (same) {
      slots.set(r.key, { x: same.x, end, anchor: same.anchor, shown: false });
      continue;
    }
    const lines = runs.filter((o) => c >= o.ru && c < o.rl).map((o) => o.xs[c - o.ru + (end === 'head' ? 1 : 0)]);
    const free = (x0: number, x1: number) => x0 >= 0 && x1 <= Math.max(maxX, avail) && !lines.some((d) => Math.abs(d - x) > 1 && d > x0 - 6 && d < x1 + 6) && !taken.some((t) => t.zone === zone && x0 < t.x1 + 10 && t.x0 < x1 + 10);
    const right = free(x + 9, x + 9 + lw);
    const left = !right && free(x - 9 - lw, x - 9);
    const anchor = left ? 'end' : 'start';
    const lx = left ? x - 9 : x + 9;
    const shown = (right || left) && (oneIn || oneOut);
    if (shown) {
      taken.push({ zone, x0: left ? lx - lw : lx, x1: left ? lx : lx + lw });
      if (right) maxX = Math.max(maxX, lx + lw);
    }
    said.set(id, { x: lx, anchor, shown });
    slots.set(r.key, { x: lx, end, anchor, shown });
  }

  // vertical positions: ranks stacked with channels just tall enough for their tracks and labels
  const rowY: number[] = [];
  const chY: number[] = [];
  const chTop: number[] = [];
  let y = 0;
  rankYs.forEach((_, r) => {
    rowY.push(y);
    y += rowH[r];
    if (r < channels) {
      const says = (end: 'head' | 'tail') => runs.some((o) => (end === 'tail' ? o.ru : o.rl - 1) === r && slots.get(o.key)?.end === end && slots.get(o.key)!.shown);
      const bottom = says('head') ? CH_BOTTOM : CH_BOTTOM - 10;
      chY.push(y);
      chTop.push(says('tail') ? CH_BOTTOM - 2 : CH_TOP);
      y += Math.max(CH_MIN, chTop[r] + Math.max(0, ...nets[r].map((n) => n.track)) * CH_TRACK + bottom);
    }
  });

  const at = new Map<string, PNode>();
  for (const n of nodes) {
    const r = rankOf(n.id);
    const pn: PNode = { ...n, ...dims.get(n.id)!, h: rowH[r], x: Math.round(g.node(n.id).x - W / 2), y: rowY[r], order: 0 };
    at.set(n.id, pn);
    out.nodes.push(pn);
  }
  for (const r of runs) {
    const U = at.get(r.u)!;
    const L = at.get(r.l)!;
    const n = r.xs.length - 1;
    const pts: Pt[] = [{ x: r.xs[0], y: U.y + U.h + (r.rev ? ARROW : 0) }];
    for (let i = 0; i < n; i++) {
      const c = r.ru + i;
      const net = nets[c].find((t) => t.segs.some((s) => s.key === r.key && s.i === i));
      if (!net) continue;
      const ty = Math.round(chY[c] + chTop[c] + net.track * CH_TRACK) + 0.5;
      pts.push({ x: r.xs[i], y: ty }, { x: r.xs[i + 1], y: ty });
    }
    pts.push({ x: r.xs[n], y: L.y - (r.rev ? 0 : ARROW) });
    const slot = slots.get(r.key);
    out.edges.push({
      ...r.e,
      key: r.key,
      d: ortho(pts),
      lx: slot?.x,
      ly: slot ? (slot.end === 'head' ? L.y - 10 : U.y + U.h + 17) : undefined,
      anchor: slot?.anchor ?? 'start',
      shown: slot?.shown ?? false,
      side: false,
      order: 0,
      ax: r.rev ? r.xs[0] : r.xs[n],
      ay: r.rev ? U.y + U.h + 1 : L.y - 1,
      aa: r.rev ? -90 : 90,
    });
  }
  out.w = Math.ceil(maxX);
  out.h = y;
}

function lay(diagram: Diagram, avail = 0, availH = 0, minScale = 1): Laid {
  // the requirement is the page's subject, not a box in the picture
  const drop = new Set(diagram.nodes.filter((n) => n.role === 'requirement').map((n) => n.id));
  // the labels are written by the pipeline: its shorthand is put in words
  const nodes = diagram.nodes.filter((n) => !drop.has(n.id)).map((n) => ({ ...n, label: tidy(n.label), sublabel: n.sublabel ? tidy(n.sublabel) : n.sublabel }));
  const edges = diagram.edges.map((e) => (e.label ? { ...e, label: tidy(e.label) } : e)).filter((e) => e.from !== e.to && !drop.has(e.from) && !drop.has(e.to) && nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  const columns = diagram.kind === 'before-after' && (diagram.groups?.length ?? 0) === 2;
  if (columns) {
    // red means "this is where it fails". In a column where nothing breaks, replaced code is just code.
    const breaks = new Set(edges.filter((e) => edgeColor(e) === 'red').flatMap((e) => [nodes.find((n) => n.id === e.from)?.group, nodes.find((n) => n.id === e.to)?.group]));
    nodes.forEach((n, i) => {
      if (n.role === 'removed' && !breaks.has(n.group)) nodes[i] = { ...n, role: 'context' };
    });
  }
  const out: Laid = { w: 0, h: 0, nodes: [], edges: [], groups: [], columns, map: false, terse: false };
  if (!nodes.length) return out;

  /** One column of boxes joined by straight lines, the relation written beside each line. */
  const chain = (ns: DiagramNode[], es: DiagramEdge[], ox: number, oy: number, w: number) => {
    const at = new Map<string, PNode>();
    let y = oy;
    for (const n of ns) {
      const pn: PNode = { ...n, ...sized(n, w), x: ox, y, order: 0 };
      at.set(n.id, pn);
      out.nodes.push(pn);
      y += pn.h + CHAIN_GAP;
    }
    for (const e of es) {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      const x = ox + w / 2 + 0.5;
      const [y0, y1] = [a.y + a.h, b.y];
      out.edges.push({ ...e, key: `${e.from}>${e.to}:${out.edges.length}`, d: `M${x},${y0}L${x},${y1 - ARROW}`, lx: e.label ? x + 12 : undefined, ly: e.label ? (y0 + y1) / 2 + 4 : undefined, anchor: 'start', shown: true, side: true, order: 0, ax: x, ay: y1 - 1, aa: 90 });
    }
    return { w, h: y - CHAIN_GAP - oy, labels: Math.max(0, ...es.map(labelW)) };
  };
  /** the widest box whose chain, with the labels beside its lines, fits */
  const chainW = (labels: number) => (!avail ? SIZES[0] : (SIZES.find((x) => x / 2 + Math.max(x / 2, 12 + labels) <= avail) ?? SIZES[3]));

  const cols = columns
    ? diagram.groups!.map((gr) => {
        const all = nodes.filter((n) => n.group === gr.id);
        const es = edges.filter((e) => all.some((n) => n.id === e.from) && all.some((n) => n.id === e.to));
        return { gr, ns: pathOrder(all, es), es, labels: Math.max(0, ...es.map(labelW)) };
      })
    : [];
  const single = columns ? null : pathOrder(nodes, edges);
  if (columns && cols.every((c) => c.ns)) {
    const TOP = 34;
    // the gap between the columns holds the first column's side labels
    const gapOf = (w: number) => Math.max(64, cols[0].labels - w / 2 + 44);
    const tail = (w: number) => Math.max(0, cols[1].labels - w / 2 + 12);
    const total = (w: number) => w * 2 + gapOf(w) + tail(w);
    const colW = !avail ? SIZES[0] : SIZES.find((w) => total(w) <= avail);
    if (colW) {
      let x = 0;
      for (const c of cols) {
        const size = chain(c.ns!, c.es, x, TOP, colW);
        out.groups.push({ id: c.gr.id, label: c.gr.label, x, y: 0, w: size.w, h: size.h + TOP });
        x += size.w + gapOf(colW);
        out.h = Math.max(out.h, size.h + TOP);
      }
      out.w = x - gapOf(colW) + tail(colW);
    } else {
      // too narrow for two columns side by side (a phone): Before on top of After
      const w = chainW(Math.max(...cols.map((c) => c.labels)));
      let y = 0;
      for (const c of cols) {
        const size = chain(c.ns!, c.es, 0, y + TOP, w);
        out.groups.push({ id: c.gr.id, label: c.gr.label, x: 0, y, w: size.w, h: size.h + TOP });
        out.w = Math.max(out.w, size.w, size.w / 2 + 12 + size.labels);
        y += size.h + TOP + 28;
      }
      out.h = y - 28;
    }
  } else if (single) {
    const labels = Math.max(0, ...edges.map(labelW));
    const size = chain(single, edges, 0, 0, chainW(labels));
    out.w = Math.max(size.w, size.w / 2 + 12 + labels);
    out.h = size.h;
  } else {
    out.columns = false;
    out.map = true;
    // the richest level of detail at which the whole map is on screen
    for (const lod of LODS) {
      out.nodes = [];
      out.edges = [];
      layMap(nodes, edges, avail, out, lod, minScale);
      const s = Math.max(minScale, Math.min(1, avail ? avail / (out.w + 2) : 1, availH ? availH / out.h : 1));
      if (!availH || out.h * s <= availH + 1) break;
    }
    out.terse = out.nodes.some((n) => (n.sublabel && !n.subLines.length) || n.labelLines.at(-1)?.endsWith('…') || n.subLines.at(-1)?.endsWith('…'));
  }
  // reveal order: top to bottom, left to right
  [...out.nodes].sort((a, b) => a.y - b.y || a.x - b.x).forEach((n, i) => (n.order = i));
  const byId = new Map(out.nodes.map((n) => [n.id, n]));
  for (const e of out.edges) e.order = byId.get(e.to)?.order ?? 0;
  return out;
}

/** the legend under a picture: its margin and one row */
const LEGEND_H = 74;

const STROKE = { accent: 'var(--flow-accent)', red: 'var(--red)', neutral: 'var(--flow-line)', green: 'var(--green)', lit: 'var(--fg-2)' } as const;

interface Walk {
  /** node ids reached so far */
  lit: Set<string>;
  /** edges already travelled */
  done: Set<string>;
  failed?: string;
  held?: string;
  dot?: { x: number; y: number; tone: 'neutral' | 'red' | 'green' };
  caption?: string;
  /** the walk reached the end: everything is shown again, with the outcome marked */
  over?: boolean;
}

/** Diagrams that already played in this tab. Coming back to a chapter shows the picture, not the film again. */
const played = new Set<string>();

/** Order the nodes of one chain from its source, following edges. */
function chainOf(nodes: PNode[], edges: PEdge[]): { nodes: PNode[]; edges: PEdge[] } {
  const ids = new Set(nodes.map((n) => n.id));
  const es = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const hasIn = new Set(es.map((e) => e.to));
  let cur = nodes.find((n) => !hasIn.has(n.id)) ?? nodes[0];
  const seq: PNode[] = [];
  const path: PEdge[] = [];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    seq.push(cur);
    const next = es.find((e) => e.from === cur!.id && !seen.has(e.to));
    if (!next) break;
    path.push(next);
    cur = nodes.find((n) => n.id === next.to)!;
  }
  return { nodes: seq, edges: path };
}

export function Flow({
  diagram,
  onUnit,
  onHoverUnit,
  highlightUnits,
  autoPlay = false,
  minScale = 0.8,
  className,
}: {
  diagram: Diagram;
  onUnit?: (unitId: string) => void;
  /** the unit of the node under the pointer, so the text beside the picture can answer */
  onHoverUnit?: (unitId?: string) => void;
  /** unit ids to emphasise (for example the story step under the pointer) */
  highlightUnits?: string[];
  autoPlay?: boolean;
  minScale?: number;
  className?: string;
}) {
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFonts(1));
    return () => {
      live = false;
    };
  }, []);
  const host = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  /** the height left for the picture in the pane that scrolls it, so a diagram is drawn to be seen whole */
  const [ch, setCh] = useState(0);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const pane = el.closest<HTMLElement>('[data-flow-pane]');
    const read = () => {
      setCw(el.clientWidth);
      if (!pane) return;
      const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
      const pad = parseFloat(getComputedStyle(pane).paddingBottom) || 0;
      // under the picture: the legend, and the pane's own padding
      setCh(Math.max(0, Math.floor(pane.clientHeight - top - LEGEND_H - pad)));
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (pane) ro.observe(pane);
    read();
    return () => ro.disconnect();
  }, []);
  // a phone has no room for a map: there it is an outline, one box per row with its relations under it
  const narrow = cw > 0 && cw < 520;
  const laid = useMemo(() => lay(diagram, cw, narrow ? 0 : ch, minScale), [diagram, fonts, cw, ch, narrow, minScale]); // eslint-disable-line react-hooks/exhaustive-deps
  // one type scale, shrunk by at most a size to keep the whole picture on screen. Past that, the pane scrolls.
  const scale = Math.max(minScale, Math.min(1, cw ? cw / (laid.w + 2) : 1, ch && !narrow ? ch / laid.h : 1));
  const scrolls = cw > 0 && laid.w * scale > cw + 1;
  const outline = laid.map && narrow && scrolls;

  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const hl = highlightUnits?.length ? new Set(highlightUnits) : null;
  /** nodes in focus, or null when nothing is pointed at */
  const focus = useMemo(() => {
    if (hover) {
      const s = new Set([hover]);
      for (const e of laid.edges) {
        if (e.from === hover) s.add(e.to);
        if (e.to === hover) s.add(e.from);
      }
      return s;
    }
    if (hoverEdge) {
      const e = laid.edges.find((x) => x.key === hoverEdge);
      return e ? new Set([e.from, e.to]) : null;
    }
    if (hl) return new Set(laid.nodes.filter((n) => n.unitId && hl.has(n.unitId)).map((n) => n.id));
    return null;
  }, [hover, hoverEdge, laid, highlightUnits?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const edgeOn = (e: PEdge) => (hover ? e.from === hover || e.to === hover : hoverEdge ? e.key === hoverEdge : focus ? focus.has(e.from) || focus.has(e.to) : false);

  // ── play: walk each column's chain ──
  const playable = laid.columns || (diagram.kind === 'sequence' && laid.edges.every((e) => e.side));
  const [walk, setWalk] = useState<Walk | null>(null);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const paths = useRef(new Map<string, SVGPathElement>());
  const at = useRef<{ i: number; state: Walk } | null>(null);
  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
  }, []);
  const play = useCallback(() => {
    cancelAnimationFrame(raf.current);
    played.add(diagram.id + diagram.title);
    const chains = laid.columns ? laid.groups.map((g) => chainOf(laid.nodes.filter((n) => n.group === g.id), laid.edges)) : [chainOf(laid.nodes, laid.edges)];
    const steps: { edge?: PEdge; node: PNode; end: boolean }[] = [];
    for (const c of chains) c.nodes.forEach((n, i) => steps.push({ edge: i ? c.edges[i - 1] : undefined, node: n, end: i === c.nodes.length - 1 }));
    // a paused walk picks up where it stopped; a finished one starts over
    const resume = at.current && at.current.i < steps.length ? at.current : null;
    const state: Walk = resume ? resume.state : { lit: new Set(), done: new Set() };
    const EDGE_MS = 340;
    const HOLD_MS = 400;
    let i = resume ? resume.i : 0;
    let t0 = performance.now();
    setPlaying(true);
    const tick = (now: number) => {
      const s = steps[i];
      at.current = { i, state };
      if (!s) {
        setWalk({ ...state, dot: undefined, caption: undefined, over: true });
        setPlaying(false);
        return;
      }
      const el = s.edge ? paths.current.get(s.edge.key) : undefined;
      const k = s.edge && el ? Math.min(1, (now - t0) / EDGE_MS) : 1;
      const bad = s.edge ? edgeColor(s.edge) === 'red' : false;
      if (s.edge && el && k < 1) {
        const len = el.getTotalLength();
        const pt = el.getPointAtLength(len * (1 - Math.pow(1 - k, 3)));
        setWalk({ ...state, dot: { x: pt.x, y: pt.y, tone: bad ? 'red' : 'neutral' } });
        raf.current = requestAnimationFrame(tick);
        return;
      }
      // arrived
      if (!state.lit.has(s.node.id)) {
        state.lit = new Set(state.lit).add(s.node.id);
        if (s.edge) state.done = new Set(state.done).add(s.edge.key);
        if (bad || s.node.role === 'removed') state.failed = s.node.id;
        else if (s.end) state.held = s.node.id;
        state.caption = [s.node.label, s.node.sublabel].filter(Boolean).join(': ');
        setWalk({ ...state, dot: undefined });
        t0 = now;
      }
      if (now - t0 >= HOLD_MS) {
        i++;
        t0 = now;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [laid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    setWalk(null);
    at.current = null;
    stop();
    if (autoPlay && playable && cw && !played.has(diagram.id + diagram.title) && !(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      const t = setTimeout(play, 450);
      return () => clearTimeout(t);
    }
  }, [diagram.id, autoPlay, playable, !!cw]); // eslint-disable-line react-hooks/exhaustive-deps
  const paused = !playing && !!walk && !walk.over;
  const dimWalk = !!walk && !walk.over;

  // dimmed lines first, pointed-at lines last, so a shared stretch shows the line that matters
  const drawn = laid.edges
    .map((e) => {
      const on = edgeOn(e);
      return { e, on, dim: focus ? !on : dimWalk && !walk!.done.has(e.key) };
    })
    .sort((a, b) => Number(b.dim) - Number(a.dim) || Number(a.on) - Number(b.on) || Number(edgeColor(a.e) !== 'neutral') - Number(edgeColor(b.e) !== 'neutral'));
  const roles = new Set(laid.nodes.map((n) => n.role));
  const hidden = laid.edges.some((e) => e.label && !e.side && !e.shown);
  const newLines = !laid.columns && laid.edges.some((e) => edgeColor(e) === 'accent') && laid.edges.some((e) => edgeColor(e) === 'neutral');
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const interactive = !playable && laid.edges.length > 0;
  const boxW = Math.min(cw || Infinity, Math.max(laid.w * scale, Math.min(cw || 360, 360)));
  const pointed = laid.terse && hover ? laid.nodes.find((n) => n.id === hover) : undefined;
  const mark = (n: DiagramNode) => (
    <>
      {touched(n.role) && <span className="mt-[6px] mr-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      {n.role === 'removed' && <span className="mt-[6px] mr-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red" />}
      {n.role === 'affected' && <span className="mt-[5.5px] mr-[6px] h-[7px] w-[7px] shrink-0 rounded-full border border-accent" />}
      {n.role === 'test' && <FlaskConical className="mt-[3px] mr-[5px] h-3 w-3 shrink-0 text-fg-3" strokeWidth={1.8} />}
    </>
  );

  return (
    <figure className={cx('m-0', className)}>
      <div ref={host} className={cx('w-full', !outline && 'overflow-x-auto', scrolls && !outline && 'flow-scroll pb-2')}>
        {outline && (
          <ol className="border-t border-line">
            {[...laid.nodes]
              .sort((a, b) => a.order - b.order)
              .map((n) => {
                const outs = laid.edges.filter((e) => e.from === n.id);
                const clickable = !!(n.unitId && onUnit);
                const Tag = clickable ? 'button' : 'div';
                return (
                  <li key={n.id} className="border-b border-line py-2.5">
                    <Tag type={clickable ? 'button' : undefined} onClick={clickable ? () => onUnit!(n.unitId!) : undefined} className="flex w-full items-start text-left">
                      <span className="flex w-4 shrink-0">{mark(n)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cx('block text-base font-medium [overflow-wrap:anywhere]', n.role === 'context' || n.role === 'external' ? 'text-fg-2' : 'text-fg')}>{n.label}</span>
                        {n.sublabel && <span className="block text-sm text-fg-3 [overflow-wrap:anywhere]">{n.sublabel}</span>}
                      </span>
                      {n.unitId && <span className="num ml-2 shrink-0 text-xs font-medium text-fg-3">{n.unitId}</span>}
                    </Tag>
                    {outs.length > 0 && (
                      <ul className="mt-1.5 space-y-1 pl-4">
                        {outs.map((e) => (
                          <li key={e.key} className="flex items-baseline gap-1.5 text-sm text-fg-3">
                            <span className={cx('shrink-0', edgeColor(e) === 'accent' ? 'text-[var(--flow-accent)]' : 'text-fg-4')} aria-hidden>
                              →
                            </span>
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              {e.label ? `${e.label}: ` : ''}
                              <span className="text-fg-2">{laid.nodes.find((x) => x.id === e.to)?.label}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
          </ol>
        )}
        <div style={{ width: scrolls ? laid.w * scale : boxW }} className={cx('mx-auto', outline && 'hidden')}>
          <div style={{ width: laid.w * scale, height: laid.h * scale }} className="relative mx-auto">
            <div style={{ width: laid.w, height: laid.h, transform: `scale(${scale})`, transformOrigin: '0 0' }} className="relative">
              <svg width={laid.w} height={laid.h} className="absolute inset-0 overflow-visible" aria-hidden>
                {drawn.map(({ e, on, dim }) => {
                  const c = walk?.done.has(e.key) ? (edgeColor(e) === 'red' ? 'red' : walk.held && laid.nodes.find((n) => n.id === e.to)?.group === laid.nodes.find((n) => n.id === walk.held)?.group ? 'green' : 'lit') : on && edgeColor(e) === 'neutral' ? 'lit' : edgeColor(e);
                  const dashed = e.style === 'dashed' || edgeColor(e) === 'red';
                  return (
                    <g key={e.key} className="flow-edge" style={{ opacity: dim ? 0.22 : 1 }}>
                      <path
                        ref={(el) => {
                          if (el) paths.current.set(e.key, el);
                          else paths.current.delete(e.key);
                        }}
                        d={e.d}
                        pathLength={dashed ? undefined : 1}
                        fill="none"
                        stroke={STROKE[c]}
                        strokeWidth={c === 'neutral' ? 1.25 : 1.5}
                        strokeDasharray={dashed ? '3 4' : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={cx('flow-edge', !dashed && !reduce && 'draw')}
                        style={{ animationDelay: `${100 + e.order * 24}ms` }}
                      />
                      <path d={`M0.5,0L${-ARROW - 0.5},-3.3L${-ARROW - 0.5},3.3Z`} transform={`translate(${e.ax},${e.ay}) rotate(${e.aa})`} fill={STROKE[c]} stroke={STROKE[c]} strokeWidth="1" strokeLinejoin="round" className="flow-edge" style={reduce ? undefined : { animation: 'fade-in 160ms ease-out both', animationDelay: `${280 + e.order * 24}ms` }} />
                      {interactive && <path d={e.d} fill="none" stroke="transparent" strokeWidth="14" style={{ pointerEvents: 'stroke' }} onMouseEnter={() => setHoverEdge(e.key)} onMouseLeave={() => setHoverEdge(null)} />}
                    </g>
                  );
                })}
                {drawn.map(({ e, on, dim }) => {
                  if (!e.label || e.lx === undefined) return null;
                  const tone = edgeColor(e);
                  // a label without a free place of its own appears when its line is pointed at
                  const visible = e.shown || (on && !laid.edges.some((o) => o !== e && o.shown && edgeOn(o) && o.lx === e.lx && o.ly === e.ly));
                  return (
                    <text
                      key={`l-${e.key}`}
                      className="flow-edge"
                      style={{ opacity: !visible ? 0 : dim ? 0.22 : 1, paintOrder: 'stroke', pointerEvents: 'none' }}
                      x={e.lx}
                      y={e.ly}
                      textAnchor={e.anchor}
                      fontSize="12"
                      fontFamily={FONT}
                      stroke="var(--stage, var(--bg))"
                      strokeWidth="5"
                      strokeLinejoin="round"
                      fill={e.side && tone === 'red' ? 'var(--red)' : on ? 'var(--fg)' : 'var(--fg-3)'}
                    >
                      {e.label}
                    </text>
                  );
                })}
                {walk?.dot && (
                  <g>
                    <circle cx={walk.dot.x} cy={walk.dot.y} r="9" fill={walk.dot.tone === 'red' ? 'var(--red)' : 'var(--fg)'} opacity="0.14" />
                    <circle cx={walk.dot.x} cy={walk.dot.y} r="4" fill={walk.dot.tone === 'red' ? 'var(--red)' : 'var(--fg)'} />
                  </g>
                )}
              </svg>

              {laid.columns &&
                laid.groups.map((g) => (
                  <div key={g.id} style={{ left: g.x, top: g.y, width: g.w }} className="absolute flex h-6 items-center justify-center text-sm font-medium text-fg-2">
                    {g.label}
                  </div>
                ))}

              {laid.nodes.map((n) => {
                const lit = walk?.lit.has(n.id);
                const failed = walk?.failed === n.id;
                const held = walk?.held === n.id;
                const dim = focus ? !focus.has(n.id) : dimWalk && !lit;
                const clickable = !!(n.unitId && onUnit);
                const Tag = clickable ? 'button' : 'div';
                return (
                  <Tag
                    key={n.id}
                    type={clickable ? 'button' : undefined}
                    onClick={clickable ? () => onUnit!(n.unitId!) : undefined}
                    onMouseEnter={() => (setHover(n.id), onHoverUnit?.(n.unitId))}
                    onMouseLeave={() => (setHover(null), onHoverUnit?.(undefined))}
                    onFocus={() => (setHover(n.id), onHoverUnit?.(n.unitId))}
                    onBlur={() => (setHover(null), onHoverUnit?.(undefined))}
                    title={clickable ? `Open ${n.unitId}: ${n.label}` : laid.terse ? [n.label, n.sublabel].filter(Boolean).join(': ') : undefined}
                    style={{ left: n.x, top: n.y, width: n.w, height: n.h, opacity: dim ? (focus ? 0.32 : 0.5) : 1, animationDelay: reduce ? undefined : `${n.order * 24}ms`, paddingLeft: PAD_X, paddingRight: PAD_X }}
                    className={cx(
                      'flow-node absolute flex flex-col justify-center rounded-lg border text-left',
                      n.role === 'external' ? 'border-dashed border-line-strong bg-transparent' : 'border-line-strong bg-surface',
                      touched(n.role) && 'border-accent/50 bg-[color-mix(in_oklab,var(--accent)_8%,var(--surface))]',
                      n.role === 'removed' && 'border-red/55 bg-[color-mix(in_oklab,var(--red)_8%,var(--surface))]',
                      failed && 'border-red bg-[color-mix(in_oklab,var(--red)_16%,var(--surface))] shadow-[0_0_0_3px_color-mix(in_oklab,var(--red)_20%,transparent)]',
                      held && 'border-green bg-[color-mix(in_oklab,var(--green)_13%,var(--surface))] shadow-[0_0_0_3px_color-mix(in_oklab,var(--green)_18%,transparent)]',
                      lit && !failed && !held && dimWalk && 'border-fg-3',
                      hover === n.id && !failed && !held && (touched(n.role) ? 'border-accent' : 'border-fg-3'),
                      clickable && 'hover:bg-[color-mix(in_oklab,var(--accent)_14%,var(--surface))] focus-visible:border-accent',
                    )}
                  >
                    <span className="flex items-start">
                      {mark(n)}
                      <span className="min-w-0 flex-1">
                        <span className={cx('block text-[13px] leading-[18px] font-medium', n.role === 'context' || n.role === 'external' ? 'text-fg-2' : 'text-fg')}>
                          {n.labelLines.map((l, i) => (
                            <span key={i} className="block whitespace-nowrap">
                              {l}
                            </span>
                          ))}
                        </span>
                        {n.subLines.length > 0 && (
                          <span className="mt-[2px] block text-[12px] leading-[16px] text-fg-3">
                            {n.subLines.map((l, i) => (
                              <span key={i} className="block whitespace-nowrap">
                                {l}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      {n.unitId && <span className={cx('num -mr-1 ml-1.5 shrink-0 text-[11px] leading-[18px] font-medium', hover === n.id && clickable ? 'text-fg-2' : 'text-fg-4')}>{n.unitId}</span>}
                    </span>
                  </Tag>
                );
              })}
            </div>
          </div>

          <figcaption style={{ width: scrolls || !cw ? undefined : (cw + boxW) / 2 }} className="mt-4 flex min-h-7 items-start gap-3 text-xs text-fg-3">
            {playable && (
              <button
                type="button"
                onClick={playing ? stop : play}
                data-flow-play
                title="Play or pause (Space)"
                className="inline-flex h-7 w-[84px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface text-sm font-medium text-fg transition-colors hover:bg-surface-2"
              >
                {playing ? <Pause className="h-3 w-3" /> : walk?.over ? <RotateCcw className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {playing ? 'Pause' : paused ? 'Resume' : walk?.over ? 'Replay' : 'Play'}
              </button>
            )}
            {pointed ? (
              <span className="min-w-0 flex-1 pt-[5px] text-sm text-fg-2">
                <span className="font-medium text-fg">{pointed.label}</span>
                {pointed.sublabel ? `: ${pointed.sublabel}` : ''}
              </span>
            ) : walk?.caption ? (
              <span className={cx('min-w-0 flex-1 pt-[5px] text-sm', walk.failed && walk.lit.size && [...walk.lit].at(-1) === walk.failed ? 'text-red' : walk.held ? 'text-green' : 'text-fg-2')}>{walk.caption}</span>
            ) : (
              <span className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1">
                {(roles.has('changed') || roles.has('added')) && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    Changed in this PR
                  </span>
                )}
                {roles.has('affected') && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-[7px] w-[7px] rounded-full border border-accent" />
                    Affected downstream
                  </span>
                )}
                {newLines && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-[1.5px] w-3.5 rounded-full bg-[var(--flow-accent)]" />
                    New in this PR
                  </span>
                )}
                {roles.has('removed') && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red" />
                    Where it fails
                  </span>
                )}
                {roles.has('test') && (
                  <span className="flex items-center gap-1.5">
                    <FlaskConical className="h-3 w-3" strokeWidth={1.8} />
                    Test
                  </span>
                )}
                {roles.has('external') && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-3.5 rounded-[3px] border border-dashed border-line-strong" />
                    Outside this repository
                  </span>
                )}
                {(hidden || laid.terse) && <span className="text-fg-4 max-lg:hidden">{laid.terse ? 'Point at a box or a line to read it in full' : 'Point at a line to read its relation'}</span>}
              </span>
            )}
          </figcaption>
        </div>
      </div>
    </figure>
  );
}
