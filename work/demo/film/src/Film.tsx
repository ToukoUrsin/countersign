import React from 'react';
import {AbsoluteFill, Audio, Easing, OffthreadVideo, Sequence, staticFile, useCurrentFrame, interpolate} from 'remotion';
import timing from '../timing.json';
import gh from '../gh.json';

const FPS = 30;
const C = {
  bg: '#05070a', white: '#f4f7fb', muted: '#9aa8b8', dim: '#5d6b7c', line: 'rgba(255,255,255,.12)',
  cyan: '#62d8ff', green: '#4fe29a', red: '#ff6e73', amber: '#f3c969', purple: '#9da4ff',
};
const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';

type TShot = {id: string; text: string; path: string; duration: number; chars?: string; starts?: number[]};
const T = timing as unknown as {duration: number; shots: TShot[]};
const shots = (() => { let t = 0; return T.shots.map((s) => { const o = {...s, start: t}; t += s.duration; return o; }); })();
type Shot = typeof shots[number];

// seconds into the shot where `needle` is spoken
const at = (s: Shot, needle: string) => {
  const i = (s.chars || s.text).indexOf(needle);
  if (i < 0 || !s.starts) return 0;
  return s.starts[Math.min(i, s.starts.length - 1)];
};
const ease = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1)});
const sentences = (s: Shot) => {
  const txt = s.chars || s.text; const out: {t: number; text: string}[] = [];
  const re = /[^.?!]+[.?!]?/g; let m;
  while ((m = re.exec(txt))) { const raw = m[0]; const lead = raw.length - raw.trimStart().length; const text = raw.trim(); if (!text) continue; out.push({t: s.starts ? s.starts[m.index + lead] : 0, text}); }
  return out;
};

// Camera moves, callouts and kicker come from the shot list (narration.json), so a new cut is a new shot list.
const COL: Record<string, string> = {cyan: C.cyan, green: C.green, red: C.red, amber: C.amber, purple: C.purple, dim: C.muted};
type Call = {at: string; text: string; color: string; big?: string};
const planOf = (s: any) => ({
  from: {x: s.cam?.from?.[0] ?? 960, y: s.cam?.from?.[1] ?? 540, z: s.cam?.from?.[2] ?? 1},
  to: {x: s.cam?.to?.[0] ?? 960, y: s.cam?.to?.[1] ?? 540, z: s.cam?.to?.[2] ?? 1},
  kicker: s.kicker ?? '', accent: COL[s.accent] ?? C.cyan,
  calls: ((s.calls ?? []) as Call[]).map((c) => ({...c, color: COL[c.color] ?? C.white})),
});
// where each recorded shot starts inside cut.mp4 (cards are not recorded)
const cutStart: Record<string, number> = (() => { let t = 0; const o: Record<string, number> = {}; for (const s of T.shots) { if (s.path !== 'CARD') { o[s.id] = t; t += s.duration; } } return o; })();

const FX = 60, FY = 56, FW = 1440, FH = 810;

const Product: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const p = planOf(s);
  const n = s.duration * FPS;
  const k = interpolate(local, [0, n], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const x = p.from.x + (p.to.x - p.from.x) * k, y = p.from.y + (p.to.y - p.from.y) * k, z = p.from.z + (p.to.z - p.from.z) * k;
  const S = (FW / 1920) * z;
  const left = Math.min(0, Math.max(FW - 1920 * S, FW / 2 - x * S));
  const top = Math.min(0, Math.max(FH - 1080 * S, FH / 2 - y * S));
  const inn = ease(local, 0, 12);
  return <div style={{position: 'absolute', left: FX, top: FY, width: FW, height: FH, borderRadius: 16, overflow: 'hidden', border: `1px solid ${p.accent}55`, boxShadow: `0 30px 90px rgba(0,0,0,.6), 0 0 0 6px ${p.accent}10`, background: '#08090b', opacity: inn, transform: `scale(${1.03 - .03 * inn})`}}>
    <OffthreadVideo src={staticFile('cut.mp4')} startFrom={Math.round(cutStart[s.id] * FPS)} muted style={{position: 'absolute', left, top, width: 1920 * S, height: 1080 * S}} />
  </div>;
};

