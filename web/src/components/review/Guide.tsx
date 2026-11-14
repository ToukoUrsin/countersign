/** The guide: one chapter at a time, in plain words. What it says is backed by what is on the stage. */
import { ArrowUpRight, Check, ChevronRight, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Criterion, Dossier, Evidence, Strength as StrengthT } from '../../../../shared/dossier';
import type { Chapter } from '../../lib/chapters';
import { chapterState, place } from '../../lib/chapters';
import { cx, fmtMin, plural, shortSha, tidy, TIER_NAME } from '../../lib/util';
import { Button, Kbd, Spinner } from '../ui';
import { Prose } from './atoms';
import { Glyph, kindLabel, Label, Rich, Row, Strength, type GlyphState } from './atoms';
import { fullReadReason, isSkim, planMinutes } from '../../../../shared/gate';
import { useReview } from './ctx';
import { OnGitHub } from './OnGitHub';
import { proofGroups, selected } from './select';

const two = (n: number) => String(n).padStart(2, '0');

function Head({ ch, title, meta, long }: { ch: Chapter; title: ReactNode; meta?: ReactNode; long?: boolean }) {
  const { list } = useReview();
  const at = place(list, ch);
  return (
    <header>
      {ch.section !== 'brief' && (
        <div className="num text-sm text-fg-3" title={ch.section === 'you' ? `Step ${at.i} of ${at.n} that need you` : `Evidence, ${at.i} of ${at.n}. Nothing here is required before you sign`}>
          {ch.section === 'evidence' && <span className="mr-1.5">Evidence</span>}
          <span className="text-fg-2">{two(at.i)}</span> / {two(at.n)}
        </div>
      )}
      <h1 className={cx('mt-2 font-medium tracking-[-0.015em] text-balance text-fg', long ? 'text-xl' : 'text-2xl')}>{title}</h1>
      {meta && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-3">{meta}</div>}
    </header>
  );
}

const Lead = ({ children }: { children: ReactNode }) => <p className="mt-5 text-lg text-fg-2">{children}</p>;
/** The same voice as Lead, for text that may hold several paragraphs, code or pasted output. */
const LeadProse = ({ text }: { text: string }) => <Prose text={text} className="mt-5 text-lg text-fg-2 [&>*:not(:first-child)]:text-base" />;
const Body = ({ text }: { text: string }) => <Prose text={text} className="text-base text-fg-2" />;
const Dot = () => <span className="text-fg-4">·</span>;

function UnitLink({ id }: { id: string }) {
  const r = useReview();
  const u = r.d.units.find((x) => x.id === id);
  if (!u) return null;
  return (
    <button
      type="button"
      title={u.title}
      onClick={() => {
        if (r.list.some((c) => c.id === id)) r.go(id);
        else {
          r.select('skipped', id);
          r.go('skipped');
        }
      }}
      className="num inline-flex h-5 items-center rounded-[5px] border border-line px-1.5 text-xs text-fg-3 transition-colors hover:border-line-strong hover:text-fg"
    >
      {id}
    </button>
  );
}

// ───────────────────────────── brief ─────────────────────────────
/** One thing the signer has to do: what, how much, and whether it is done. Opens the first open item. */
function Todo({ state, title, sub, aside, onClick }: { state: 'left' | 'done' | 'none'; title: ReactNode; sub?: ReactNode; aside?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group -mx-2.5 flex w-[calc(100%+20px)] items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-surface">
      <Glyph state={state === 'done' ? 'done' : state === 'none' ? 'seen' : 'open'} className="mt-[3px]" />
      <span className="min-w-0 flex-1">
        <span className={cx('block text-base font-medium', state === 'none' ? 'text-fg-2' : 'text-fg')}>{title}</span>
        {sub && <span className="mt-0.5 block text-sm text-fg-3">{sub}</span>}
      </span>
      <span className="num mt-px flex shrink-0 items-center gap-1 text-sm text-fg-3">
        {aside}
        <ChevronRight className="h-3.5 w-3.5 text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg-2" />
      </span>
    </button>
  );
}

/** Rates from the policy file's reading section: minutes per decision and per finding. */
const MIN_DECISION = 0.75;
const MIN_FINDING = 0.5;
const mins = (m: number) => `about ${Math.max(1, Math.round(m))} min`;

function Brief({ ch }: { ch: Chapter }) {
  const r = useReview();
  const { d, c } = r;
  const ro = d.routing;
  const full = fullReadReason(d);
  const a = d.signoff;
  const open = (x: Chapter) => chapterState(x, d, r.readIds, new Set()) === 'needs';
  const jump = (kind: Chapter['kind']) => {
    const of = r.list.filter((x) => x.kind === kind);
    const to = of.find(open) ?? of[0];
    r.go(to ? to.id : 'sign');
  };

  const crit = d.requirement.criteria;
  const proven = crit.filter((x) => x.status === 'proven').length;
  const violated = crit.filter((x) => x.status === 'violated').length;

  const blocking = d.refusals.filter((x) => x.blocking).length;
  const reproduced = d.findings.filter((f) => f.strength === 'executed').length;
  const unitsLeft = c.required.length - c.requiredRead;
  const readLines = full ? ro.totalLines : ro.readLines;
  const sampled = ro.spotCheck.selected;
  const spotDone = r.spot.missed === false || (r.spot.missed === true && !!r.spot.note.trim());
  const left = r.list.filter((x) => x.required && open(x)).length + (sampled && !spotDone && !a ? 1 : 0);
  const readMin = Math.max(1, ro.estMinutes - d.refusals.length * MIN_DECISION - d.findings.length * MIN_FINDING);
  /** stages that failed: what they would have checked was not checked, and the brief says so first */
  const failedStages = d.stages.filter((x) => x.status === 'failed').length;
  const nothing = !failedStages && !d.refusals.length && !d.findings.length && !c.required.length;

  return (
    <>
      <Head ch={ch} title="Brief" />
      <Lead>
        <span className="text-fg">
          {a
            ? `${a.signerName ?? `@${a.signer}`}${a.cosign ? ` and ${a.cosign.signerName ?? `@${a.cosign.signer}`}` : ''} ${a.decision === 'accepted' ? 'countersigned' : 'asked for changes on'} this change.`
            : failedStages
              ? `This review is incomplete: ${failedStages === 1 ? 'one of its stages' : `${failedStages} of its stages`} failed. What ${failedStages === 1 ? 'it' : 'they'} would have checked was not checked.`
              : nothing
                ? 'An AI reviewed this pull request and found nothing that needs your reading. It still needs your name.'
              : 'An AI reviewed this pull request. This is what it could not do for you.'}
        </span>
      </Lead>

      <dl className="mt-4 grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-base">
        <dt className="text-fg-3">Asked</dt>
        <dd className="min-w-0 text-fg-2">
          <button type="button" onClick={() => r.go('asked')} className="text-left hover:text-fg" title="Open the requirement and its acceptance criteria">
            <span className="line-clamp-2">
              <span className="num mr-1.5 text-fg-3">{d.requirement.id}</span>
              <Rich text={d.requirement.title} verbatim />
            </span>
          </button>
          <span className="mt-0.5 block text-sm text-fg-3">
            {crit.length ? (
              <>
                {proven} of {crit.length} acceptance criteria proven by a run{violated > 0 && <span className="text-red">, {violated} violated</span>}
              </>
            ) : (
              'No acceptance criteria were derived from it'
            )}
          </span>
        </dd>
        <dt className="text-fg-3">Advice</dt>
        <dd className="min-w-0 text-fg-2">
          <span className="font-medium text-fg">{ADVICE[d.recommendation.verdict].charAt(0).toUpperCase() + ADVICE[d.recommendation.verdict].slice(1)}.</span> The AI advises. It does not decide: the check turns green only on a named signature.
        </dd>
      </dl>

      <Label aside={a ? undefined : nothing ? 'about 2 min' : left === 0 ? 'all done' : `about ${fmtMin(planMinutes(d))}`}>{a ? 'What was done' : 'What you must do'}</Label>
      <div>
        {d.refusals.length > 0 ? (
          <Todo
            state={blocking === 0 && c.decisionsAnswered === 0 ? 'none' : c.blockingOpen === 0 && c.decisionsAnswered >= blocking ? 'done' : 'left'}
            title={blocking === 0 ? `${plural(d.refusals.length, 'question')} the AI left to you, optional` : `Decide ${plural(d.refusals.length, 'question')} the AI refused`}
            sub={blocking ? `${blocking === d.refusals.length ? (blocking === 1 ? 'It blocks' : 'All block') : `${blocking} block${blocking === 1 ? 's' : ''}`} the sign-off. No option is recommended.` : 'None blocks the sign-off. No option is recommended.'}
            aside={c.decisionsAnswered ? `${c.decisionsAnswered} of ${d.refusals.length} answered` : mins(d.refusals.length * MIN_DECISION)}
            onClick={() => jump('refusal')}
          />
        ) : (
          <Todo state="none" title="No decisions were left to you" sub="Nothing turned on intent or risk appetite" onClick={() => r.go('limits')} />
        )}
        {d.findings.length > 0 ? (
          <Todo
            state={c.findingsJudged === c.findingsTotal ? 'done' : 'left'}
            title={`Judge ${plural(d.findings.length, 'finding')}: real or not real`}
            sub={reproduced ? `${reproduced === d.findings.length ? (reproduced === 1 ? 'Reproduced' : 'All reproduced') : `${reproduced} reproduced`} by a failing test` : 'Argued from the code, none reproduced by a run'}
            aside={c.findingsJudged ? `${c.findingsJudged} of ${c.findingsTotal} judged` : mins(d.findings.length * MIN_FINDING)}
            onClick={() => jump('finding')}
          />
        ) : (
          <Todo state="none" title="No findings to judge" sub="Nothing the reviewer raised survived checking" onClick={() => r.go(r.list.some((x) => x.id === 'reviewer') ? 'reviewer' : 'proof')} />
        )}
        {c.required.length > 0 ? (
          <Todo
            state={unitsLeft === 0 ? 'done' : 'left'}
            title={full ? `Read all ${ro.totalLines} changed lines` : readLines && ro.skimLines ? `Read ${readLines} and skim ${ro.skimLines} of ${ro.totalLines} changed lines` : ro.skimLines ? `Skim ${ro.skimLines} of ${ro.totalLines} changed lines` : `Read ${readLines} of ${ro.totalLines} changed lines`}
            sub={full ? (sampled ? 'Drawn for a spot check, so nothing is skipped' : 'The review earned no skip. The reason is on the right') : `${plural(c.required.length, 'unit')}, each one idea in the diff`}
            aside={c.requiredRead ? `${c.requiredRead} of ${c.required.length} read` : full ? `${plural(c.required.length, 'unit')}` : mins(readMin)}
            onClick={() => jump('unit')}
          />
        ) : (
          <Todo
            state="none"
            title={d.units.length ? 'Nothing to read' : 'No reading plan'}
            sub={d.units.length ? `All ${ro.totalLines} lines are covered by a run or a deterministic check` : 'The diff was not grouped into units'}
            onClick={() => r.go(r.list.some((x) => x.id === 'skipped') ? 'skipped' : 'proof')} />
        )}
        {sampled && <Todo state={spotDone || a ? 'done' : 'left'} title="Say what your full read found" sub="Did you find anything the AI missed?" onClick={() => r.go('sign')} />}
        <Todo
          state={a ? 'done' : 'left'}
          title={a ? `Signed by ${a.signerName ?? `@${a.signer}`}${a.cosign ? ` and ${a.cosign.signerName ?? `@${a.cosign.signer}`}` : ''}` : 'Sign by name'}
          sub={a ? `At commit ${shortSha(a.headSha)}, after ${Math.max(1, Math.round(a.reviewSeconds / 60))} min` : left ? `Unlocks when the ${left === 1 ? 'item' : left} above ${left === 1 ? 'is' : 'are'} done` : 'For what was checked, and nothing else'}
          aside={a ? undefined : left ? 'locked' : 'ready'}
          onClick={() => r.go('sign')}
        />
      </div>
    </>
  );
}

// ───────────────────────────── understand ─────────────────────────────
const ADVICE: Record<Dossier['recommendation']['verdict'], string> = {
  accept: 'accept',
  'accept-after-decisions': 'accept once your decisions are made',
  'changes-requested': 'request changes',
  'full-read-required': 'read all of it',
};

function Change({ ch }: { ch: Chapter }) {
  const { d } = useReview();
  const ro = d.routing;
  const pct = (n: number) => `${(100 * n) / Math.max(1, ro.totalLines)}%`;
  const full = fullReadReason(d);
  return (
    <>
      <Head ch={ch} title="The change" />
      <Lead>
        <span className="text-fg">
          <Rich text={d.story.headline} />
        </span>
      </Lead>
      <div className="mt-6 space-y-4 text-base text-fg-2">
        <div>
          <div className="mb-1 text-sm font-medium text-fg-3">Before</div>
          <Rich text={d.story.before} />
        </div>
        <div>
          <div className="mb-1 text-sm font-medium text-fg-3">After</div>
          <Rich text={d.story.after} />
        </div>
      </div>

      <Label aside={full ? undefined : `about ${ro.estMinutes} min`}>What you are asked to read</Label>
      {full ? (
        <>
          <div className="h-1.5 rounded-full bg-accent" />
          <p className="num mt-2 text-base text-fg-2">
            <span className="font-medium text-fg">All {ro.totalLines}</span> changed lines. {full}
          </p>
          <p className="mt-2 text-sm text-fg-3">
            Without that, the plan would have been {ro.readLines} lines to read{ro.skimLines > 0 ? `, ${ro.skimLines} to skim` : ''}
            {ro.skipLines > 0 ? ` and ${ro.skipLines} covered by proof` : ''}.
          </p>
        </>
      ) : (
        <>
          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
            {ro.readLines > 0 && <span className="rounded-full bg-accent" style={{ width: pct(ro.readLines), minWidth: 6 }} />}
            {ro.skimLines > 0 && <span className="rounded-full bg-accent/45" style={{ width: pct(ro.skimLines), minWidth: 6 }} />}
            {ro.skipLines > 0 && <span className="flex-1 rounded-full bg-surface-3" />}
          </div>
          <p className="num mt-2 text-base text-fg-2">
            <span className="font-medium text-fg">{ro.readLines}</span> of {ro.totalLines} changed lines.
            {ro.skimLines > 0 && ` ${ro.skimLines} more to skim.`}
            {ro.skipLines > 0 && ` ${ro.skipLines} are covered by proof and need no reading.`}
          </p>
        </>
      )}
      <p className="mt-5 text-sm text-fg-3">
        The advice is to {ADVICE[d.recommendation.verdict]}. Advice is not approval: the check on the pull request turns green only when a named person signs.
      </p>
    </>
  );
}

function How({ ch }: { ch: Chapter }) {
  const { d, setHot } = useReview();
  return (
    <>
      <Head ch={ch} title="How it works" />
      <Lead>
        Each step is one idea in the diff.<span className="max-lg:hidden"> Point at a step to find it in the map.</span>
      </Lead>
      <ol className="mt-5" onMouseLeave={() => setHot([])}>
        {d.story.steps.map((s, i) => (
          <li key={i} onMouseEnter={() => setHot(s.unitIds)} onFocus={() => setHot(s.unitIds)} className="-mx-2.5 flex gap-3 rounded-md px-2.5 py-2.5 transition-colors hover:bg-surface">
            <span className="num w-4 shrink-0 pt-px text-sm text-fg-4">{i + 1}</span>
            <div className="min-w-0 flex-1 text-base text-fg-2">
              <Rich text={s.text} />
              {s.unitIds.length > 0 && (
                <span className="mt-1.5 flex gap-1">
                  {s.unitIds.map((u) => (
                    <UnitLink key={u} id={u} />
                  ))}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {d.story.alsoTouches.length > 0 && (
        <>
          <Label>It also changes this, which the requirement did not ask for</Label>
          <ul className="space-y-2.5 text-base text-fg-2">
            {d.story.alsoTouches.map((t, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-[9px] h-px w-2 shrink-0 bg-fg-4" />
                <span className="min-w-0">
                  <Rich text={t} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

const RANK: StrengthT[] = ['none', 'reasoned', 'verified-static', 'executed'];
const strongest = (es: Evidence[]): StrengthT => es.reduce<StrengthT>((a, e) => (RANK.indexOf(e.strength) > RANK.indexOf(a) ? e.strength : a), 'none');
const CRIT: Record<Criterion['status'], { glyph: GlyphState; word: string }> = {
  proven: { glyph: 'done', word: 'proven by a run' },
  supported: { glyph: 'half', word: 'supported, not proven' },
  unproven: { glyph: 'needs', word: 'unproven' },
  violated: { glyph: 'fail', word: 'violated' },
};

function Asked({ ch }: { ch: Chapter }) {
  const r = useReview();
  const { d } = r;
  const sel = selected(ch, d, r.sel);
  const crit = d.requirement.criteria;
  const count = (s: Criterion['status']) => crit.filter((c) => c.status === s).length;
  const parts = (['proven', 'supported', 'unproven', 'violated'] as const).filter((s) => count(s)).map((s) => `${count(s)} ${CRIT[s].word}`);
  return (
    <>
      <Head ch={ch} title="What was asked" meta={<span className="text-fg-2">{d.requirement.id}</span>} />
      <Lead>
        <Rich text={d.requirement.title} />
      </Lead>
      <p className="mt-3 text-base text-fg-3">These criteria were written from the requirement by an agent that never saw the code, so the change cannot define its own success.</p>
      <Label aside={parts.join(', ')}>Acceptance criteria</Label>
      <div>
        {crit.map((c) => (
          <Row
            key={c.id}
            selected={c.id === sel}
            onClick={() => r.select(ch.id, c.id)}
            lead={<Glyph state={CRIT[c.status].glyph} />}
            aside={<Strength s={strongest(d.evidence.filter((e) => c.evidenceIds.includes(e.id)))} />}
            title={CRIT[c.status].word}
          >
            <span className="flex gap-2">
              <span className="num w-8 shrink-0 whitespace-nowrap text-fg-3">{c.id}</span>
              <span className={cx('min-w-0 flex-1', c.id !== sel && 'line-clamp-2')}>
                <Rich text={c.text} />
              </span>
            </span>
          </Row>
        ))}
      </div>
    </>
  );
}

function Proof({ ch }: { ch: Chapter }) {
  const r = useReview();
  const { d } = r;
  const sel = selected(ch, d, r.sel);
  const groups = proofGroups(d);
  const ran = groups.flatMap((g) => g.items).filter((e) => e.strength === 'executed').length;
  return (
    <>
      <Head ch={ch} title="What was run" />
      <Lead>
        {ran ? `${plural(ran, 'check')} ran in a sandbox against this exact commit.` : 'Nothing was executed for this change.'} Open one to see the command and its output. Nothing here is a model's opinion.
      </Lead>
      {groups.map((g) => {
        if (g.id === 'ablation') {
          const noticed = g.items.filter((e) => e.ablation?.killed).length;
          return (
            <div key={g.id}>
              <Label aside={`${noticed} of ${g.items.length}`}>{g.label}</Label>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    title={e.title}
                    aria-label={e.title}
                    aria-pressed={e.id === sel}
                    onClick={() => r.select(ch.id, e.id)}
                    className={cx(
                      'h-6 w-6 rounded-[5px] border transition-shadow',
                      e.ablation?.killed ? 'border-green/50 bg-green/20' : 'border-amber/60 bg-amber/25',
                      e.id === sel && 'shadow-[0_0_0_2px_var(--bg),0_0_0_3.5px_var(--fg-3)]',
                    )}
                  />
                ))}
              </div>
              <p className="mt-2.5 text-base text-fg-2">
                Each square is one changed hunk, reverted on its own.{' '}
                {noticed === g.items.length ? 'A test fails every time, so the tests depend on all of it.' : `${plural(g.items.length - noticed, 'hunk')} can be removed and every test still passes: no test notices that code.`}
              </p>
            </div>
          );
        }
        return (
          <div key={g.id}>
            <Label>{g.label}</Label>
            {g.items.map((e) => (
              <Row
                key={e.id}
                selected={e.id === sel}
                onClick={() => r.select(ch.id, e.id)}
                lead={<Glyph state={e.polarity === 'supports' ? 'done' : e.polarity === 'undermines' ? 'half' : 'seen'} />}
                aside={<Strength s={e.strength} />}
              >
                <span className={e.id === sel ? '' : 'line-clamp-2'}>
                  <Rich text={e.conclusion} />
                </span>
              </Row>
            ))}
          </div>
        );
      })}
    </>
  );
}

const KILL_SHORT = { 'quote-not-found': 'cited code not found', 'repro-failed': 'reproduction passed', duplicate: 'duplicate', 'out-of-scope': 'out of scope', 'contradicted-by-evidence': 'contradicted' } as const;

function Reviewer({ ch }: { ch: Chapter }) {
  const r = useReview();
  const { d } = r;
  const sel = selected(ch, d, r.sel);
  const st = d.selfTest;
  const au = d.audit;
  const disputes = au?.findings.filter((x) => x.verdict === 'disputes') ?? [];
  return (
    <>
      <Head ch={ch} title="Is the reviewer any good" />
      <Lead>{st && st.planted ? <Rich text={st.reading} /> : au ? `A second model, ${au.model}, checked this review. No bugs could be planted in this change, so the reviewer has no hit rate here.` : 'No self-test ran for this change, so the reviewer has no hit rate here.'}</Lead>
      {st && st.planted > 0 && (
        <>
          <Label aside={`${st.caught} of ${st.planted} caught`}>Bugs planted to test it</Label>
          {st.canaries.map((k) => (
            <Row
              key={k.id}
              selected={k.id === sel}
              onClick={() => r.select(ch.id, k.id)}
              lead={<Glyph state={k.caughtByReviewer || k.caughtByTests ? 'done' : 'fail'} />}
              aside={k.caughtByReviewer && k.caughtByTests ? 'reviewer and tests' : k.caughtByReviewer ? 'reviewer only' : k.caughtByTests ? 'tests only' : 'missed'}
            >
              <span className="line-clamp-2">
                <Rich text={k.description.split(/\s{2,}`/)[0]} />
              </span>
              {(k.kind || k.missReason) && (
                <span className="mt-0.5 block text-sm text-fg-3">
                  {k.kind ? CANARY_KIND[k.kind] : ''}
                  {k.kind && k.missReason ? '. ' : ''}
                  {k.missReason}
                </span>
              )}
            </Row>
          ))}
          <p className="mt-3 text-sm text-fg-3">
            {st.planterModel ? `Planted by ${st.planterModel}, a different model family than the reviewer, one at a time in a copy of this change. ` : 'Planted one at a time in a copy of this change. '}
            A catch needs the right place and the right problem. A near miss counts as a miss.
          </p>
        </>
      )}
      {au && (
        <>
          <Label aside={au.issues.length ? `${au.issues.length} raised` : 'nothing raised'}>A second model on what you may skip</Label>
          <p className="text-base text-fg-2">
            {au.model} read the {au.linesAudited} changed {au.linesAudited === 1 ? 'line' : 'lines'} in {plural(au.unitsAudited, 'unit')} that the plan does not ask you to read closely, without seeing the first reviewer's reasoning.{' '}
            {au.issues.length ? 'What it raised is below. Nothing reproduced it, so it is a pointer and not a finding, but it moves the advice away from accept.' : 'It raised nothing there.'}
            {d.findings.length > 0 && (disputes.length ? ` It disputes ${disputes.length} of the ${plural(d.findings.length, 'finding')} shown to you.` : ` It disputes none of the ${plural(d.findings.length, 'finding')} shown to you.`)}
          </p>
          {au.issues.map((x, i) => (
            <div key={i} className="mt-2 border-l-2 border-amber pl-3">
              <div className="text-base text-fg">
                <Rich text={x.title} />
              </div>
              <div className="mt-0.5 text-sm text-fg-3">
                <UnitLink id={x.unitId} /> · <span className="mono">{x.path.split('/').pop()}:{x.line}</span> · {x.severity}
              </div>
              <div className="mt-1 text-base text-fg-2">
                <Rich text={x.why} />
              </div>
            </div>
          ))}
          {disputes.map((x) => (
            <p key={x.id} className="mt-2 text-base text-fg-2">
              <span className="num text-fg">{x.id}</span> disputed: <Rich text={x.why} />
            </p>
          ))}
        </>
      )}
      {d.discarded.length > 0 && (
        <>
          <Label aside={`${d.discarded.length} killed, ${d.findings.length} kept`}>Findings it raised and then killed</Label>
          {d.discarded.map((x) => (
            <Row key={x.id} selected={x.id === sel} onClick={() => r.select(ch.id, x.id)} lead={<X className="h-3.5 w-3.5 text-fg-4" />} aside={KILL_SHORT[x.reason]}>
              <span className="line-clamp-2 text-fg-3">
                <Rich text={x.title} />
              </span>
            </Row>
          ))}
          <p className="mt-3 text-sm text-fg-3">A finding reaches you only after a second agent tried to refute it and, where possible, a test reproduced it. What died stays visible.</p>
        </>
      )}
    </>
  );
}

const CANARY_KIND = { 'single-line': 'One line changed', 'multi-line': 'Several lines changed', 'cross-file': 'Spread over two files' } as const;

// ───────────────────────────── decide ─────────────────────────────
function Option({ n, label, detail, chosen, busy, disabled, onClick }: { n: number; label: ReactNode; detail?: ReactNode; chosen: boolean; busy?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={chosen}
      className={cx(
        'flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors disabled:cursor-default',
        chosen ? 'border-line-strong bg-surface-2' : 'border-line hover:border-line-strong hover:bg-surface disabled:hover:border-line disabled:hover:bg-transparent',
      )}
    >
      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center">{busy ? <Spinner /> : chosen ? <Glyph state="done" /> : <Kbd>{n}</Kbd>}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-fg">{label}</span>
        {detail && <span className="mt-0.5 block text-base text-fg-3">{detail}</span>}
      </span>
    </button>
  );
}

const STRENGTH_WORDS: Record<StrengthT, string> = {
  executed: 'A second agent wrote a test for the correct behaviour and Countersign ran it on this commit. It fails, so this is reproduced, not just argued.',
  'verified-static': 'The cited code exists as quoted, and a second agent could not refute it. Nothing was run.',
  reasoned: 'A model read the code and concluded this. Nothing was run.',
  none: 'Nothing backs this.',
};

function FindingChapter({ ch }: { ch: Chapter }) {
  const r = useReview();
  const f = r.d.findings.find((x) => x.id === ch.ref)!;
  const v = f.feedback?.verdict;
  const grave = f.severity === 'major' || f.severity === 'blocker';
  return (
    <>
      <Head
        ch={ch}
        long
        title={<Rich text={f.title} />}
        meta={
          <>
            <span className={cx('font-medium capitalize', f.severity === 'blocker' ? 'text-red' : 'text-fg-2')}>{f.severity}</span>
            <Dot />
            <span>{f.category.replace('-', ' ')}</span>
            {f.unitId && (
              <>
                <Dot />
                <UnitLink id={f.unitId} />
              </>
            )}
          </>
        }
      />
      <LeadProse text={f.body} />
      <Label>{f.strength === 'reasoned' || f.strength === 'none' ? 'How far it was checked' : 'Then it was checked'}</Label>
      <div className="flex items-start gap-2 text-base text-fg-2">
        <Strength s={f.strength} className="mt-1" />
        <span>{STRENGTH_WORDS[f.strength]}</span>
      </div>
      {f.scenario && (
        <>
          <Label>When it happens</Label>
          <Body text={f.scenario} />
        </>
      )}
      {f.suggestion && (
        <>
          <Label>A way to fix it</Label>
          <Body text={f.suggestion} />
        </>
      )}
      <Label>Your judgement</Label>
      {v ? (
        <p className="flex items-start gap-2 text-base text-fg-2">
          <Glyph state="done" className="mt-[3px]" />
          <span>
            <span className="font-medium text-fg">{v === 'accepted' ? 'You judged this real.' : 'You judged this not real.'}</span>{' '}
            {v === 'accepted' ? (grave ? 'The commit still has it, so the default at the end is to request changes. Accepting anyway takes a written reason, signed under your name.' : 'It stays open and goes into the attestation as a risk you accept.') : 'It is recorded as a false alarm and lowers the reviewer\u2019s precision in the trust ledger.'}
            {!r.readOnly && (
              <>
                {' '}
                <button type="button" onClick={() => void r.feedback(f.id, v === 'accepted' ? 'rejected' : 'accepted')} className="text-fg-3 underline decoration-line-strong underline-offset-4 hover:text-fg">
                  Change to {v === 'accepted' ? 'not real' : 'real'}
                </button>
              </>
            )}
          </span>
        </p>
      ) : (
        <p className="text-base text-fg-3">
          {r.readOnly
            ? 'Nobody judged this finding.'
            : grave ? 'Is this a real problem? Real means this commit should not be accepted as it is: the default becomes to request changes. Not real records a false alarm against the reviewer. Both buttons are below.' : 'Is this a real problem? Real keeps it open as a risk you accept in the attestation. Not real records a false alarm against the reviewer. Both buttons are below.'}
        </p>
      )}
    </>
  );
}

const REASON: Record<string, string> = {
  policy: 'policy',
  'product-intent': 'product intent',
  compatibility: 'compatibility',
  'risk-appetite': 'risk appetite',
  'missing-context': 'missing context',
  'security-posture': 'security posture',
};

function RefusalChapter({ ch }: { ch: Chapter }) {
  const r = useReview();
  const all = r.list.filter((c) => c.kind === 'refusal').map((c) => r.d.refusals.find((x) => x.id === c.ref)!);
  const q = r.d.refusals.find((x) => x.id === ch.ref)!;
  return (
    <>
      <Head
        ch={ch}
        title={`Decision ${all.indexOf(q) + 1} of ${all.length}`}
        meta={
          <>
            <span className="text-fg-2">The AI will not decide this</span>
            <Dot />
            <span>{REASON[q.reasonKind]}</span>
            {q.blocking && (
              <>
                <Dot />
                <span className={q.answer ? '' : 'text-amber'}>blocks sign-off</span>
              </>
            )}
          </>
        }
      />
      <Lead>
        <span className="text-fg">
          <Rich text={q.question} />
        </span>
      </Lead>
      <Prose text={q.why} className="mt-3 text-base text-fg-2" />
      {q.context && (
        <>
          <Label>What is known</Label>
          <Body text={q.context} />
        </>
      )}
      <Label>Your call</Label>
      <div className="space-y-2">
        {q.options.map((o, i) => (
          <Option key={o.id} n={i + 1} label={<Rich text={o.label} />} detail={
              <>
                <Rich text={o.consequence} />
                {o.implemented !== undefined && <span className={cx('mt-1 block text-sm', o.implemented ? 'text-fg-3' : 'text-amber')}>{o.implemented ? 'This is what the commit does.' : 'The commit does not do this. Choosing it means requesting changes, or accepting with a written reason.'}</span>}
              </>
            }
            chosen={q.answer?.optionId === o.id} busy={r.busy === `ans-${q.id}-${o.id}`} disabled={r.readOnly} onClick={() => void r.answer(q.id, o.id)} />
        ))}
      </div>
      <p className="mt-3 text-sm text-fg-3">{q.answer ? `Answered by @${q.answer.by}. The answer is part of the attestation.` : 'No option is recommended. Whichever you pick is recorded under your name.'}</p>
    </>
  );
}

// ───────────────────────────── read ─────────────────────────────
/** "Kind: core-logic" and "Area “x” is Trusted" are policy keys; say them as a person would. */
function factorLabel(label: string): string {
  const kind = /^Kind: ([\w-]+)$/.exec(label);
  if (kind) return `Kind of code: ${kindLabel[kind[1]] ?? kind[1].replace('-', ' ')}`;
  const area = /^Area [“"'](.+?)[”"'] is (\w+)$/.exec(label);
  if (area) return `Trust earned by the area “${area[1]}”: ${area[2].toLowerCase()}`;
  return tidy(label);
}

function UnitChapter({ ch }: { ch: Chapter }) {
  const r = useReview();
  const { d } = r;
  const u = d.units.find((x) => x.id === ch.ref)!;
  const read = r.readIds.has(u.id);
  const skim = isSkim(d, u);
  const findings = d.findings.filter((f) => f.unitId === u.id);
  const score = u.riskFactors.reduce((a, f) => a + f.points, 0);
  return (
    <>
      <Head
        ch={ch}
        long
        title={<Rich text={u.title} />}
        meta={
          <>
            <span className="text-fg-2">{skim ? 'Skim' : u.tier === 'T3' ? 'Read closely' : 'Read'}</span>
            <Dot />
            <span className="num">{plural(u.additions + u.deletions, 'line')}</span>
            <Dot />
            <span>{kindLabel[u.kind]}</span>
          </>
        }
      />
      <LeadProse text={u.summary} />
      {u.readingNote && (
        <>
          <Label>Look for</Label>
          <Body text={u.readingNote} />
        </>
      )}
      {findings.length > 0 && (
        <>
          <Label>Findings in this code</Label>
          {findings.map((f) => (
            <Row key={f.id} onClick={() => r.go(f.id)} lead={<Glyph state={f.feedback ? 'done' : 'open'} />} aside={<ArrowUpRight className="h-3.5 w-3.5" />}>
              <span className="line-clamp-2">
                <Rich text={f.title} />
              </span>
            </Row>
          ))}
        </>
      )}
      <Label aside={<span title={`Routing tier ${u.tier.slice(1)} of 3`}>{TIER_NAME[u.tier]}</span>}>Why this is routed to you</Label>
      <ul>
        {u.riskFactors.map((f, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 border-t border-line py-2 text-base first:border-t-0">
            <span className="min-w-0">
              <span className="text-fg">{factorLabel(f.label)}</span>
              {f.detail && (
                <span className="mt-0.5 block text-sm text-fg-3">
                  <Rich text={f.detail.replace(/\s*\(policy weights\.kind\)/, '')} />
                </span>
              )}
            </span>
            <span className={cx('num shrink-0 text-sm', f.points > 0 ? 'text-fg' : 'text-fg-3')}>{f.points > 0 ? `+${f.points}` : f.points === 0 ? '0' : `\u2212${-f.points}`}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-4 border-t border-line-strong py-2 text-base">
          <span className="min-w-0">
            <span className="font-medium text-fg">Risk score</span>
            <span className="mt-0.5 block text-sm text-fg-3">The points come from the table in the policy file. A higher total means a closer read.</span>
          </span>
          <span className="num shrink-0 text-sm font-medium text-fg">{score}</span>
        </li>
      </ul>
      <Label>Your reading</Label>
      {read ? (
        <p className="flex items-start gap-2 text-base text-fg-2">
          <Glyph state="done" className="mt-[3px]" />
          <span>
            <span className="font-medium text-fg">You marked this as {skim ? 'skimmed' : 'read'}.</span> It goes into the attestation as {skim ? 'skimmed' : 'read'} by you.
            {!r.readOnly && (
              <>
                {' '}
                <button type="button" onClick={() => r.setRead(u.id, false)} className="text-fg-3 underline decoration-line-strong underline-offset-4 hover:text-fg">
                  Undo
                </button>
              </>
            )}
          </span>
        </p>
      ) : (
        <p className="text-base text-fg-3">{r.readOnly ? 'This unit was not marked as read.' : skim ? 'Look the diff over for anything out of place, then mark it as skimmed below. A skim is shorter than a read, not optional: the sign-off waits for it, and the attestation says “skimmed”, not “read”.' : `Read the diff, then mark it as read below. ${ch.required ? 'It counts as checked by you in the attestation, and the sign-off waits for it.' : 'It counts as checked by you in the attestation.'}`}</p>
      )}
    </>
  );
}

function Skipped({ ch }: { ch: Chapter }) {
  const r = useReview();
  const { d } = r;
  const sel = selected(ch, d, r.sel);
  const units = d.units.filter((u) => u.ask === 'none');
  const lines = units.reduce((a, u) => a + u.additions + u.deletions, 0);
  return (
    <>
      <Head ch={ch} title="Skipped with proof" />
      <Lead>
        {lines} of {d.routing.totalLines} changed lines need no reading. Each skip names the proof that replaces it. No proof, no skip.
      </Lead>
      <div className="mt-5">
        {units.map((u) => (
          <Row key={u.id} selected={u.id === sel} onClick={() => r.select(ch.id, u.id)} lead={<Glyph state="done" />} aside={<span className="num">{plural(u.additions + u.deletions, 'line')}</span>}>
            <span className="font-medium text-fg">
              <Rich text={u.title} />
            </span>
            <span className="mt-0.5 block text-fg-3">
              <Rich text={u.skipProof?.text ?? u.summary} />
            </span>
          </Row>
        ))}
      </div>
      <p className="mt-4 text-sm text-fg-3">If you read one anyway and find a defect, record it as a spot-check miss in the ledger. Trust in that area drops and the next change there is routed to a person.</p>
    </>
  );
}

// ───────────────────────────── sign off ─────────────────────────────
function Limits({ ch }: { ch: Chapter }) {
  const { d } = useReview();
  return (
    <>
      <Head ch={ch} title="What nobody checked" />
      <Lead>Neither the AI nor you verified these. They go into the attestation as written, so the signature never covers more than what was looked at.</Lead>
      <ul className="mt-5">
        {d.notChecked.map((n, i) => (
          <li key={i} className="border-t border-line py-3 first:border-t-0">
            <div className="text-base font-medium text-fg">
              <Rich text={n.what} />
            </div>
            <div className="mt-0.5 text-base text-fg-3">
              <Rich text={n.why} />
            </div>
          </li>
        ))}
      </ul>
      {d.recommendation.distrustIf.length > 0 && (
        <>
          <Label>Do not trust this dossier if</Label>
          <ul className="space-y-2.5 text-base text-fg-2">
            {d.recommendation.distrustIf.map((t, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-[9px] h-px w-2 shrink-0 bg-fg-4" />
                <span className="min-w-0">
                  <Rich text={t} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-5 text-sm text-fg-3">{d.routing.spotCheck.selected ? `This change was sampled for a full read. ${d.routing.spotCheck.reason}` : d.routing.spotCheck.reason}</p>
    </>
  );
}

function HoldButton({ disabled, busy, onDone, children }: { disabled?: boolean; busy?: boolean; onDone: () => void; children: ReactNode }) {
  const [p, setP] = useState(0);
  const raf = useRef(0);
  const fired = useRef(false);
  const MS = 1100;
  const start = () => {
    if (disabled || busy || raf.current) return;
    fired.current = false;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / MS);
      setP(k);
      if (k >= 1) {
        fired.current = true;
        raf.current = 0;
        onDone();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const cancel = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (!fired.current) setP(0);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    if (!busy && fired.current) {
      fired.current = false;
      setP(0);
    }
  }, [busy]);
  return (
    <button
      type="button"
      data-hold
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={cancel}
      onBlur={cancel}
      className={cx(
        'relative inline-flex h-10 items-center justify-center overflow-hidden rounded-lg px-5 text-md font-medium select-none',
        disabled ? 'border border-line bg-surface text-fg-4' : 'bg-accent-strong text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.16)]',
      )}
    >
      <span aria-hidden className="absolute inset-0 origin-left bg-green" style={{ transform: `scaleX(${p})`, transition: p === 0 ? 'transform 180ms ease-out' : undefined }} />
      <span className="relative flex items-center gap-2">
        {busy && <Spinner />}
        {children}
      </span>
    </button>
  );
}

const span = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);
const IDENTITY = { github: 'signed in with GitHub', server: "this server's GitHub account", demo: 'synthetic reviewer on a demo copy' } as const;

function Sign({ ch }: { ch: Chapter }) {
  const r = useReview();
  const { d, c } = r;
  const a = d.signoff;
  const st = r.statement;
  const live = d.live;
  const [risk, setRisk] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const open = r.list.filter((x) => x.required && chapterState(x, d, r.readIds, new Set()) === 'needs');
  const holdRef = useRef<HTMLDivElement>(null);
  const sampled = d.routing.spotCheck.selected;
  const spotOpen = sampled && (r.spot.missed === undefined || (r.spot.missed && !r.spot.note.trim()));
  const over = st?.overrides ?? live?.overrides ?? [];
  const overOk = over.length === 0 || r.override.trim().length >= 20;
  const first = live?.firstSign;
  const mine = !!first && first.signer === r.me?.login;
  const local = open.length === 0 && !spotOpen && overOk;
  // the server's own answer wins: it runs the same gate on its own record of what this person read
  const refused = local && st ? st.reasons : [];
  const ready = !a && !mine && local && refused.length === 0;
  const publishes = live?.publishes !== false;
  const probation = live?.probation ?? [];
  const floor = st?.rushedBelowSeconds ?? 0;
  const fast = !!st && r.seconds < floor;
  useEffect(() => {
    if (ready && !over.length) holdRef.current?.querySelector<HTMLButtonElement>('[data-hold]')?.focus({ preventScroll: true });
  }, [ready, over.length]);

  if (a) {
    const ok = a.decision === 'accepted';
    return (
      <>
        <Head ch={ch} title={ok ? 'Countersigned' : 'Changes requested'} />
        <Lead>
          <span className="text-fg">{a.signerName ?? `@${a.signer}`}</span> {ok ? 'accepted' : 'asked for changes on'} this change at commit <span className="mono text-md">{shortSha(a.headSha)}</span> after {span(a.reviewSeconds)} of review, clocked by the server.
        </Lead>
        {a.cosign && (
          <p className="mt-3 text-base text-fg-2">
            Co-signed by <span className="text-fg">{a.cosign.signerName ?? `@${a.cosign.signer}`}</span> after their own {span(a.cosign.reviewSeconds)} read. The area was on probation, so one signature was not enough.
          </p>
        )}
        {a.override && (
          <div className="mt-4 border-l-2 border-amber pl-3">
            <p className="text-sm text-fg-3">Accepted over {plural(a.override.items.length, 'confirmed problem')}. The reason, as written:</p>
            <p className="mt-1 text-base whitespace-pre-wrap text-fg">{a.override.reason}</p>
          </div>
        )}
        {a.rushed && <p className="mt-3 text-base text-amber">Signed faster than the floor for this change. It is on the record and does not count toward trust in this code area.</p>}
        <p className="mt-3 text-base text-fg-3">
          {a.github?.statusUrl
            ? ok
              ? 'The check on the pull request is green and carries this name. '
              : 'The check on the pull request is red. '
            : 'This copy does not post to GitHub, so no check changed on the pull request. '}
          The attestation<span className="max-lg:hidden"> on the right</span> is what was signed, hash-chained into the trust ledger.
          {ok && !a.rushed && live ? ` It counts toward trust after ${live.cleanAfterDays} days without a revert or an incident.` : ''}
        </p>
        <OnGitHub slug={d.slug} />
      </>
    );
  }
  if (d.status === 'failed')
    return (
      <>
        <Head ch={ch} title="This review failed" />
        <Lead>The pipeline did not finish, so there is nothing to sign. A failed review never shows as a pass.</Lead>
      </>
    );
  if (mine)
    return (
      <>
        <Head ch={ch} title="First signature given" />
        <Lead>
          Your signature is recorded. {probation.join(' and ') || 'This code area'} is on probation after an escape, so a second person has to read the change and sign before anything is accepted.
        </Lead>
        <p className="mt-3 text-base text-fg-3">{publishes ? 'The check on the pull request stays pending until they do.' : 'Nothing is accepted until they do.'} You cannot give both signatures.</p>
      </>
    );
  return (
    <>
      <Head ch={ch} title={first ? 'Co-sign' : 'Countersign'} />
      <Lead>
        {first ? (
          <>
            <span className="text-fg">{first.signerName ?? `@${first.signer}`}</span> gave the first signature. This area is on probation, so it also needs yours, after your own read.
          </>
        ) : (
          <>
            The AI reviewed. It does not approve. You do, by name, for exactly what the attestation<span className="max-lg:hidden"> on the right</span> says and nothing more.
          </>
        )}
      </Lead>

      <Label aside={open.length ? `${open.length} left` : 'all done'}>Before you can sign</Label>
      {open.length ? (
        open.map((x) => (
          <Row key={x.id} onClick={() => r.go(x.id)} title={tidy(x.label)} lead={<Glyph state="open" />} aside={x.kind === 'finding' ? 'judge' : x.kind === 'refusal' ? 'decide' : d.units.some((u) => u.id === x.ref && isSkim(d, u)) ? 'skim' : 'read'}>
            <span className="line-clamp-1">
              <Rich text={x.label} />
            </span>
          </Row>
        ))
      ) : (
        <p className="flex items-center gap-2 text-base text-fg-2">
          <Glyph state="done" />
          {plural(c.findingsTotal, 'finding')} judged, {plural(c.decisionsAnswered, 'decision')} made, {plural(c.requiredRead, 'unit')} read or skimmed.
        </p>
      )}

      {sampled && (
        <>
          <Label>Spot check of the reviewer</Label>
          <p className="mb-2.5 text-base text-fg-3">This change was drawn for a full read. Your answer goes on the ledger with your signature: a miss lowers trust in this code area, so the next changes there get less skipping.</p>
          <div className="space-y-2">
            <Option n={1} label="I found nothing the AI missed" chosen={r.spot.missed === false} disabled={r.readOnly} onClick={() => r.setSpot({ missed: false, note: '' })} />
            <Option n={2} label="I found something the AI missed" chosen={r.spot.missed === true} disabled={r.readOnly} onClick={() => r.setSpot({ missed: true, note: r.spot.note })} />
          </div>
          {r.spot.missed && (
            <input
              autoFocus
              value={r.spot.note}
              onChange={(e) => r.setSpot({ missed: true, note: e.target.value })}
              placeholder="What did it miss? One line."
              aria-label="What the AI missed"
              className="mt-2 h-8 w-full border-b border-line bg-transparent text-base outline-none placeholder:text-fg-4 focus:border-line-strong"
            />
          )}
        </>
      )}

      {over.length > 0 && (
        <>
          <Label aside={String(over.length)}>Confirmed problems in this commit</Label>
          <ul className="space-y-1.5 text-base text-fg-2">
            {over.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                <span className="min-w-0">
                  <Rich text={x} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-base text-fg-3">You confirmed these, and the code still has them. The normal answer is to request changes. To accept this commit anyway, write why: the reason is signed under your name and posted with the attestation.</p>
          <textarea
            value={r.override}
            onChange={(e) => r.setOverride(e.target.value)}
            rows={2}
            placeholder="Why this commit can merge with these problems open"
            aria-label="Reason for accepting over confirmed problems"
            className="mt-2 w-full resize-none rounded-lg border border-line bg-transparent px-3 py-2 text-base outline-none placeholder:text-fg-4 focus:border-line-strong"
          />
          {r.override.trim().length > 0 && r.override.trim().length < 20 && <p className="num mt-1 text-sm text-fg-3">{20 - r.override.trim().length} more characters</p>}
        </>
      )}

      <Label aside={String(c.residualRisk.length)}>Risk you accept by signing</Label>
      <p className="text-base text-fg-3">{c.residualRisk.length ? 'Listed on the attestation. Add anything you know that the dossier does not.' : 'None recorded. Add anything you know that the dossier does not.'}</p>
      {r.extraRisk.map((x, i) => (
        <div key={i} className="mt-2 flex items-start gap-2 text-base text-fg-2">
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{x}</span>
          <button type="button" aria-label="Remove" onClick={() => r.setExtraRisk(r.extraRisk.filter((_, j) => j !== i))} className="rounded p-0.5 text-fg-4 hover:text-fg">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!risk.trim()) return;
          r.setExtraRisk([...r.extraRisk, risk.trim()]);
          setRisk('');
        }}
      >
        <Plus className="h-3.5 w-3.5 shrink-0 text-fg-4" />
        <input value={risk} onChange={(e) => setRisk(e.target.value)} placeholder="A risk you accept, in your words" aria-label="Add a risk you accept" className="h-8 min-w-0 flex-1 border-b border-line bg-transparent text-base outline-none placeholder:text-fg-4 focus:border-line-strong" />
      </form>

      <div ref={holdRef} className="mt-8 flex flex-wrap items-center gap-3">
        {over.length > 0 && !rejecting && (
          <Button variant="primary" size="lg" onClick={() => setRejecting(true)}>
            Request changes
          </Button>
        )}
        <HoldButton disabled={!ready} busy={r.busy === 'sign-accepted'} onDone={() => void r.sign('accepted')}>
          <Check className="h-4 w-4" strokeWidth={2.2} />
          {over.length ? 'Hold to accept anyway' : first ? 'Hold to co-sign' : 'Hold to countersign'}
        </HoldButton>
        {rejecting ? (
          <span className="flex items-center gap-2 text-base text-fg-2">
            {publishes ? 'Post a failing check with your name?' : 'Record that you asked for changes?'}
            <Button variant="danger" loading={r.busy === 'sign-rejected'} onClick={() => void r.sign('rejected')}>
              Request changes
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          over.length === 0 && (
            <Button variant="ghost" size="lg" onClick={() => setRejecting(true)}>
              Request changes
            </Button>
          )
        )}
      </div>
      <p className="mt-3 text-sm text-fg-3">
        {ready
          ? `Signing as ${st?.signer.name ?? r.me?.name ?? 'you'}${r.me ? ` (@${r.me.login}, ${IDENTITY[r.me.kind ?? 'server']})` : ''}. ${
              probation.length && !first
                ? `${probation.join(' and ')} is on probation after an escape: yours is the first of two signatures, and nothing is accepted until a second person signs.`
                : publishes
                  ? 'This posts a green check and the attestation to the pull request.'
                  : 'This copy does not post to GitHub: the signature goes on the ledger here, and no check changes on the pull request.'
            }`
          : refused.length
            ? `The server would refuse this signature: ${refused.join('; ')}.`
            : open.length
              ? 'Signing unlocks when the items above are done. The server keeps its own record of what you read and checks the same list, so the gate cannot be skipped from here.'
              : spotOpen
                ? 'Signing unlocks when you have said what your full read found.'
                : 'Accepting unlocks when you have written why. Requesting changes needs no reason.'}
      </p>
      {ready && fast && (
        <p className="mt-2 text-sm text-amber">
          The server has clocked {span(r.seconds)} of review on this change. A signature under {span(floor)} is recorded as rushed and never counts toward trust in this code area.
        </p>
      )}
      {d.recommendation.verdict === 'changes-requested' && over.length === 0 && <p className="mt-2 text-sm text-amber">The advice for this change is to request changes.</p>}
      {r.signErr && (
        <p role="alert" className="mt-3 text-base text-red">
          {r.signErr}
        </p>
      )}
      <OnGitHub slug={d.slug} />
    </>
  );
}

export function Guide({ ch }: { ch: Chapter }) {
  switch (ch.kind) {
    case 'brief':
      return <Brief ch={ch} />;
    case 'change':
      return <Change ch={ch} />;
    case 'how':
      return <How ch={ch} />;
    case 'asked':
      return <Asked ch={ch} />;
    case 'proof':
      return <Proof ch={ch} />;
    case 'reviewer':
      return <Reviewer ch={ch} />;
    case 'finding':
      return <FindingChapter ch={ch} />;
    case 'refusal':
      return <RefusalChapter ch={ch} />;
    case 'unit':
      return <UnitChapter ch={ch} />;
    case 'skipped':
      return <Skipped ch={ch} />;
    case 'limits':
      return <Limits ch={ch} />;
    default:
      return <Sign ch={ch} />;
  }
}
