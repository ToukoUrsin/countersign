import type { ReactNode } from 'react';

/** Deliberately light syntax highlighting: enough to read a diff, not a compiler. */
const CS_KW = new Set(
  'abstract as async await base bool break byte case catch char class const continue default do double else enum event false finally float for foreach get if in init int interface internal is long namespace new null object out override params partial private protected public readonly record ref return sealed set short static string struct switch this throw true try typeof uint ulong using var virtual void while yield where when not and or'.split(
    ' ',
  ),
);
const SH_KW = new Set('if then else fi for do done set echo exit cd git dotnet unzip grep bash'.split(' '));

const CS_RE = /(\/\/.*$)|("""[\s\S]*?(?:"""|$)|\$?@?"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)')|(\b\d[\d_.]*[fFdDmMuUlL]?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/gm;
const SH_RE = /(#.*$)|("(?:[^"\\]|\\.)*"?|'[^']*'?)|(\b\d+\b)|(\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|[A-Za-z_][A-Za-z0-9_-]*)|(\s+|.)/gm;

function tokens(line: string, lang: string): ReactNode[] {
  const out: ReactNode[] = [];
  const sh = lang === 'bash' || lang === 'sh' || lang === 'shell';
  const re = new RegExp(sh ? SH_RE : CS_RE);
  let m: RegExpExecArray | null;
  let i = 0;
  let plain = '';
  const flush = () => {
    if (plain) {
      out.push(plain);
      plain = '';
    }
  };
  const push = (cls: string, text: string) => {
    flush();
    out.push(
      <span key={i++} className={cls}>
        {text}
      </span>,
    );
  };
  while ((m = re.exec(line))) {
    if (m[0] === '') break;
    if (m[1]) push('tok-com', m[1]);
    else if (m[2]) push('tok-str', m[2]);
    else if (m[3]) push('tok-num', m[3]);
    else if (m[4]) {
      const w = m[4];
      if (sh) {
        if (w.startsWith('$')) push('tok-type', w);
        else if (SH_KW.has(w)) push('tok-kw', w);
        else plain += w;
      } else if (CS_KW.has(w)) push('tok-kw', w);
      else if (line[re.lastIndex] === '(') push('tok-fn', w);
      else if (/^[A-Z]/.test(w) && /[a-z]/.test(w)) push('tok-type', w);
      else plain += w;
    } else plain += m[5];
  }
  flush();
  return out;
}

export function highlight(line: string, lang: string): ReactNode {
  if (!line) return '';
  if (lang === 'csharp' || lang === 'cs' || lang === 'bash' || lang === 'sh' || lang === 'shell') {
    const t = line.trimStart();
    // documentation and line comments are a whole-line token
    if (lang.startsWith('c') && t.startsWith('//')) return <span className="tok-com">{line}</span>;
    return tokens(line, lang);
  }
  if (lang === 'markdown') {
    if (/^#{1,6}\s/.test(line)) return <span className="tok-kw">{line}</span>;
    const parts = line.split(/(`[^`]+`)/g);
    return parts.map((p, i) =>
      p.startsWith('`') ? (
        <span key={i} className="tok-str">
          {p}
        </span>
      ) : (
        p
      ),
    );
  }
  return line;
}

export function CodeBlock({ code, lang, className = '' }: { code: string; lang: string; className?: string }) {
  return (
    <pre className={`code overflow-x-auto ${className}`}>
      {code.split('\n').map((l, i) => (
        <div key={i} className="min-h-[18px]">
          {highlight(l, lang)}
        </div>
      ))}
    </pre>
  );
}