const Rail: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const p = planOf(s);
  return <div style={{position: 'absolute', left: FX + FW + 34, top: FY, width: 1920 - FX - FW - 34 - 50, height: FH, fontFamily: FONT}}>
    <div style={{fontSize: 15, fontWeight: 800, letterSpacing: 2.4, color: p.accent, opacity: ease(local, 0, 14)}}>{p.kicker}</div>
    <div style={{marginTop: 26, display: 'flex', flexDirection: 'column', gap: 16}}>
      {p.calls.map((c, i) => {
        const f0 = Math.max(4, at(s, c.at) * FPS - 3);
        const o = ease(local, f0, f0 + 10);
        const pop = interpolate(local, [f0, f0 + 6, f0 + 14], [0.9, 1.04, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
        return <div key={i} style={{opacity: o, transform: `translateX(${(1 - o) * 30}px) scale(${pop})`, transformOrigin: 'left center', padding: c.big ? '14px 18px 16px' : '14px 18px', borderRadius: 12, background: `linear-gradient(135deg, ${c.color}22, rgba(12,16,22,.92))`, border: `1px solid ${c.color}88`}}>
          {c.big ? <div style={{fontSize: 64, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1, color: c.color === C.muted ? C.white : c.color}}>{c.big}</div> : null}
          <div style={{marginTop: c.big ? 6 : 0, fontSize: c.big ? 20 : 21, fontWeight: 650, lineHeight: 1.25, color: C.white}}>{c.text}</div>
        </div>;
      })}
    </div>
  </div>;
};

const DIGITS: [RegExp, string][] = [[/two hundred and ten/gi, '210'], [/two hundred and two/gi, '202'], [/ninety two/gi, '92'], [/\bninety\b/gi, '90'], [/\btwo line\b/gi, '2-line'], [/\btwo minutes\b/gi, '2 minutes'], [/\bpull request five\b/gi, 'pull request #5'], [/\bpull request two\b/gi, 'pull request #2'], [/\beight\b/gi, '8'], [/\bfive\b/gi, '5'], [/\bfour\b/gi, '4']];
const digits = (t: string) => DIGITS.reduce((a, [r, v]) => a.replace(r, v), t);
const chunks = (s: Shot) => {
  const out: {t: number; text: string}[] = [];
  const txt = s.chars || s.text;
  for (const sen of sentences(s)) {
    const base = txt.indexOf(sen.text);
    const words: {w: string; i: number}[] = []; const re = /\S+/g; let m;
    while ((m = re.exec(sen.text))) words.push({w: m[0], i: base + m.index});
    const parts: typeof words[] = [];
    if (words.length <= 10) parts.push(words);
    else { let cut = Math.ceil(words.length / 2); for (let k = 3; k < words.length - 3; k++) if (/,$/.test(words[k - 1].w) && Math.abs(k - words.length / 2) < Math.abs(cut - words.length / 2) + 2) cut = k; parts.push(words.slice(0, cut), words.slice(cut)); }
    for (const p of parts) out.push({t: s.starts ? s.starts[p[0].i] ?? sen.t : sen.t, text: digits(p.map((x) => x.w).join(' '))});
  }
  return out;
};
const Caption: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const ss = chunks(s); const t = local / FPS;
  let cur = ss[0]; for (const x of ss) if (t >= x.t - 0.05) cur = x;
  if (!cur) return null;
  const f0 = cur.t * FPS; const o = ease(local, f0 - 2, f0 + 5);
  return <div style={{position: 'absolute', left: FX, width: FW, top: FY + FH + 20, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT}}>
    <div style={{opacity: o, fontSize: 36, fontWeight: 650, color: C.white, letterSpacing: -.3, whiteSpace: 'nowrap'}}>{cur.text}</div>
  </div>;
};

const Footer: React.FC<{frame: number}> = ({frame}) => {
  const p = frame / (T.duration * FPS);
  return <>
    <div style={{position: 'absolute', left: FX, bottom: 34, fontFamily: FONT, fontSize: 15, fontWeight: 800, letterSpacing: 3, color: C.dim}}>COUNTERSIGN · JUNCTION 2026 · EARNED TRUST IN AI CODE</div>
    <div style={{position: 'absolute', right: 50, bottom: 40, width: 300, height: 3, background: C.line, borderRadius: 2}}><div style={{width: `${p * 100}%`, height: '100%', background: C.cyan, borderRadius: 2}} /></div>
  </>;
};

// ---- full screen cards ----
const Line: React.FC<{show: number; local: number; children: React.ReactNode; style?: React.CSSProperties; dimAt?: number}> = ({show, local, children, style, dimAt}) => {
  const o = ease(local, show, show + 9);
  const dim = dimAt !== undefined ? 1 - .6 * ease(local, dimAt, dimAt + 10) : 1;
  return <div style={{opacity: o * dim, transform: `translateY(${(1 - o) * 34}px)`, ...style}}>{children}</div>;
};

