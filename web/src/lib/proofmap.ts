/**
 * The proof map: every changed line of a pull request as one mark, coloured by who stands behind it.
 * The colour follows the sign-off gate (shared/gate.ts): a line is never "proven" when the gate will ask a person to read it.
 */
import type { ChangeUnit, DiffLine, Dossier, Finding, Hunk } from '../../../shared/dossier';
import { fullReadReason } from '../../../shared/gate';
import { kindLabel } from '../components/review/atoms';

/** yours: read it · skim: look it over · proven: a run or a deterministic check stands in · read: a person has marked it */
export type MarkState = 'yours' | 'skim' | 'proven' | 'read';

export interface Pin {
  /** index of the changed line inside its stop */
  at: number;
  finding: Finding;
}

/** One hunk of the diff: the smallest thing that can be pointed at. */
export interface Stop {
  i: number;
  hunk: Hunk;
  path: string;
  language: string;
  unit: ChangeUnit;
  state: MarkState;
  /** what the reading plan asked for, before a void plan or a read mark changed the colour */
  plan: 'yours' | 'skim' | 'proven';
  changed: DiffLine[];
  pins: Pin[];
}

export interface MapRow {
  key: string;
  /** a single file, or a run of files that are the same kind of edit in the same unit */
  kind: 'file' | 'group';
  /** file name, or "222 generated output files" */
  label: string;
  /** directory, shown quietly */
  dir: string;
  title: string;
  files: number;
  lines: number;
  stops: Stop[];
  /** set on the first file of a group that was opened: the key that closes it again */
  closes?: string;
}

export interface ProofMapData {
  rows: MapRow[];
  stops: Stop[];
  total: number;
  /** marks per colour as drawn right now */
  count: Record<MarkState, number>;
  /** findings whose cited lines are not among the changed lines */
  unpinned: Finding[];
}

const GROUP_AT = 5;
const planOf = (u: ChangeUnit): Stop['plan'] => (u.ask === 'read' ? 'yours' : u.ask === 'skim' ? 'skim' : 'proven');

function commonDir(paths: string[]): string {
  const parts = paths.map((p) => p.split('/').slice(0, -1));
  const out: string[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    if (parts.every((p) => p[i] === parts[0][i])) out.push(parts[0][i]);
    else break;
  }
  return out.length ? `${out.join('/')}/` : '';
}

/** A finding is reproduced when a failing run backs it; otherwise it is argued from the code. */
export const isReproduced = (f: Finding) => f.reproduced === true || f.strength === 'executed';

export function proofMap(d: Dossier, readIds: Set<string>, open: Set<string>): ProofMapData {
  const full = !!fullReadReason(d);
  const units = new Map(d.units.map((u) => [u.id, u]));
  const stops: Stop[] = [];
  const count: Record<MarkState, number> = { yours: 0, skim: 0, proven: 0, read: 0 };
  const perFile: { path: string; sole?: string; stops: Stop[] }[] = [];

  for (const f of d.files) {
    const own: Stop[] = [];
    for (const h of f.hunks) {
      const unit = units.get(h.unitId);
      const changed = h.lines.filter((l) => l.t !== 'ctx');
      if (!unit || !changed.length) continue;
      const plan = planOf(unit);
      const state: MarkState = readIds.has(unit.id) ? 'read' : full ? 'yours' : plan;
      const s: Stop = { i: stops.length, hunk: h, path: f.path, language: f.language, unit, state, plan, changed, pins: [] };
      count[state] += changed.length;
      stops.push(s);
      own.push(s);
    }
    if (own.length) perFile.push({ path: f.path, sole: own.every((s) => s.unit.id === own[0].unit.id) ? own[0].unit.id : undefined, stops: own });
  }

  // findings sit on the changed line they cite; a cited context line pins to the nearest changed line of that hunk
  const unpinned: Finding[] = [];
  for (const f of d.findings) {
    let placed = false;
    for (const ref of f.refs) {
      if (ref.side === 'base') continue;
      const cands = stops.filter((s) => s.path === ref.path);
      let hit: { s: Stop; at: number } | undefined;
      for (const s of cands) {
        const at = s.changed.findIndex((l) => l.n !== undefined && l.n >= ref.startLine && l.n <= ref.endLine);
        if (at >= 0) {
          hit = { s, at };
          break;
        }
      }
      if (!hit)
        for (const s of cands) {
          const inHunk = s.hunk.lines.some((l) => l.n !== undefined && l.n >= ref.startLine && l.n <= ref.endLine);
          if (!inHunk) continue;
          let best = 0;
          let gap = Infinity;
          s.changed.forEach((l, k) => {
            const g = Math.abs((l.n ?? l.o ?? 0) - ref.startLine);
            if (g < gap) [gap, best] = [g, k];
          });
          hit = { s, at: best };
          break;
        }
      if (hit && !hit.s.pins.some((p) => p.finding.id === f.id)) {
        hit.s.pins.push({ at: hit.at, finding: f });
        placed = true;
      }
    }
    if (!placed) unpinned.push(f);
  }

  const rows: MapRow[] = [];
  for (let i = 0; i < perFile.length; ) {
    const f = perFile[i];
    let j = i + 1;
    if (f.sole) while (j < perFile.length && perFile[j].sole === f.sole) j++;
    const run = perFile.slice(i, j);
    const key = `g-${f.path}`;
    if (run.length >= GROUP_AT && !open.has(key)) {
      const all = run.flatMap((x) => x.stops);
      const dir = commonDir(run.map((x) => x.path));
      rows.push({
        key,
        kind: 'group',
        label: `${run.length} ${kindLabel[all[0].unit.kind] ?? 'changed'} files`,
        dir,
        title: `${run.length} files in ${dir || 'the repository'}, all in ${all[0].unit.id}: ${all[0].unit.title}`,
        files: run.length,
        lines: all.reduce((a, s) => a + s.changed.length, 0),
        stops: all,
      });
    } else {
      run.forEach((x, k) => {
        const cut = x.path.lastIndexOf('/');
        rows.push({ key: x.path, kind: 'file', label: x.path.slice(cut + 1), dir: x.path.slice(0, cut + 1), title: x.path, files: 1, lines: x.stops.reduce((a, s) => a + s.changed.length, 0), stops: x.stops, closes: k === 0 && run.length >= GROUP_AT ? key : undefined });
      });
    }
    i = j;
  }
  return { rows, stops, total: stops.reduce((a, s) => a + s.changed.length, 0), count, unpinned };
}

export const STATE_WORD: Record<MarkState, string> = { yours: 'Yours to read', skim: 'Skim', proven: 'Proven by a run', read: 'Read and marked' };
export const fmtInt = (n: number) => n.toLocaleString('en-US');

/** Lines per colour for a small proof bar, from the units alone (no diff needed). Follows the gate like the map does. */
export function planBar(d: Dossier, readIds: Set<string>): Record<MarkState, number> {
  const full = !!fullReadReason(d);
  const out: Record<MarkState, number> = { yours: 0, skim: 0, proven: 0, read: 0 };
  for (const u of d.units) out[readIds.has(u.id) ? 'read' : full ? 'yours' : planOf(u)] += u.additions + u.deletions;
  return out;
}
