/**
 * Ask: a question about the change, answered live from the dossier while you read.
 * The answer is an explanation. It is not evidence and it is never written into the dossier.
 */
import { ArrowUp, Sparkles, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Chapter, ChapterKind } from '../../lib/chapters';
import { ask, type FocusKind } from '../../lib/live';
import { cx } from '../../lib/util';
import { Kbd } from '../ui';
import { useReview } from './ctx';
import { proofGroups, selected } from './select';

const PROMPTS: Record<ChapterKind, string[]> = {
  brief: ['Why can I skip those lines?', 'What is the riskiest part of this change?', 'What does the AI not know here?'],
  change: ['Explain this as if I have never seen the code', 'What breaks if this is reverted?', 'What does it change besides the fix?'],
  how: ['Which step carries the most risk?', 'What does it change besides the fix?'],
  asked: ['Which criterion has the weakest proof?', 'What did the requirement leave open?'],
  proof: ['What was not executed?', 'What does this run actually prove?'],
  reviewer: ['Why were these findings killed?', 'What would the reviewer miss?'],
  finding: ['How was this reproduced?', 'What is the smallest fix?', 'Could this be intended?'],
  refusal: ['What evidence bears on this?', 'What does each option cost later?'],
  unit: ['What should I look at first?', 'Which tests cover this?', 'What could go wrong here?'],
  skipped: ['Why is it safe to skip this?', 'What would make this proof wrong?'],
  limits: ['What is the biggest unchecked risk?', 'How would I check the first one myself?'],
  sign: ['What am I accepting if I sign?', 'What is the strongest reason not to sign?'],
};

interface Exchange {
  q: string;
  a: string;
  streaming: boolean;
  error?: string;
}