const G = gh as any;
const GhCard: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const f = (w: string) => at(s, w) * FPS;
  const z = interpolate(local, [0, s.duration * FPS], [1, 1.12]);
  const scroll = interpolate(local, [0, s.duration * FPS], [0, -1500], {easing: Easing.inOut(Easing.quad)});
  const files: string[] = G.files ?? [];
  const nfiles = f('Ninety'), name = f('Your name');
  const glow = ease(local, name, name + 8);
  const gb = {bg: '#0d1117', panel: '#161b22', line: '#30363d', text: '#e6edf3', muted: '#8d96a0', green: '#3fb950', red: '#f85149', amber: '#d29922', blue: '#2f81f7'};
  return <AbsoluteFill style={{background: gb.bg, fontFamily: '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif', overflow: 'hidden'}}>
    <AbsoluteFill style={{transform: `scale(${z})`, transformOrigin: '30% 30%'}}>
      <div style={{position: 'absolute', left: 120, top: 70, right: 120}}>
        <div style={{fontSize: 22, color: gb.muted}}>toukoursin / junction26-messagepack-csharp · Pull requests</div>
        <div style={{marginTop: 18, fontSize: 52, color: gb.text, fontWeight: 400}}>{G.title} <span style={{color: gb.muted}}>#{G.number}</span></div>
        <div style={{marginTop: 18, display: 'flex', gap: 14, alignItems: 'center', fontSize: 22, color: gb.muted}}>
          <span style={{background: gb.green, color: '#fff', padding: '6px 16px', borderRadius: 20, fontWeight: 600}}>Open</span>
          <span><b style={{color: gb.text}}>{G.author?.login}</b> wants to merge into <code style={{color: gb.blue}}>main</code></span>
        </div>
        <div style={{marginTop: 30, borderBottom: `1px solid ${gb.line}`, display: 'flex', gap: 40, fontSize: 24, color: gb.muted, paddingBottom: 14}}>
          <span>Conversation</span><span>Commits</span><span>Checks</span>
          <span style={{color: gb.text, fontWeight: 600, borderBottom: '3px solid #f78166', paddingBottom: 12, marginBottom: -16, transform: `scale(${1 + .15 * ease(local, nfiles, nfiles + 6) - .15 * ease(local, nfiles + 20, nfiles + 30)})`}}>Files changed <span style={{background: gb.line, borderRadius: 20, padding: '2px 12px'}}>{G.changedFiles}</span></span>
          <span style={{marginLeft: 'auto'}}><b style={{color: gb.green}}>+{G.additions}</b> <b style={{color: gb.red}}>−{G.deletions}</b></span>
        </div>
        <div style={{display: 'flex', gap: 30, marginTop: 24}}>
          <div style={{flex: 1, height: 560, overflow: 'hidden', border: `1px solid ${gb.line}`, borderRadius: 10}}>
            <div style={{transform: `translateY(${scroll}px)`}}>{files.map((x, i) => <div key={i} style={{padding: '11px 20px', borderBottom: `1px solid ${gb.line}`, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 19, color: gb.text, background: gb.panel, display: 'flex', justifyContent: 'space-between'}}><span>{x}</span><span style={{color: gb.green}}>▪▪<span style={{color: gb.red}}>▪▪</span></span></div>)}</div>
          </div>
          <div style={{width: 520, border: `1px solid ${glow > 0 ? gb.green : gb.line}`, borderRadius: 10, background: gb.panel, padding: 26, boxShadow: `0 0 ${60 * glow}px ${gb.green}55`}}>
            <div style={{fontSize: 24, color: gb.text, fontWeight: 600}}>Review changes</div>
            <div style={{marginTop: 18, height: 120, border: `1px solid ${gb.line}`, borderRadius: 8, color: gb.muted, fontSize: 20, padding: 14}}>Leave a comment</div>
            {['Comment', 'Approve', 'Request changes'].map((o, i) => <div key={o} style={{marginTop: 16, fontSize: 22, color: gb.text, display: 'flex', alignItems: 'center', gap: 12, opacity: i === 1 ? 1 : .6}}><span style={{width: 20, height: 20, borderRadius: 10, border: `2px solid ${i === 1 ? gb.green : gb.muted}`, background: i === 1 && glow > .5 ? gb.green : 'transparent'}} />{o}</div>)}
            <div style={{marginTop: 26, background: gb.green, color: '#fff', textAlign: 'center', padding: '14px 0', borderRadius: 8, fontSize: 22, fontWeight: 600, transform: `scale(${1 + .06 * glow})`}}>Submit review</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
    <div style={{position: 'absolute', right: 40, top: 26, fontSize: 15, color: gb.muted, letterSpacing: 1}}>GitHub data via the GitHub API, read-only</div>
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 210, background: 'linear-gradient(transparent, rgba(5,7,10,.96) 55%)'}} />
    <div style={{position: 'absolute', left: 120, bottom: 60, fontFamily: FONT, display: 'flex', gap: 40, alignItems: 'baseline'}}>
      <Line show={0} local={local} style={{fontSize: 64, fontWeight: 800, letterSpacing: -2, color: C.white}}>An AI agent wrote this.</Line>
      <Line show={nfiles - 2} local={local} style={{fontSize: 64, fontWeight: 800, letterSpacing: -2, color: C.cyan}}>92 files.</Line>
      <Line show={name - 2} local={local} style={{fontSize: 64, fontWeight: 800, letterSpacing: -2, color: C.amber}}>Your name on it.</Line>
    </div>
  </AbsoluteFill>;
};

