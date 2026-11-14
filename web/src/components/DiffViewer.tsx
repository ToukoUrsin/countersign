import { ChevronsUpDown, FileCode2, FileText } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { CodeRef, FileDiff, Hunk } from '../../../shared/dossier';
import { highlight } from '../lib/highlight';
import { cx } from '../lib/util';

const COLLAPSE_AT = 26;
const HEAD_LINES = 10;

function HunkView({ hunk, lang, collapsible, marks }: { hunk: Hunk; lang: string; collapsible: boolean; marks: Set<number> }) {
  const big = collapsible && hunk.lines.length > COLLAPSE_AT;
  const [open, setOpen] = useState(!big);
  const lines = open ? hunk.lines : hunk.lines.slice(0, HEAD_LINES);
  return (
    <div>
      <div className="code wrap-code border-y border-line bg-surface-2/60 px-3 py-0.5 text-fg-3 first:border-t-0">{hunk.header}</div>
      <div className="code">
        {lines.map((l, i) => {
          // a long line wraps under its own indentation, one step in, so the structure of the code survives
          const lead = /^[ \t]*/.exec(l.s)![0];
          const indent = Math.min(32, [...lead].reduce((a, ch) => a + (ch === '\t' ? 4 : 1), 0));
          return (
          <div key={i} className={cx('diff-row', l.t === 'add' && 'diff-add', l.t === 'del' && 'diff-del')}>
            <span className="ln">{l.o ?? ''}</span>
            <span className={cx('ln', l.n !== undefined && marks.has(l.n) && 'relative !text-amber after:absolute after:top-0 after:right-0 after:h-full after:w-0.5 after:bg-amber')}>{l.n ?? ''}</span>
            <span className="sign">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span>
            <span className="src" style={{ '--ind': indent, paddingLeft: `${indent + 4}ch`, textIndent: '-4ch' } as CSSProperties}>
              {highlight(l.s.slice(lead.length), lang) || ' '}
            </span>
          </div>
          );
        })}
      </div>
      {big && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-line bg-surface-2/40 py-1 text-xs text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <ChevronsUpDown className="h-3 w-3" />
          {open ? 'Collapse' : `Show ${hunk.lines.length - HEAD_LINES} more lines`}
        </button>
      )}
    </div>
  );
}

/**
 * Unified diff for a set of hunks, grouped by file.
 * `marks` are code refs (findings, decisions) whose head lines get an amber gutter marker.
 */
export function DiffViewer({ files, hunkIds, collapseLarge = false, marks = [] }: { files: FileDiff[]; hunkIds: string[]; collapseLarge?: boolean; marks?: CodeRef[] }) {
  const want = new Set(hunkIds);
  const groups = files.map((f) => ({ f, hunks: f.hunks.filter((h) => want.has(h.id)) })).filter((g) => g.hunks.length);
  if (!groups.length) return <p className="px-3 py-2 text-sm text-fg-3">No diff hunks are attached to this unit.</p>;
  return (
    <div className="space-y-2">
      {groups.map(({ f, hunks }) => {
        const m = new Set<number>();
        for (const r of marks) if (r.path === f.path && r.side !== 'base') for (let i = r.startLine; i <= r.endLine; i++) m.add(i);
        const add = hunks.reduce((s, h) => s + h.lines.filter((l) => l.t === 'add').length, 0);
        const del = hunks.reduce((s, h) => s + h.lines.filter((l) => l.t === 'del').length, 0);
        const Icon = f.language === 'markdown' ? FileText : FileCode2;
        const i = f.path.lastIndexOf('/');
        return (
          <div key={f.id} className="overflow-hidden rounded-lg border border-line bg-bg">
            <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0 text-fg-3" />
              <span className="mono min-w-0 truncate text-xs" title={f.path}>
                <span className="text-fg-3">{f.path.slice(0, i + 1)}</span>
                <span className="text-fg">{f.path.slice(i + 1)}</span>
              </span>
              {f.status !== 'modified' && <span className="rounded bg-surface-2 px-1 text-2xs text-fg-3 uppercase">{f.status}</span>}
              <span className="num mono ml-auto shrink-0 text-xs">
                <span className="text-green">+{add}</span> <span className="text-red">−{del}</span>
              </span>
            </div>
            {hunks.map((h) => (
              <HunkView key={h.id} hunk={h} lang={f.language} collapsible={collapseLarge} marks={m} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** A quoted code reference: path:line header plus the verbatim quote. */
export function RefQuote({ r, lang, onOpen }: { r: CodeRef; lang?: string; onOpen?: (r: CodeRef) => void }) {
  const l = lang ?? (r.path.endsWith('.md') ? 'markdown' : r.path.endsWith('.cs') ? 'csharp' : 'text');
  const loc = `${r.path.split('/').pop()}:${r.startLine}${r.endLine !== r.startLine ? `–${r.endLine}` : ''}`;
  return (
    <div className="overflow-hidden rounded-md border border-line bg-bg">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-2.5 py-1">
        {onOpen ? (
          <button type="button" onClick={() => onOpen(r)} title={`${r.path} — show in the reading plan`} className="mono text-xs text-fg-2 underline-offset-2 hover:text-fg hover:underline">
            {loc}
          </button>
        ) : (
          <span className="mono text-xs text-fg-2" title={r.path}>
            {loc}
          </span>
        )}
        {r.side === 'base' && <span className="text-2xs text-fg-3 uppercase">base</span>}
      </div>
      {r.quote && (
        <pre className="code wrap-code px-2.5 py-1.5">
          {r.quote.split('\n').map((s, i) => (
            <div key={i}>{highlight(s, l) || ' '}</div>
          ))}
        </pre>
      )}
    </div>
  );
}
