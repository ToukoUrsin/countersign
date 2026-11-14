/** A small proof bar: the share of a change that is yours to read, to skim, proven by a run, and already read. Same colours as the proof map. */
import type { MarkState } from '../lib/proofmap';
import { cx } from '../lib/util';

const ORDER: MarkState[] = ['read', 'yours', 'skim', 'proven'];
const COLOR: Record<MarkState, string> = { yours: 'var(--pm-yours)', skim: 'var(--pm-skim)', proven: 'var(--pm-proven)', read: 'var(--pm-read)' };

export function ProofBar({ counts, className, height = 6 }: { counts: Partial<Record<MarkState, number>>; className?: string; height?: number }) {
  const total = ORDER.reduce((a, k) => a + (counts[k] ?? 0), 0);
  return (
    <span className={cx('flex w-full gap-px overflow-hidden rounded-[2px]', className)} style={{ height }} aria-hidden>
      {total === 0 ? (
        <span className="flex-1 bg-surface-3" />
      ) : (
        ORDER.filter((k) => counts[k]).map((k) => <span key={k} style={{ background: COLOR[k], flexGrow: counts[k], flexBasis: 0, minWidth: 3, transition: 'flex-grow 420ms var(--ease-out-expo)' }} />)
      )}
    </span>
  );
}
