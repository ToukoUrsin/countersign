import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Ctx } from './ctx';
import { isTestPath } from './policy';

export interface StackTestProject { project: string; prFilter?: string; prClasses: string[] }
export interface StackTestPlan { projects: StackTestProject[]; overlayPaths: string[]; primary?: string }

/** The small contract a language stack supplies to the review pipeline. */
export interface StackAdapter {
  readonly id: 'dotnet' | 'python';
  readonly sourceExtensions: RegExp;
  readonly testFileName: string;
  readonly testLanguage: string;
  readonly probeClass: string;
  isTestFile(path: string, policy: Ctx['policy']): boolean;
  projectsForSource(ctx: Ctx, path: string): string[];
  plan(ctx: Ctx): StackTestPlan;
  filterFor(names: string[]): string | undefined;
}

function nearestCsproj(wt: string, path: string): string | null {
  let dir = dirname(path);
  while (dir && dir !== '.') {
    const abs = resolve(wt, dir);
    if (existsSync(abs) && readdirSync(abs).some((f) => f.endsWith('.csproj'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

const TEST_ATTR = /\[(Fact|Theory|Test|TestMethod|SkippableFact)\b/;
const dotnet: StackAdapter = {
  id: 'dotnet', sourceExtensions: /\.(cs|tt|props|targets|csproj)$/i, testFileName: 'CountersignProbes.cs', testLanguage: 'csharp', probeClass: 'CountersignProbes',
  isTestFile: (path, policy) => isTestPath(policy, path),
  projectsForSource: (ctx, path) => { const p = Object.entries(ctx.policy.sandbox.testMap).find(([prefix]) => path.startsWith(prefix)); return p && existsSync(resolve(ctx.wt('head'), p[1])) ? [p[1]] : []; },
  filterFor: (names) => names.length ? names.map((c) => `FullyQualifiedName~${c}`).join('|') : undefined,
  plan(ctx) {
    const wt = ctx.wt('head'); const projects = new Map<string, StackTestProject>(); const overlay: string[] = [];
    const ensure = (p: string) => { if (!projects.has(p)) projects.set(p, { project: p, prClasses: [] }); return projects.get(p)!; };
    for (const f of ctx.dossier.files) {
      if (f.status === 'deleted') continue;
      if (isTestPath(ctx.policy, f.path)) {
        overlay.push(f.path); const proj = nearestCsproj(wt, f.path); if (!proj) continue; const abs = resolve(wt, f.path);
        if (f.path.endsWith('.cs') && existsSync(abs)) { const src = readFileSync(abs, 'utf8'); if (TEST_ATTR.test(src)) { const tp = ensure(proj); const decls = [...src.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g)]; decls.forEach((m, i) => { const body = src.slice(m.index!, decls[i + 1]?.index ?? src.length); if (TEST_ATTR.test(body) && !tp.prClasses.includes(m[1])) tp.prClasses.push(m[1]); }); continue; } }
        if (/Tests?$/.test(proj)) ensure(proj);
      } else for (const [prefix, proj] of Object.entries(ctx.policy.sandbox.testMap)) if (f.path.startsWith(prefix) && existsSync(resolve(wt, proj))) ensure(proj);
    }
    for (const p of projects.values()) if (p.prClasses.length) p.prFilter = this.filterFor(p.prClasses);
    const list = [...projects.values()]; const mapped = new Set(Object.values(ctx.policy.sandbox.testMap));
    return { projects: list, overlayPaths: overlay, primary: (list.find((p) => p.prFilter && mapped.has(p.project)) ?? list.find((p) => p.prFilter) ?? list.find((p) => mapped.has(p.project)) ?? list[0])?.project };
  },
};

const python: StackAdapter = {
  id: 'python', sourceExtensions: /\.(py|pyi)$/i, testFileName: 'CountersignProbes.py', testLanguage: 'python', probeClass: 'CountersignProbes',
  isTestFile: (path, policy) => isTestPath(policy, path) || /(^|\/)(test_|tests?\/)/i.test(path),
  projectsForSource: (ctx, path) => Object.entries(ctx.policy.sandbox.testMap).filter(([prefix, project]) => path.startsWith(prefix) && existsSync(resolve(ctx.wt('head'), project))).map(([, project]) => project),
  filterFor: (names) => names.length ? names.join(' or ') : undefined,
  plan(ctx) {
    const projects = new Map<string, StackTestProject>(); const overlay: string[] = [];
    const ensure = (p: string) => { if (!projects.has(p)) projects.set(p, { project: p, prClasses: [] }); return projects.get(p)!; };
    for (const f of ctx.dossier.files) {
      if (f.status === 'deleted') continue;
      if (this.isTestFile(f.path, ctx.policy)) { overlay.push(f.path); const root = Object.entries(ctx.policy.sandbox.testMap).map(([, p]) => p).find((p) => f.path === p || f.path.startsWith(`${p}/`)) ?? (ctx.policy.sandbox.testRoots.find((r) => f.path.startsWith(r)) || 'tests'); if (existsSync(resolve(ctx.wt('head'), root))) { const p = ensure(root); if (/\.py$/i.test(f.path)) { const text = readFileSync(resolve(ctx.wt('head'), f.path), 'utf8'); if (/^\s*(?:class|def)\s+(test_|Test)/m.test(text)) p.prClasses.push(f.path); } } }
      else for (const [prefix, project] of Object.entries(ctx.policy.sandbox.testMap)) if (f.path.startsWith(prefix) && existsSync(resolve(ctx.wt('head'), project))) ensure(project);
    }
    // pytest -k accepts test names; changed test files are a useful, deterministic red→green filter.
    for (const p of projects.values()) if (p.prClasses.length) p.prFilter = this.filterFor(p.prClasses.map((x) => x.replace(/^.*\//, '').replace(/\.py$/, '')));
    const list = [...projects.values()]; const mapped = new Set(Object.values(ctx.policy.sandbox.testMap));
    return { projects: list, overlayPaths: overlay, primary: (list.find((p) => p.prFilter && mapped.has(p.project)) ?? list.find((p) => p.prFilter) ?? list.find((p) => mapped.has(p.project)) ?? list[0])?.project };
  },
};

export function stackAdapter(name: string): StackAdapter {
  if (name === 'python') return python;
  return dotnet;
}