const Rule: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const f = (w: string) => at(s, w) * FPS;
  const rule = f('The rule');
  const up = ease(local, rule - 4, rule + 10);
  const pop = interpolate(local, [0, 5, 12], [1.25, .97, 1], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{fontFamily: FONT, background: `radial-gradient(ellipse at 30% 40%, #0d1a14, ${C.bg} 70%)`}}>
    <div style={{position: 'absolute', left: 140, top: interpolate(up, [0, 1], [300, 110]), transform: `scale(${pop * (1 - .45 * up)})`, transformOrigin: 'left top'}}>
      <div style={{fontSize: 230, fontWeight: 800, letterSpacing: -10, lineHeight: .9, color: C.green}}>8 lines</div>
      <div style={{fontSize: 110, fontWeight: 800, letterSpacing: -4, color: C.white}}>are yours.</div>
    </div>
    <div style={{position: 'absolute', left: 140, top: 520}}>
      <Line show={rule - 3} local={local} style={{fontSize: 26, fontWeight: 800, letterSpacing: 4, color: C.cyan}}>COUNTERSIGN · THE RULE</Line>
      <Line show={f('skip a line') - 3} local={local} style={{marginTop: 22, fontSize: 76, fontWeight: 800, letterSpacing: -3, color: C.white}}>Skip a line only when <span style={{color: C.green}}>a run covers it.</span></Line>
      <Line show={f('Sign by name') - 3} local={local} style={{marginTop: 18, fontSize: 76, fontWeight: 800, letterSpacing: -3, color: C.white}}>Sign by name for <span style={{color: C.amber}}>everything else.</span></Line>
    </div>
  </AbsoluteFill>;
};

const Question: React.FC<{n: string; q: string; local: number; accent: string}> = ({n, q, local, accent}) => <>
  <Line show={0} local={local} style={{fontSize: 24, fontWeight: 800, letterSpacing: 4, color: accent}}>JUDGE QUESTION {n} / 3</Line>
  <Line show={2} local={local} style={{marginTop: 18, fontSize: 64, fontWeight: 800, letterSpacing: -2.5, color: C.white}}>{q}</Line>
</>;

const Distrust: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const items: [string, string][] = [['No requirement', 'No requirement'], ['Nothing ran', 'Nothing ran'], ['missed', 'The reviewer missed a planted bug'], ['probation', 'An area on probation'], ['spot check', 'A spot check is drawn']];
  const fin = at(s, 'every line') * FPS;
  return <AbsoluteFill style={{fontFamily: FONT, padding: '170px 140px'}}>
    <Question n="1" q="When do we distrust our own output?" local={local} accent={C.red} />
    <div style={{marginTop: 44, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, width: 1300}}>
      {items.map(([w, t], i) => <Line key={i} show={at(s, w) * FPS - 3} local={local} style={{padding: '20px 26px', borderRadius: 12, border: `1px solid ${C.red}77`, background: `${C.red}14`, fontSize: 32, fontWeight: 700, color: C.white}}><span style={{color: C.red, marginRight: 14}}>✕</span>{t}</Line>)}
      <Line show={fin - 3} local={local} style={{padding: '20px 26px', borderRadius: 12, background: C.amber, fontSize: 32, fontWeight: 800, color: '#111'}}>→ Then every line is read.</Line>
    </div>
  </AbsoluteFill>;
};

