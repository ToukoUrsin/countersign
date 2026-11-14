/** Small parts shared by the guide and the stage. Colour is state only: green holds, red fails, amber is what stops the sign-off. */
import { useContext, useState, type ReactNode } from 'react';
import type { Dossier, Strength as StrengthT } from '../../../../shared/dossier';
import type { ChapterState } from '../../lib/chapters';
import { cx, tidy } from '../../lib/util';
import { ReviewContext } from './ctx';

export type GlyphState = ChapterState | 'fail' | 'half' | 'current' | 'open';

/** Status glyph, 14px. */
export function Glyph({ state, className }: { state: GlyphState; className?: string }) {
  const c = cx('h-3.5 w-3.5 shrink-0', className);
  if (state === 'done')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Done">
        <circle cx="7" cy="7" r="6" fill="var(--green)" />
        <path d="M4.3 7.2l1.9 1.9 3.6-4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (state === 'fail')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Fails">
        <circle cx="7" cy="7" r="6" fill="var(--red)" />
        <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" fill="none" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (state === 'needs')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Needs you">
        <circle cx="7" cy="7" r="5.25" fill="none" stroke="var(--amber)" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2.4" fill="var(--amber)" />
      </svg>
    );
  if (state === 'open')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Needs you">
        <circle cx="7" cy="7" r="5.25" fill="none" stroke="var(--fg-3)" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2.2" fill="var(--fg-2)" />
      </svg>
    );
  if (state === 'half')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Partly backed">
        <circle cx="7" cy="7" r="5.25" fill="none" stroke="var(--amber)" strokeWidth="1.5" />
        <path d="M7 3.4a3.6 3.6 0 0 1 0 7.2z" fill="var(--amber)" />
      </svg>
    );
  if (state === 'seen')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-label="Seen">
        <circle cx="7" cy="7" r="5.25" fill="none" stroke="var(--fg-4)" strokeWidth="1.5" />
        <path d="M4.6 7.2l1.7 1.7 3.1-3.5" fill="none" stroke="var(--fg-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (state === 'current')
    return (
      <svg viewBox="0 0 14 14" className={c} aria-hidden>
        <circle cx="7" cy="7" r="5.25" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="2.4" fill="var(--accent)" />
      </svg>
    );
  return (
    <svg viewBox="0 0 14 14" className={c} aria-label="Not opened">
      <circle cx="7" cy="7" r="5.25" fill="none" stroke="var(--fg-4)" strokeWidth="1.5" strokeDasharray="2.2 2.2" />
    </svg>
  );
}

const STRENGTH: Record<StrengthT, { bars: number; label: string; title: string }> = {
  executed: { bars: 3, label: 'Executed', title: 'A command ran in the sandbox. The output is attached and can be re-run.' },
  'verified-static': { bars: 2, label: 'Verified in code', title: 'A deterministic check on the code. No model judgment.' },
  reasoned: { bars: 1, label: 'Reasoning only', title: 'A model read the code and concluded this. Nothing was run.' },
  none: { bars: 0, label: 'No evidence', title: 'Nothing backs this.' },
};

/** How strongly something is backed: three bars for a run, two for a deterministic check, one for reasoning. */
export function Strength({ s, label = false, className }: { s: StrengthT; label?: boolean; className?: string }) {
  const m = STRENGTH[s];
  return (
    <span title={`${m.label}. ${m.title}`} className={cx('inline-flex shrink-0 items-center gap-1.5 text-sm text-fg-3', className)}>
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1 + i * 4} y={8 - i * 3} width="2.5" height={3 + i * 3} rx="0.8" fill={i < m.bars ? 'var(--fg-2)' : 'var(--line-strong)'} />
        ))}
      </svg>
      {label ? m.label : <span className="sr-only">{m.label}</span>}
    </span>
  );
}

