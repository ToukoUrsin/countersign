import { Check, Copy, X } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { copyText, cx } from '../lib/util';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  kbd?: string;
  loading?: boolean;
};
export function Button({ variant = 'secondary', size = 'md', icon, kbd, loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:opacity-45',
        size === 'sm' && 'h-6 px-2 text-xs',
        size === 'md' && 'h-7 px-2.5 text-sm',
        size === 'lg' && 'h-9 px-3.5 text-base',
        variant === 'primary' && 'bg-accent-strong text-accent-fg shadow-[inset_0_1px_0_oklch(1_0_0/0.16)] hover:bg-accent disabled:hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line-strong bg-surface text-fg hover:bg-surface-2 disabled:hover:bg-surface',
        variant === 'ghost' && 'text-fg-2 hover:bg-surface-2 hover:text-fg',
        variant === 'danger' && 'border border-red/40 text-red hover:bg-red/10',
        className,
      )}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {kbd && <Kbd className={variant === 'primary' ? 'border-white/25 bg-white/10 text-white/90' : ''}>{kbd}</Kbd>}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx('h-3.5 w-3.5 animate-spin', className)} aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line-strong bg-surface-2 px-1 font-sans text-[10.5px] font-medium text-fg-3', className)}>
      {children}
    </kbd>
  );
}

export function Tag({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-5 items-center gap-1 rounded-[5px] border border-line px-1.5 text-xs whitespace-nowrap text-fg-2', className)}>
      {children}
    </span>
  );
}

export function Avatar({ src, name, size = 20 }: { src?: string; name: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const initials = name
    .split(/[\s-_]+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return src && !bad ? (
    <img src={src} alt="" width={size} height={size} onError={() => setBad(true)} className="shrink-0 rounded-full bg-surface-2" style={{ width: size, height: size }} />
  ) : (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-semibold text-fg-2" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initials}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
      className={cx('inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg', className)}
    >
      {done ? <Check className="h-3.5 w-3.5 text-green" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? 'Copied' : label}
    </button>
  );
}

/** Modal dialog. Used only where focus must be protected (palette, confirmations). */
export function Dialog({ open, onClose, title, children, width = 480, top = '14vh' }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; width?: number; top?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', h, true);
    const t = setTimeout(() => {
      if (ref.current && !ref.current.contains(document.activeElement)) {
        (ref.current.querySelector<HTMLElement>('[data-autofocus], input, textarea, button') ?? ref.current).focus();
      }
    }, 10);
    return () => {
      window.removeEventListener('keydown', h, true);
      clearTimeout(t);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div data-modal className="anim-fade fixed inset-0 z-50 flex justify-center bg-black/45 px-4" style={{ paddingTop: top }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal aria-label={title} tabIndex={-1} className="anim-pop h-fit max-h-[76vh] w-full overflow-hidden rounded-xl bg-surface shadow-pop outline-none" style={{ maxWidth: width }}>
        {title && (
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-md font-semibold">{title}</h2>
            <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-fg-3 hover:bg-surface-2 hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SectionTitle({ children, count, aside, id }: { children: ReactNode; count?: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mb-3 flex items-baseline gap-2">
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{children}</h2>
      {count !== undefined && <span className="num text-sm text-fg-3">{count}</span>}
      {aside && <div className="ml-auto flex items-center gap-2 text-sm text-fg-3">{aside}</div>}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-lg border border-red/30 bg-red/8 px-3 py-2 text-sm text-fg">
      <span className="text-red">Could not load.</span>
      <span className="text-fg-2">{error.message}</span>
      {retry && (
        <Button size="sm" className="ml-auto" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function SyntheticTag() {
  return (
    <Tag className="border-dashed text-fg-3" title="Seeded demo history, not real sign-offs">
      synthetic history
    </Tag>
  );
}
