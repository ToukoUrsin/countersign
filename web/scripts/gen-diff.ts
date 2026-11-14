/**
 * Parses the real sample change (vendor/mp) into FileDiff[] for the fixture dossier.
 *   bun scripts/gen-diff.ts
 * Writes src/fixtures/mp-diff.json. Hunks are split and assigned to change units here
 * so the diff viewer shows real code grouped by idea, not by file.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DiffLine, FileDiff, Hunk } from '../../shared/dossier';

const repo = resolve(import.meta.dirname, '../../vendor/mp');
const range = 'origin/dependabot/nuget/develop/PolySharp-1.15.0...origin/ju26-issue-2283';
const raw = execSync(`git diff ${range}`, { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString();

/** Split a hunk in two before the first line that satisfies the predicate. */
const splits: { file: string; hunk: number; before: (lines: DiffLine[], i: number) => boolean }[] = [
  {
    file: 'TypeCollector.cs',
    hunk: 4,
    before: (ls, i) => ls[i].s.includes('/// <summary>') && !!ls[i + 1]?.s.includes('Reports a diagnostic only when'),
  },
  {
    file: 'GenericsFormatterTests.cs',
    hunk: 2,
    before: (ls, i) => ls[i].s.includes('/// <summary>') && !!ls[i + 1]?.s.includes('Compiles <paramref'),
  },
];

/** unit assignment by file + hunk sequence (after splitting) */
const unitOf: Record<string, string[]> = {
  'README.md': ['U5'],
  'MsgPack004.md': ['U5'],
  'TypeCollector.cs': ['U2', 'U1', 'U1', 'U1', 'U2'],
  'GenericsFormatterTests.cs': ['U4', 'U3', 'U4'],
};

const lang = (p: string) =>
  p.endsWith('.cs') ? 'csharp' : p.endsWith('.md') ? 'markdown' : p.endsWith('.csproj') || p.endsWith('.props') ? 'xml' : 'text';

type RawHunk = { header: string; ctx: string; lines: DiffLine[] };
const files: { path: string; status: FileDiff['status']; hunks: RawHunk[] }[] = [];
let cur: (typeof files)[number] | undefined;
let hunk: RawHunk | undefined;
let o = 0;
let n = 0;

for (const line of raw.split('\n')) {
  if (line.startsWith('diff --git ')) {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line)!;
    cur = { path: m[2], status: 'modified', hunks: [] };
    files.push(cur);
    hunk = undefined;
  } else if (line.startsWith('new file mode')) cur!.status = 'added';
  else if (line.startsWith('deleted file mode')) cur!.status = 'deleted';
  else if (line.startsWith('@@')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line)!;
    o = +m[1];
    n = +m[2];
    hunk = { header: line, ctx: m[3], lines: [] };
    cur!.hunks.push(hunk);
  } else if (hunk && line.startsWith('+')) hunk.lines.push({ t: 'add', n: n++, s: line.slice(1) });
  else if (hunk && line.startsWith('-')) hunk.lines.push({ t: 'del', o: o++, s: line.slice(1) });
  else if (hunk && line.startsWith(' ')) hunk.lines.push({ t: 'ctx', o: o++, n: n++, s: line.slice(1) });
}

const header = (lines: DiffLine[], ctx: string) => {
  const olds = lines.filter((l) => l.t !== 'add');
  const news = lines.filter((l) => l.t !== 'del');
  const os = olds[0]?.o ?? 0;
  const ns = news[0]?.n ?? 0;
  return { text: `@@ -${os},${olds.length} +${ns},${news.length} @@ ${ctx}`.trim(), os, ns };
};

const out: FileDiff[] = files.map((f, fi) => {
  const base = f.path.split('/').pop()!;
  const parts: RawHunk[] = [];
  f.hunks.forEach((h, hi) => {
    const sp = splits.find((s) => s.file === base && s.hunk === hi + 1);
    const at = sp ? h.lines.findIndex((_, i) => sp.before(h.lines, i)) : -1;
    if (at > 0) {
      parts.push({ ...h, lines: h.lines.slice(0, at) }, { ...h, lines: h.lines.slice(at) });
    } else parts.push(h);
  });
  const hunks: Hunk[] = parts.map((h, i) => {
    const hd = header(h.lines, h.ctx);
    const unitId = unitOf[base]?.[i];
    if (!unitId) throw new Error(`no unit for ${base} hunk ${i + 1}`);
    return { id: `F${fi + 1}.H${i + 1}`, header: hd.text, oldStart: hd.os, newStart: hd.ns, lines: h.lines, unitId };
  });
  const all = hunks.flatMap((h) => h.lines);
  return {
    id: `F${fi + 1}`,
    path: f.path,
    status: f.status,
    additions: all.filter((l) => l.t === 'add').length,
    deletions: all.filter((l) => l.t === 'del').length,
    language: lang(f.path),
    hunks,
  };
});

writeFileSync(resolve(import.meta.dirname, '../src/fixtures/mp-diff.json'), JSON.stringify(out));

const perUnit: Record<string, { add: number; del: number; hunks: string[] }> = {};
for (const f of out)
  for (const h of f.hunks) {
    const u = (perUnit[h.unitId] ??= { add: 0, del: 0, hunks: [] });
    u.add += h.lines.filter((l) => l.t === 'add').length;
    u.del += h.lines.filter((l) => l.t === 'del').length;
    u.hunks.push(`${h.id}@${h.newStart}`);
  }
console.log(out.map((f) => `${f.id} ${f.path} +${f.additions} -${f.deletions} (${f.hunks.length} hunks)`).join('\n'));
console.log(perUnit);