const Owner: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const a = at(s, 'The person') * FPS;
  const draw = ease(local, a + 4, a + 34);
  return <AbsoluteFill style={{fontFamily: FONT, padding: '170px 140px'}}>
    <Question n="2" q="Who owns the decision?" local={local} accent={C.green} />
    <Line show={a - 3} local={local} style={{marginTop: 60, fontSize: 110, fontWeight: 800, letterSpacing: -5, color: C.green}}>The person who signs.</Line>
    <div style={{marginTop: 30, fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 64, color: C.white, opacity: ease(local, a, a + 10), clipPath: `inset(0 ${100 - draw * 100}% 0 0)`}}>Aino Laine</div>
    <div style={{width: 420 * draw, height: 2, background: C.green, marginTop: 6}} />
  </AbsoluteFill>;
};

const Scale: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const a = at(s, 'Ninety') * FPS, b = at(s, 'Eight') * FPS;
  const n92 = Math.round(92 * ease(local, a - 3, a + 14));
  const n8 = Math.round(8 * ease(local, b - 3, b + 10));
  return <AbsoluteFill style={{fontFamily: FONT, padding: '170px 140px'}}>
    <Question n="3" q="How does it scale?" local={local} accent={C.cyan} />
    <Line show={at(s, 'Reading') * FPS - 3} local={local} style={{marginTop: 22, fontSize: 48, fontWeight: 700, color: C.muted}}>Reading follows risk, not diff size.</Line>
    <div style={{marginTop: 60, display: 'flex', gap: 120, alignItems: 'flex-end'}}>
      <Line show={a - 3} local={local}><div style={{fontSize: 220, fontWeight: 800, letterSpacing: -10, lineHeight: .9, color: C.white}}>{n92}</div><div style={{fontSize: 36, fontWeight: 700, color: C.muted}}>files changed</div></Line>
      <Line show={b - 3} local={local}><div style={{fontSize: 220, fontWeight: 800, letterSpacing: -10, lineHeight: .9, color: C.green}}>{n8}</div><div style={{fontSize: 36, fontWeight: 700, color: C.green}}>lines read by a person</div></Line>
    </div>
  </AbsoluteFill>;
};

const End: React.FC<{s: Shot; local: number}> = ({s, local}) => {
  const a = at(s, 'AI reviews') * FPS, b = at(s, 'A named') * FPS;
  return <AbsoluteFill style={{fontFamily: FONT, alignItems: 'center', justifyContent: 'center', textAlign: 'center'}}>
    <Line show={0} local={local} style={{fontSize: 130, fontWeight: 800, letterSpacing: -6, color: C.white}}>Countersign</Line>
    <Line show={a - 3} local={local} style={{marginTop: 20, fontSize: 52, fontWeight: 700, color: C.cyan}}>AI reviews.</Line>
    <Line show={b - 3} local={local} style={{marginTop: 8, fontSize: 52, fontWeight: 700, color: C.green}}>A named human countersigns.</Line>
  </AbsoluteFill>;
};

const CARDS: Record<string, React.FC<{s: Shot; local: number}>> = {gh: GhCard, rule: Rule, distrust: Distrust, owner: Owner, scale: Scale, end: End};

const ShotView: React.FC<{s: Shot}> = ({s}) => {
  const local = useCurrentFrame();
  const Card = CARDS[(s as any).card];
  if (Card && (s as any).card === 'gh') return <Card s={s} local={local} />;
  if (Card) return <AbsoluteFill style={{background: `radial-gradient(ellipse at 30% 30%, #0c1520, ${C.bg} 70%)`}}><Card s={s} local={local} /><Footer frame={local + s.start * FPS} /></AbsoluteFill>;
  return <AbsoluteFill><Product s={s} local={local} /><Rail s={s} local={local} /><Caption s={s} local={local} /><Footer frame={local + s.start * FPS} /></AbsoluteFill>;
};

export const Film: React.FC = () => {
  const total = Math.round(T.duration * FPS);
  return <AbsoluteFill style={{background: C.bg, color: C.white, overflow: 'hidden'}}>
    {shots.map((s) => <Sequence key={s.id} from={Math.round(s.start * FPS)} durationInFrames={Math.round(s.duration * FPS) + 1} name={s.id}><ShotView s={s} /></Sequence>)}
    <AbsoluteFill style={{pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.45) 100%)'}} />
    <Audio src={staticFile('voice.wav')} volume={1} />
    <Audio src={staticFile('music.wav')} volume={(f: number) => .5 * interpolate(f, [0, 20, total - 60, total], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />
  </AbsoluteFill>;
};