/** What an id such as E3, AC1, FN2, U4 or R1 stands for in this dossier, or undefined when it is not one. */
function idMeaning(d: Dossier, id: string): string | undefined {
  const short = (s: string) => {
    const t = tidy(s).replace(/`/g, '').replace(/\s+/g, ' ').trim();
    return t.length > 150 ? `${t.slice(0, 147).trimEnd()}…` : t;
  };
  if (id.startsWith('AC')) {
    const c = d.requirement.criteria.find((x) => x.id === id);
    return c && `Acceptance criterion ${id.slice(2)}: ${short(c.text)}`;
  }
  if (id.startsWith('FN')) {
    const f = d.findings.find((x) => x.id === id);
    return f && `Finding ${id.slice(2)}: ${short(f.title)}`;
  }
  if (id.startsWith('E')) {
    const e = d.evidence.find((x) => x.id === id);
    return e && `Evidence ${id.slice(1)}, ${e.strength === 'executed' ? 'a run' : e.strength === 'verified-static' ? 'a check on the code' : 'reasoning only'}: ${short(e.conclusion)}`;
  }
  if (id.startsWith('U')) {
    const u = d.units.find((x) => x.id === id);
    return u && `Change unit ${id.slice(1)}, one idea in the diff: ${short(u.title)}`;
  }
  const r = d.refusals.find((x) => x.id === id);
  return r && `Decision ${id.slice(1)}, left to you: ${short(r.question)}`;
}

/** Plain text in which the dossier's ids say what they are when pointed at. */
function WithIds({ text }: { text: string }) {
  const d = useContext(ReviewContext)?.d;
  const s = soft(text);
  if (!d || !/[A-Z]\d/.test(s)) return <>{s}</>;
  return (
    <>
      {s.split(/\b((?:AC|FN|E|U|R)\d{1,3})\b(?![.\w-])/g).map((p, i) => {
        const what = i % 2 ? idMeaning(d, p) : undefined;
        return what ? (
          <abbr key={i} title={what} className="idref">
            {p}
          </abbr>
        ) : (
          p
        );
      })}
    </>
  );
}

/** Words a person typed. Shown exactly as typed: no rewording, no formatting. */
export const Typed = ({ text }: { text: string }) => <span className="whitespace-pre-wrap">{text}</span>;

/**
 * AI-written text with `code` spans. `verbatim` is for a person's own words (a quoted requirement, a
 * risk they typed): nothing is reworded.
 */
export function Rich({ text, verbatim }: { text: string; verbatim?: boolean }) {
  const parts = tidy(text, { verbatim }).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.length > 2 && p.startsWith('`') && p.endsWith('`') ? (
          <code key={i} className="icode">
            {p.slice(1, -1)}
          </code>
        ) : p.length > 4 && p.startsWith('**') && p.endsWith('**') ? (
          <span key={i} className="font-medium text-fg">
            {p.slice(2, -2)}
          </span>
        ) : verbatim ? (
          soft(p)
        ) : (
          <WithIds key={i} text={p} />
        ),
      )}
    </>
  );
}

/** Raw tool output pasted into a sentence: a line with no spaces (a test name) followed by its output. */
const isOutput = (p: string) => /^[\w.<>]+[._][\w.<>()]+\n/.test(p) || (p.length > 240 && (p.match(/[\w.]{40,}/g)?.length ?? 0) >= 3 && !/[a-z]{3,} [a-z]{2,} [a-z]{2,} [a-z]{2,} [a-z]{2,}/.test(p));
const LONG_CODE = 40;
/** Long dotted names may break after a dot instead of in the middle of a word. */
const soft = (s: string) => s.replace(/[\w.<>]{28,}/g, (w) => w.replace(/\.(?=\w)/g, '.\u200b').replace(/_(?=\w)/g, '_\u200b'));

/**
 * Running text from the pipeline, set to be read. Paragraphs stay paragraphs, a long code span gets its
 * own line instead of breaking the sentence into chips, and pasted test output becomes a small block.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const paras = tidy(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={cx('space-y-3', className)}>
      {paras.map((p, i) => {
        if (isOutput(p)) {
          const long = p.length > 420;
          return (
            <div key={i}>
              <pre className={cx('code block-code text-fg-2', long && !open && 'max-h-[132px] overflow-hidden')}>{p}</pre>
              {long && (
                <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 text-sm text-fg-3 underline decoration-line-strong underline-offset-4 hover:text-fg">
                  {open ? 'Show less' : 'Show all of the output'}
                </button>
              )}
            </div>
          );
        }
        const bits = p.split(/(`[^`\n]+`)/g).filter(Boolean);
        // lifting a span is only clean when the sentence does not close a bracket right after it
        const lifts = (j: number) => bits[j].startsWith('`') && bits[j].length - 2 > LONG_CODE && !/^\s*[.,;]?\s*[)\]]/.test(bits[j + 1] ?? '');
        if (!bits.some((_b, j) => lifts(j)))
          return (
            <p key={i}>
              <Rich text={p} />
            </p>
          );
        // long code leaves the sentence; the words around it keep flowing
        const out: ReactNode[] = [];
        let run = '';
        const flush = () => {
          const t = run.replace(/^\s*[.,;]\s*/, '').trim();
          if (t)
            out.push(
              <p key={out.length}>
                <Rich text={t} />
              </p>,
            );
          run = '';
        };
        for (const [j, b] of bits.entries()) {
          if (lifts(j)) {
            flush();
            out.push(
              <pre key={out.length} className="code block-code text-fg">
                {b.slice(1, -1)}
              </pre>,
            );
          } else run += b;
        }
        flush();
        return (
          <div key={i} className="space-y-1.5">
            {out}
          </div>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div
      role="tablist"
      data-tabs
      className="flex items-center gap-1"
      onKeyDown={(e) => {
        // inside the tab row the arrows move between tabs, not between chapters
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        const i = (tabs.findIndex((t) => t.id === value) + step + tabs.length) % tabs.length;
        onChange(tabs[i].id);
        requestAnimationFrame(() => (e.currentTarget.children[i] as HTMLElement | undefined)?.focus());
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          tabIndex={t.id === value ? 0 : -1}
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cx('h-7 rounded-full px-3 text-sm font-medium transition-colors', t.id === value ? 'bg-surface-2 text-fg' : 'text-fg-3 hover:bg-surface hover:text-fg-2')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A selectable line in the guide. Selecting it puts its detail on the stage. */
export function Row({ selected, onClick, lead, children, aside, title }: { selected?: boolean; onClick?: () => void; lead?: ReactNode; children: ReactNode; aside?: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={selected}
      className={cx('-mx-2.5 flex w-[calc(100%+20px)] items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors', selected ? 'bg-surface-2' : 'hover:bg-surface')}
    >
      {lead && <span className="mt-[3px] flex shrink-0">{lead}</span>}
      <span className={cx('min-w-0 flex-1 text-base', selected ? 'text-fg' : 'text-fg-2')}>{children}</span>
      {aside && <span className="mt-px flex shrink-0 items-center gap-2 text-sm text-fg-3">{aside}</span>}
    </button>
  );
}

export function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mt-7 mb-1.5 flex items-baseline justify-between gap-3 text-sm font-medium text-fg-3">
      <span>{children}</span>
      {aside && <span className="num font-normal">{aside}</span>}
    </div>
  );
}

export const kindLabel: Record<string, string> = {
  'core-logic': 'core logic',
  'api-surface': 'public API',
  test: 'tests',
  generated: 'generated output',
  mechanical: 'mechanical edit',
  docs: 'docs',
  'build-config': 'build config',
};
