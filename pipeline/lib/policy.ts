import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { minimatch } from 'minimatch';
import { ROOT, exec } from './util';

export interface AreaDef {
  name: string;
  paths: string[];
  criticality: 'low' | 'medium' | 'high';
  securitySensitive?: boolean;
  publicApi?: boolean;
}

export interface Policy {
  version: string;
  source: string; // where the policy came from
  fixRequests?: 'auto' | 'off';
  requirement: { pattern: string; source: string; repo: string; missing: string };
  areas: AreaDef[];
  defaultTrustLevel: number;
  sandbox: { adapter: string; testRoots: string[]; framework: string; maxAblations: number; canaries: number; testMap: Record<string, string>; sdk?: Record<string, string> };
  weights: {
    kind: Record<string, number>;
    publicApi: number;
    securitySensitive: number;
    behaviourChangeOutsideRequirement: number;
    untraced: number;
    novelLogic: number;
    errorHandling: number;
    dependency: number;
    blastRadius: { many: number; some: number; manyAt: number; someAt: number };
    size: { large: number; medium: number; largeAt: number; mediumAt: number };
    untested: number;
    ablationKilled: number;
    redGreen: number;
    mechanicalVerified: number;
    generatedVerified: number;
    findingBlocker: number;
    findingMajor: number;
    canaryMissed: number;
    areaTrust: number[];
  };
  tiers: { T1: number; T2: number; T3: number };
  floors: { when: string; min: 'T0' | 'T1' | 'T2' | 'T3'; why: string }[];
  reading: { readLinesPerMinute: number; skimLinesPerMinute: number; minutesPerDecision: number; minutesPerFinding: number };
  security: {
    rules: { id: string; description: string; pattern: string; scope?: 'code' | 'literal' | 'all'; route?: 'read' | 'skim' | 'none'; points?: number }[];
  };
  trust: {
    labels: string[];
    effects: string[];
    promoteAtCleanStreak: number[];
    spotCheckRate: number[];
    onEscape: { demoteBy: number; resetStreak: boolean };
    onSpotCheckMiss: { demoteBy: number; resetStreak: boolean };
    /** days an accepted sign-off waits, with no revert, before it counts toward promotion */
    cleanAfterDays?: number;
  };
}

const parse = (s: string) => (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML.parse(s) as Record<string, unknown>;

function merge(a: any, b: any): any {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out: any = { ...(a ?? {}) };
  for (const k of Object.keys(b)) out[k] = k in out && typeof out[k] === 'object' && !Array.isArray(out[k]) ? merge(out[k], b[k]) : b[k];
  return out;
}

export function defaultPolicy(): Policy {
  return { ...(parse(readFileSync(resolve(ROOT, 'policy/default.yml'), 'utf8')) as unknown as Policy), source: 'countersign default' };
}

/** Policy = defaults ⊕ .countersign.yml from the BASE commit (never from the PR head: a PR must not relax its own review). */
export async function loadPolicy(repoDir: string, baseSha: string): Promise<Policy> {
  const def = defaultPolicy();
  const r = await exec('git', ['show', `${baseSha}:.countersign.yml`], { cwd: repoDir });
  if (r.code === 0 && r.stdout.trim()) {
    const p = merge(def, parse(r.stdout)) as Policy;
    p.source = `.countersign.yml @ ${baseSha.slice(0, 8)} (base branch)`;
    return p;
  }
  // demo fallback: a policy registered for this repo inside Countersign
  const local = process.env.CS_POLICY_FILE;
  if (local) {
    const p = merge(def, parse(readFileSync(local, 'utf8'))) as Policy;
    p.source = `${local} (registered policy)`;
    return p;
  }
  return def;
}

export function areaOf(policy: Policy, path: string): AreaDef {
  for (const a of policy.areas) if (a.paths.some((g) => minimatch(path, g, { dot: true }))) return a;
  return { name: 'other', paths: ['**'], criticality: 'medium' };
}

export const isTestPath = (policy: Policy, path: string) => policy.sandbox.testRoots.some((r) => path.startsWith(r));