/** Turns ids such as FN1, R2, U3, E7 and AC4 inside an answer into links to that part of the review. */
function Linked({ text }: { text: string }) {
  const r = useReview();
  const jump = (id: string): (() => void) | undefined => {
    if (r.list.some((c) => c.id === id)) return () => r.go(id);
    if (/^U\d+$/.test(id) && r.d.units.some((u) => u.id === id))
      return () => {
        r.select('skipped', id);
        r.go('skipped');
      };
    if (/^AC\d+$/.test(id) && r.d.requirement.criteria.some((c) => c.id === id))
      return () => {
        r.select('asked', id);
        r.go('asked');
      };
    if (/^E\d+$/.test(id) && proofGroups(r.d).some((g) => g.items.some((e) => e.id === id)))
      return () => {
        r.select('proof', id);
        r.go('proof');
      };
    return undefined;
  };
  const out: ReactNode[] = [];
  text.split(/(`[^`\n]+`|\b(?:FN|AC|R|U|E)\d+\b)/g).forEach((p, i) => {
    if (!p) return;
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2)
      out.push(
        <code key={i} className="icode">
          {p.slice(1, -1)}
        </code>,
      );
    else if (/^(?:FN|AC|R|U|E)\d+$/.test(p)) {
      const go = jump(p);
      out.push(
        go ? (
          <button key={i} type="button" onClick={go} className="num rounded-[4px] bg-surface-3 px-1 text-[0.92em] text-fg hover:bg-accent-strong hover:text-accent-fg">
            {p}
          </button>
        ) : (
          <span key={i} className="num text-fg">
            {p}
          </span>
        ),
      );
    } else out.push(p.replace(/\*\*/g, ''));
  });
  return <>{out}</>;
}

export function Ask({ ch, inputRef }: { ch: Chapter; inputRef: RefObject<HTMLInputElement | null> }) {
  const r = useReview();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [ex, setEx] = useState<Exchange>();
  const stop = useRef<() => void>(undefined);
  // what the model has sent so far; the panel shows it a few characters per frame so it reads as typing, not as jumps
  const got = useRef('');
  const raf = useRef(0);
  useEffect(
    () => () => {
      stop.current?.();
      cancelAnimationFrame(raf.current);
    },
    [],
  );

  const sel = selected(ch, r.d, r.sel);
  const focus: { kind: FocusKind; id: string } | undefined =
    ch.kind === 'finding' || ch.kind === 'refusal' || ch.kind === 'unit' ? { kind: ch.kind, id: ch.ref! } : ch.kind === 'asked' && sel ? { kind: 'criterion', id: sel } : ch.kind === 'proof' && sel ? { kind: 'evidence', id: sel } : ch.kind === 'skipped' && sel ? { kind: 'unit', id: sel } : undefined;
  const about = focus ? focus.id : 'this change';

  const live = useRef(false);
  const shown = useRef(0);
  const reveal = () => {
    cancelAnimationFrame(raf.current);
    const tick = () => {
      const left = got.current.length - shown.current;
      if (left > 0) {
        shown.current += Math.max(2, Math.ceil(left / 14));
        const a = got.current.slice(0, shown.current);
        setEx((p) => (p ? { ...p, a } : p));
      } else if (!live.current) {
        setEx((p) => (p && p.streaming ? { ...p, streaming: false } : p));
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const send = (text: string) => {
    const question = text.trim();
    if (!question) return;
    stop.current?.();
    got.current = '';
    shown.current = 0;
    live.current = true;
    setQ('');
    setEx({ q: question, a: '', streaming: true });
    reveal();
    stop.current = ask(r.d.slug, question, focus, {
      text: (t) => (got.current += t),
      done: () => (live.current = false),
      error: (message) => {
        live.current = false;
        if (!got.current) setEx((p) => (p ? { ...p, streaming: false, error: message } : p));
      },
    });
  };
  const halt = () => {
    stop.current?.();
    live.current = false;
    got.current = got.current.slice(0, shown.current);
  };
  const close = () => {
    halt();
    setEx(undefined);
    inputRef.current?.blur();
  };

  if (!r.live.enabled) return null;
  const typing = !!ex?.streaming;
  return (
    <div className="relative shrink-0 border-t border-line bg-bg">
      {ex && (
        <div className="anim-fade max-h-[38dvh] overflow-y-auto border-b border-line px-6 pt-4 pb-4">
          <div className="mx-auto max-w-[72ch]">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-fg-3">{ex.q}</p>
              <button type="button" aria-label="Close the answer" onClick={close} className="-mt-1 -mr-1.5 flex items-center gap-1.5 rounded p-1 text-fg-4 hover:bg-surface-2 hover:text-fg">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {ex.error ? (
              <p className="mt-2 text-base text-red">{ex.error}</p>
            ) : (
              <p aria-live="polite" aria-busy={typing} className={cx('mt-1.5 min-h-[3lh] text-md whitespace-pre-wrap text-fg', typing && 'caret')}>
                {ex.a ? <Linked text={ex.a} /> : <span className="shimmer-text text-fg-3">Reading the dossier</span>}
              </p>
            )}
            {!typing && !ex.error && <p className="mt-3 text-xs text-fg-4">Answered live by Gemini from the dossier. An explanation, not evidence: it is never added to what you sign.</p>}
          </div>
        </div>
      )}
      {focused && !q && !typing && (
        <div className="anim-fade absolute inset-x-0 bottom-full flex flex-wrap gap-1.5 border-t border-line bg-bg px-6 py-2.5">
          {PROMPTS[ch.kind].map((p) => (
            <button
              key={p}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                send(p);
              }}
              className="h-7 rounded-full border border-line px-3 text-sm text-fg-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg"
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex h-14 items-center gap-2.5 px-6"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <Sparkles className={cx('h-3.5 w-3.5 shrink-0 transition-colors', focused || ex ? 'text-fg' : 'text-fg-3')} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              if (q) setQ('');
              else {
                close();
                // give the keys back to the review: R, N and the rest do nothing while the caret sits here
                inputRef.current?.blur();
              }
            }
          }}
          placeholder={ex ? 'Ask a follow-up' : `Ask anything about ${about}`}
          aria-label={`Ask about ${about}`}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-3"
        />
        {typing && !q ? (
          <button
            type="button"
            aria-label="Stop the answer"
            onClick={halt}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-line text-fg-2 hover:bg-surface-2"
          >
            <Square className="h-2.5 w-2.5" fill="currentColor" />
          </button>
        ) : q ? (
          <button type="submit" aria-label="Ask" className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-strong text-accent-fg hover:bg-accent">
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        ) : (
          <Kbd>/</Kbd>
        )}
      </form>
    </div>
  );
}
