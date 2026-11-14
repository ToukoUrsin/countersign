export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

export const shortSha = (s?: string) => (s ? s.slice(0, 7) : '');

export function fmtMs(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} m ${String(Math.round(s % 60)).padStart(2, '0')} s`;
}

export function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function relTime(iso: string, nowMs = Date.now()): string {
  const d = (nowMs - new Date(iso).getTime()) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 14) return `${Math.round(d / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
/** Minutes for people: 45 min, 3 h, 3 h 20 min. */
export const fmtMin = (m: number) => {
  if (m < 90) return `${m} min`;
  const r = Math.round(m / 5) * 5;
  return `${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ''}`;
};
/** 95% Wilson interval for k successes in n tries, as whole percentages: how little a small sample says. */
export function wilson(k: number, n: number): string {
  if (!n) return 'no data';
  const z = 1.96;
  const p = k / n;
  const mid = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return `${Math.round(Math.max(0, mid - half) * 100)}–${Math.round(Math.min(1, mid + half) * 100)}%`;
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export function scrollToId(id: string, flash = true) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (flash) {
    el.animate([{ boxShadow: '0 0 0 2px var(--accent)' }, { boxShadow: '0 0 0 2px transparent' }], { duration: 1100, easing: 'ease-out' });
  }
  return true;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** First person from an agent's notes becomes third person: "I wrote a test" reads as "The agent wrote a test". Code spans are left alone. */
function third(s: string): string {
  if (!/\b(?:I|[Mm]y)\b/.test(s)) return s;
  let named = false;
  return s
    .split(/(`[^`\n]+`)/g)
    .map((part) => {
      if (part.startsWith('`')) return part;
      return part.replace(/\b(I|My|my)\b(?!['’](?:m|ve|ll|d)\b)( (?:am|have|do)\b)?/g, (m, w: string, aux: string | undefined, at: number, whole: string) => {
        const before = whole.slice(0, at).trimEnd();
        const starts = before === '' || /[.!?]$/.test(before);
        const own = w !== 'I';
        // an "I" inside a quoted identifier or a list such as "I, J" is not a pronoun
        if (!own && /^[,)\]>]/.test(whole.slice(at + m.length))) return m;
        const first = !named;
        named = true;
        const word = first ? (own ? `${starts ? 'The' : 'the'} agent's` : `${starts ? 'The' : 'the'} agent`) : own ? (starts ? 'Its' : 'its') : starts ? 'It' : 'it';
        const verb = !aux ? '' : aux === ' am' ? ' is' : aux === ' have' ? ' has' : ' does';
        return word + verb;
      });
    })
    .join('');
}

/**
 * Pipeline strings, made fit for the screen in one place. Counts written as "3 test(s)" get the right
 * form; the agent that checks the reviewer's work has one name, "a second agent"; agents do not speak
 * in the first person; model ids become the model's name; the pipeline's own shorthand (red→green,
 * ablation, probe) is said in words. Wording only: no claim changes.
 *
 * Only ever for text an AI or the pipeline wrote. What a person typed (a risk they accept, a note, a
 * quoted requirement) is shown exactly as typed: pass `verbatim`, or do not call this at all.
 */
export function tidy(s: string, opts: { verbatim?: boolean } = {}): string {
  if (opts.verbatim) return s;
  const out = s
    .replace(/\b(\d[\d,]*) ((?:[a-z-]+ ){0,2}?)([A-Za-z-]+)\(s\)( (?:are|were|fail|pass|regress|have)\b)?/g, (_m, n: string, mid: string, noun: string, verb?: string) => {
      const one = n === '1';
      const v = !verb ? '' : one ? ({ ' are': ' is', ' were': ' was', ' fail': ' fails', ' pass': ' passes', ' regress': ' regresses', ' have': ' has' } as Record<string, string>)[verb] : verb;
      return `${n} ${mid}${noun}${one ? '' : 's'}${v}`;
    })
    .replace(/\(s\)/g, 's');
  return third(
    plainWords(out)
      .replace(/\bindependent verifier agent\b/g, 'second agent')
      .replace(/\b([Tt])he verifier(?: agent)?(['’]s)/g, (_m, t: string, p: string) => `${t === 'T' ? 'A' : 'a'} second agent${p}`)
      .replace(/\b([Tt])he verifier agent\b/g, (_m, t: string) => `${t === 'T' ? 'A' : 'a'} second agent`)
      .replace(/\+ skeptic\b/g, '+ a second agent')
      .replace(/\bskeptic(?: agent)?\b/g, 'second agent')
      .replace(/\b([Tt])he blind reviewer (?=flagged|caught|missed)/g, '$1he reviewer, not told about them, ')
      .replace(/\bblind reviewer(?: agent)?\b/g, 'reviewer run blind')
      .replace(/\b(gemini|claude|gpt)-[a-z0-9][\w.-]*/gi, (_m, name: string) => ({ gemini: 'Gemini', claude: 'Claude', gpt: 'GPT' })[name.toLowerCase()] ?? name)
      .replace(/^T([0-3]) · /, (_m, n: string) => `${TIER_NAME[`T${n}`]} · `)
      .replace(/\badvice: (accept|accept-after-decisions|request-changes|needs-human)\b/g, (_m, v: string) => `advice: ${v.replace(/-/g, ' ')}`),
  );
}

/** The pipeline's shorthand for its own stages, said the way the product says it on screen. */
function plainWords(s: string): string {
  return s
    .replace(/^Execute: red ?→ ?green, regression, ablation$/, 'Run the tests: the new ones, the existing ones, and each hunk reverted on its own')
    .replace(/\bred ?→ ?green (\d+)\/(\d+)/g, 'new tests fail without the change and pass with it: $1 of $2')
    .replace(/\bregression (\d+)\/(\d+)/g, 'existing test runs clean: $1 of $2')
    .replace(/\bablation (\d+)\/(\d+) hunks noticed\b/g, 'reverted hunks a test noticed: $1 of $2')
    .replace(/\bred ?→ ?green\b/g, 'fail without the change, pass with it')
    .replace(/\b(were|was|are|is) (not|never) ablated\b/g, '$1 $2 reverted to see whether a test notices')
    .replace(/(?<![\/\-._\w])ablated(?![\/\-._\w])/g, 'reverted to see whether a test notices')
    .replace(/(?<![\/\-._\w])ablation(?![\/\-._\w])/g, 'hunk-revert check')
    .replace(/\bindependent probe runner\b/g, 'runner for the independent tests')
    .replace(/\b([Tt])he probe runner\b/g, '$1he runner for the independent tests')
    .replace(/\bindependent probes?\b/g, (m) => (m.endsWith('s') ? 'independent tests' : 'independent test'))
    .replace(/\bFAWMN\b/g, 'attribute')
    .replace(/(?<![\/\-._\w])canar(y|ies)(?![\/\-._\w])/g, (_m, e: string) => (e === 'y' ? 'planted bug' : 'planted bugs'));
}

/** What the routing tiers mean, in words. */
export const TIER_NAME: Record<string, string> = { T0: 'Covered by proof', T1: 'Skim', T2: 'Read', T3: 'Read closely' };

/** Sandbox paths are noise in an excerpt: keep the path inside the repository. */
export const repoPath = (s: string) => s.replace(/\/[^\s:'"]*?\/wt\/[^/\s]+\//g, '');

/** A skip proof as the policy words it, said so that someone who has never seen the product follows. */
export function plainProof(text: string): string {
  return text
    .split(' · ')
    .map((p) =>
      tidy(p)
        .replace(/^Tests fail on base, pass on head$/, 'the PR’s own tests fail without the change and pass with it')
        .replace(/^Golden files re-derived by a passing test run$/, 'a passing test run regenerated these snapshot files')
        .replace(/^Same (.+?) in (\d+) of (\d+) files; (\d+) exceptions? listed$/, 'the same $1 in $2 of $3 files, with $4 listed as the exception')
        .replace(/^Area [“"](.+?)[”"] is (\w+)$/, (_m, a: string, l: string) => `the area “${a}” has earned the trust level “${l.toLowerCase()}”`),
    )
    .join('; ');
}
