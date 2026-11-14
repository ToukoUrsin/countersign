import type { DiffLine, FileDiff, Hunk } from '../../shared/dossier';

const LANG: Record<string, string> = {
  cs: 'csharp', csproj: 'xml', props: 'xml', targets: 'xml', md: 'markdown', tt: 't4', json: 'json', yml: 'yaml', yaml: 'yaml',
  ts: 'typescript', tsx: 'typescript', js: 'javascript', py: 'python', go: 'go', rs: 'rust', java: 'java', sln: 'text',
};

export function languageOf(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return LANG[ext] ?? 'text';
}

/** Parse `git diff` unified output into the dossier's file/hunk model. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let o = 0;
  let n = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(l);
      file = { id: `F${files.length + 1}`, path: m ? m[2] : l, status: 'modified', additions: 0, deletions: 0, language: 'text', hunks: [] };
      file.language = languageOf(file.path);
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (l.startsWith('new file mode')) file.status = 'added';
      else if (l.startsWith('deleted file mode')) file.status = 'deleted';
      else if (l.startsWith('rename from ')) {
        file.status = 'renamed';
        file.oldPath = l.slice('rename from '.length);
      }
    }
    if (l.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
      if (!m) continue;
      o = Number(m[1]);
      n = Number(m[2]);
      hunk = { id: `${file.id}.H${file.hunks.length + 1}`, header: l, oldStart: o, newStart: n, lines: [], unitId: '' };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (l.startsWith('\\')) continue; // "\ No newline at end of file"
    const c = l[0];
    const s = l.slice(1);
    let dl: DiffLine | null = null;
    if (c === '+') {
      dl = { t: 'add', n: n++, s };
      file.additions++;
    } else if (c === '-') {
      dl = { t: 'del', o: o++, s };
      file.deletions++;
    } else if (c === ' ') {
      dl = { t: 'ctx', o: o++, n: n++, s };
    }
    if (dl) hunk.lines.push(dl);
  }
  return files;
}

/** Rebuild a patch for one hunk (used to revert a single hunk for ablation). */
export function hunkPatch(file: FileDiff, hunk: Hunk): string {
  const oldLen = hunk.lines.filter((l) => l.t !== 'add').length;
  const newLen = hunk.lines.filter((l) => l.t !== 'del').length;
  const body = hunk.lines.map((l) => (l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ') + l.s).join('\n');
  const a = file.status === 'added' ? '/dev/null' : `a/${file.oldPath ?? file.path}`;
  const b = file.status === 'deleted' ? '/dev/null' : `b/${file.path}`;
  return `diff --git a/${file.oldPath ?? file.path} b/${file.path}\n--- ${a}\n+++ ${b}\n@@ -${hunk.oldStart},${oldLen} +${hunk.newStart},${newLen} @@\n${body}\n`;
}

export function renderHunk(file: FileDiff, hunk: Hunk, maxLines = 400): string {
  const body = hunk.lines.slice(0, maxLines).map((l) => (l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' ') + l.s);
  if (hunk.lines.length > maxLines) body.push(`… (${hunk.lines.length - maxLines} more lines)`);
  return `[${hunk.id}] ${file.path} ${hunk.header}\n${body.join('\n')}`;
}

export const changedLines = (h: Hunk) => h.lines.filter((l) => l.t !== 'ctx').length;

/**
 * Deterministic pre-clustering of repetitive changes.
 * A line is "common" when the identical (trimmed) changed line appears in >= minFiles files.
 * A file whose every changed line is common is a mechanical candidate. This is what lets a
 * 237-file PR be reviewed as "1 rule + its exceptions" instead of 237 diffs.
 */
export interface Cluster {
  id: string;
  fileIds: string[];
  vocabulary: string[]; // the distinct changed lines, prefixed with + or -
  totalFiles: number;
  additions: number;
  deletions: number;
}

export function preCluster(files: FileDiff[], minFiles = 6): Cluster[] {
  const key = (l: DiffLine) => (l.t === 'add' ? '+' : '-') + l.s.trim();
  const count = new Map<string, Set<string>>();
  for (const f of files)
    for (const h of f.hunks)
      for (const l of h.lines) {
        if (l.t === 'ctx' || !l.s.trim()) continue;
        const k = key(l);
        if (!count.has(k)) count.set(k, new Set());
        count.get(k)!.add(f.id);
      }
  const common = new Set([...count.entries()].filter(([, s]) => s.size >= minFiles).map(([k]) => k));
  const cand = files.filter((f) => {
    const ls = f.hunks.flatMap((h) => h.lines).filter((l) => l.t !== 'ctx' && l.s.trim());
    return ls.length > 0 && ls.every((l) => common.has(key(l)));
  });
  if (cand.length < minFiles) return [];
  // split by (top-level dir, extension) so unrelated repetitive edits do not merge
  const groups = new Map<string, FileDiff[]>();
  for (const f of cand) {
    const g = `${f.path.split('/').slice(0, 2).join('/')}|${f.path.split('.').slice(-2).join('.')}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  }
  const out: Cluster[] = [];
  for (const fs of groups.values()) {
    if (fs.length < minFiles) continue;
    const vocab = new Set<string>();
    for (const f of fs) for (const h of f.hunks) for (const l of h.lines) if (l.t !== 'ctx' && l.s.trim()) vocab.add(key(l));
    out.push({
      id: `C${out.length + 1}`,
      fileIds: fs.map((f) => f.id),
      vocabulary: [...vocab].sort(),
      totalFiles: fs.length,
      additions: fs.reduce((a, f) => a + f.additions, 0),
      deletions: fs.reduce((a, f) => a + f.deletions, 0),
    });
  }
  return out;
}
