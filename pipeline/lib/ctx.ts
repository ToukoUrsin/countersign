import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Dossier, Evidence, StageTrace } from '../../shared/dossier';
import type { Cluster } from './diff';
import type { Policy } from './policy';
import { meter } from './agent';
import { DATA, WORK, ensureDir, log } from './util';

export const STAGES: [string, string][] = [
  ['intake', 'Fetch PR, diff and requirement'],
  ['provenance', 'Read author-agent session provenance'],
  ['intent', 'Derive acceptance criteria from the requirement'],
  ['map', 'Group the diff into change units'],
  ['security', 'Check dependencies and sensitive surfaces deterministically'],
  ['prove', 'Execute: red→green, regression, ablation'],
  ['probe', 'Independent reproduction per criterion'],
  ['review', 'Review with full repo context'],
  ['verify', 'Verify findings before showing them'],
  ['reproof', 'Re-run prior reproductions on the new head'],
  ['selftest', 'Plant bugs to test the reviewer'],
  ['explain', 'Write the story and draw the diagrams'],
  ['route', 'Score risk and build the reading plan'],
  ['audit', 'Independent audit by the other model family'],
  ['consistency', 'Check signed lists and evidence for contradictions'],
  ['publish', 'Post dossier to the pull request'],
];

export class Ctx {
  dossier!: Dossier;
  policy!: Policy;
  repoDir = '';
  mergeBase = '';
  clusters: Cluster[] = [];
  dir: string; // data/dossiers/<slug>
  evDir: string;
  runDir: string; // work/runs/<slug>
  fresh: Set<string>;
  private evN = 0;

  constructor(public slug: string, fresh: string[] = []) {
    this.dir = ensureDir(resolve(DATA, 'dossiers', slug));
    this.evDir = ensureDir(resolve(this.dir, 'evidence'));
    this.runDir = ensureDir(resolve(WORK, 'runs', slug));
    ensureDir(resolve(this.runDir, 'cache'));
    this.fresh = new Set(fresh);
  }

  wt(name: string) {
    return resolve(this.runDir, 'wt', name);
  }

  save() {
    const p = resolve(this.dir, 'dossier.json');
    writeFileSync(p + '.tmp', JSON.stringify(this.dossier, null, 1));
    renameSync(p + '.tmp', p);
  }

  addEvidence(e: Omit<Evidence, 'id'>): string {
    const id = `E${++this.evN}`;
    this.dossier.evidence.push({ id, ...e });
    return id;
  }

  /** Cache an expensive step's result per head sha so the pipeline can resume and be re-run cheaply. */
  async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const p = resolve(this.runDir, 'cache', `${key}.json`);
    const stageKey = key.split('.')[0];
    if (!this.fresh.has('all') && !this.fresh.has(stageKey) && !this.fresh.has(key) && existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      if (j.headSha === this.dossier.pr.headSha) {
        // a cached step still cost what it cost when it ran; older caches kept the cost inside the agent result
        const outer = meter.getStore();
        const was = typeof j.costUsd === 'number' ? j.costUsd : typeof j.value?.costUsd === 'number' ? j.value.costUsd : 0;
        if (outer && was) {
          outer.costUsd += was;
          outer.calls += j.calls ?? 1;
        }
        return j.value as T;
      }
    }
    const outer = meter.getStore();
    const inner = { costUsd: 0, calls: 0 };
    const value = await meter.run(inner, fn);
    if (outer) {
      outer.costUsd += inner.costUsd;
      outer.calls += inner.calls;
    }
    writeFileSync(p, JSON.stringify({ headSha: this.dossier.pr.headSha, costUsd: inner.costUsd, calls: inner.calls, value }, null, 1));
    return value;
  }

  private trace(name: string): StageTrace {
    return this.dossier.stages.find((s) => s.name === name)!;
  }

  async stage<T>(name: string, fn: () => Promise<T>, opts: { model?: string } = {}): Promise<T | undefined> {
    const s = this.trace(name);
    s.status = 'running';
    s.startedAt = new Date().toISOString();
    if (opts.model) s.model = opts.model;
    this.save();
    const t0 = Date.now();
    log(name, 'start');
    const m = { costUsd: 0, calls: 0 };
    const metered = () => {
      if (m.calls) {
        s.costUsd = Math.round(m.costUsd * 10000) / 10000;
        s.agentCalls = m.calls;
      }
    };
    try {
      const r = await meter.run(m, fn);
      metered();
      s.status = (s.status as string) === 'skipped' ? 'skipped' : 'done';
      s.durationMs = Date.now() - t0;
      log(name, `done in ${Math.round(s.durationMs / 1000)}s ${s.detail ?? ''}`);
      this.save();
      return r;
    } catch (e) {
      metered();
      s.status = 'failed';
      s.durationMs = Date.now() - t0;
      s.detail = String((e as Error).message).slice(0, 300);
      log(name, `FAILED: ${(e as Error).stack}`);
      // a failed stage is never silent: it becomes a "not checked" line the signer sees
      this.dossier.notChecked.push({ what: `Stage "${s.title}" did not complete`, why: `Pipeline error: ${s.detail}. Everything this stage would have produced is missing from this dossier.` });
      this.save();
      return undefined;
    }
  }

  /** `_cost` is ignored: the stage meter counts every model call itself (see `meter` in agent.ts). */
  detail(name: string, text: string, _cost = 0) {
    const s = this.trace(name);
    s.detail = text;
  }

  skip(name: string, why: string) {
    const s = this.trace(name);
    s.status = 'skipped';
    s.detail = why;
  }
}
