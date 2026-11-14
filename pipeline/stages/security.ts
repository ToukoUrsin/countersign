import type {
  ChangeUnit,
  Evidence,
  FileDiff,
  SecurityDependencies,
  SecurityPackageChange,
  SecurityReport,
  SecurityRuleHit,
} from '../../shared/dossier';
import type { Ctx } from '../lib/ctx';
import { exec } from '../lib/util';

type Rule = { id: string; description: string; pattern: string; scope?: 'code' | 'literal' | 'all'; route?: 'read' | 'skim' | 'none'; points?: number };
type Package = { name: string; version?: string; file: string };
type AddedLine = { path: string; line: number; text: string; unitId?: string };

const DEPENDENCY_FILES = [
  /(^|\/)package\.json$/i,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock(?:b)?)$/i,
  /(^|\/)([^/]+\.csproj|Directory\.Packages\.props|Directory\.Build\.(props|targets)|packages\.lock\.json|nuget\.config|global\.json)$/i,
  /(^|\/)(pyproject\.toml|requirements[^/]*\.txt|poetry\.lock|Pipfile\.lock|uv\.lock|pdm\.lock)$/i,
  /(^|\/)(Dockerfile(?:\.[^/]*)?)$/i,
  /^\.github\/workflows\/[^/]+\.(yml|yaml)$/i,
];
const isDependencyFile = (p: string) => DEPENDENCY_FILES.some((r) => r.test(p));
const isWorkflow = (p: string) => /^\.github\/workflows\/[^/]+\.(yml|yaml)$/i.test(p);
const isBuildFile = (p: string) => /(^|\/)([^/]+\.csproj|Directory\.(Packages\.)?props|Directory\.Build\.(props|targets)|Dockerfile(?:\.[^/]*)?|package\.json)$/i.test(p);

async function tree(repoDir: string, sha: string): Promise<Map<string, string>> {
  const list = await exec('git', ['ls-tree', '-r', '--name-only', sha], { cwd: repoDir, check: true });
  const out = new Map<string, string>();
  await Promise.all(
    list.stdout.split('\n').filter(Boolean).map(async (path) => {
      const r = await exec('git', ['show', `${sha}:${path}`], { cwd: repoDir, timeoutMs: 30_000 });
      if (r.code === 0 && !r.stdout.includes('\u0000')) out.set(path, r.stdout);
    }),
  );
  return out;
}

function packagesIn(path: string, text: string): Package[] {
  const out: Package[] = [];
  const add = (name: string, version: string | undefined) => {
    const n = name.trim().replace(/^['"]|['"]$/g, '');
    if (n && !/^\$|^\*|^workspace:/i.test(n)) out.push({ name: n, version: version?.trim().replace(/^['"]|['"]$/g, ''), file: path });
  };
  if (path.endsWith('package.json')) {
    try {
      const j = JSON.parse(text) as Record<string, Record<string, string>>;
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) for (const [n, v] of Object.entries(j[section] ?? {})) add(n, v);
      return out;
    } catch {
      // Fall through to the line parser for a partially edited manifest.
    }
  }
  if (/package-lock\.json$/i.test(path)) {
    try {
      const j = JSON.parse(text) as { packages?: Record<string, { name?: string; version?: string }>; dependencies?: Record<string, { version?: string }> };
      for (const [key, v] of Object.entries(j.packages ?? {})) if (key.startsWith('node_modules/')) add(key.slice('node_modules/'.length), v.name ? `${v.version ?? ''}` : v.version);
      for (const [n, v] of Object.entries(j.dependencies ?? {})) add(n, v.version);
      return out;
    } catch {
      // Fall through.
    }
  }
  if (/\.csproj$|Directory\.Packages\.props$/i.test(path)) {
    for (const m of text.matchAll(/<(?:PackageReference|PackageVersion)\b[^>]*\bInclude\s*=\s*["']([^"']+)["'][^>]*\bVersion(?:Override)?\s*=\s*["']([^"']+)["']/gi)) add(m[1], m[2]);
    for (const m of text.matchAll(/<(?:PackageReference|PackageVersion)\b[^>]*\bInclude\s*=\s*["']([^"']+)["'][^>]*>\s*([^<]+)\s*<\//gi)) add(m[1], m[2]);
  }
  if (/requirements[^/]*\.txt$|pyproject\.toml$|(?:poetry|uv|pdm)\.lock$/i.test(path)) {
    for (const line of text.split('\n')) {
      const s = line.replace(/#.*/, '').trim();
      const m = /^(?:[-\w.]+\s*["']?)([A-Za-z0-9_.-]+)\s*(?:==|===|~=|>=|<=|>|<)\s*["']?([^\s"',;]+)?/i.exec(s) ?? /^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/i.exec(s);
      if (m) add(m[1], m[2]);
    }
  }
  // NuGet lock files, yarn/pnpm/bun locks and simple requirements are intentionally parsed
  // conservatively: a name/version pair is useful evidence even when the lock format evolves.
  if (!/\.csproj$|Directory\.Packages\.props$/i.test(path))
    for (const m of text.matchAll(/(?:^|[\n"'])\s*([A-Za-z][A-Za-z0-9_.@/-]{1,})\s*(?:["']?[:=]\s*["']?|@)v?([0-9][^\s,"'}]*)/g))
      if (!['Version', 'Include', 'name'].includes(m[1])) add(m[1], m[2]);
  return out;
}

function sourcesIn(path: string, text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>\])}]+/gi)) out.add(m[0].replace(/[),.;]+$/, ''));
  for (const m of text.matchAll(/(?:registry|source|feed|packageSources?)\s*[:=][\s"']*([^\s"',}\]]+)/gi)) out.add(m[1].replace(/[),.;]+$/, ''));
  return [...out].sort();
}

function lineChanged(a: Map<string, string>, b: Map<string, string>, path: string): boolean {
  return (a.get(path) ?? '') !== (b.get(path) ?? '');
}

export function compareDependencyTrees(base: Map<string, string>, head: Map<string, string>): SecurityDependencies {
  const comparedFiles = [...new Set([...base.keys(), ...head.keys()].filter(isDependencyFile))].sort();
  const bp = new Map<string, Package>();
  const hp = new Map<string, Package>();
  for (const [path, text] of base) if (isDependencyFile(path)) for (const p of packagesIn(path, text)) bp.set(`${p.file}\0${p.name}`, p);
  for (const [path, text] of head) if (isDependencyFile(path)) for (const p of packagesIn(path, text)) hp.set(`${p.file}\0${p.name}`, p);
  const added: SecurityPackageChange[] = [];
  const removed: SecurityPackageChange[] = [];
  const changed: SecurityPackageChange[] = [];
  for (const [key, p] of hp) {
    const old = bp.get(key);
    if (!old) added.push({ name: p.name, to: p.version, file: p.file });
    else if ((old.version ?? '') !== (p.version ?? '')) changed.push({ name: p.name, from: old.version, to: p.version, file: p.file });
  }
  for (const [key, p] of bp) if (!hp.has(key)) removed.push({ name: p.name, from: p.version, file: p.file });

  const baseSources = new Set([...base.entries()].filter(([p]) => isDependencyFile(p)).flatMap(([p, t]) => sourcesIn(p, t)));
  const headSources = new Set([...head.entries()].filter(([p]) => isDependencyFile(p)).flatMap(([p, t]) => sourcesIn(p, t)));
  const newSources = [...headSources].filter((x) => !baseSources.has(x)).sort();
  const changedBuildScripts = comparedFiles.filter((p) => isBuildFile(p) && lineChanged(base, head, p) && /(?:scripts|RUN\b|CMD\b|ENTRYPOINT\b|Target\b|Exec\b|Command\b|Analyzer|Generator)/i.test(head.get(p) ?? '')).sort();
  const changedCiWorkflows = comparedFiles.filter((p) => isWorkflow(p) && lineChanged(base, head, p));
  const headNames = new Set([...hp.values()].map((p) => p.name));
  const baseNames = new Set([...bp.values()].map((p) => p.name));
  const newAnalyzers = [...headNames].filter((n) => !baseNames.has(n) && /analy[sz]er/i.test(n)).sort();
  const newSourceGenerators = [...headNames].filter((n) => !baseNames.has(n) && /source.?generator|generator/i.test(n)).sort();
  for (const [p, t] of head) {
    if (!isDependencyFile(p) || base.has(p)) continue;
    for (const line of t.split('\n')) if (/<(?:Analyzer|SourceGenerator)\b|Analyzer\b|SourceGenerator\b/i.test(line)) {
      const n = /(?:Include|Update)\s*=\s*["']([^"']+)["']/.exec(line)?.[1] ?? line.trim();
      if (/analy/i.test(n) && !newAnalyzers.includes(n)) newAnalyzers.push(n);
      if (/generator/i.test(n) && !newSourceGenerators.includes(n)) newSourceGenerators.push(n);
    }
  }
  return { comparedFiles, added, removed, changed, newSources, changedBuildScripts, changedCiWorkflows, newAnalyzers: [...new Set(newAnalyzers)].sort(), newSourceGenerators: [...new Set(newSourceGenerators)].sort() };
}

function codeForRule(text: string, scope: Rule['scope']): string | undefined {
  if (scope === 'literal') return text;
  const trimmed = text.trim();
  if (/^(?:\/\/|#(?!pragma)|\/\*|\*|<!--)/.test(trimmed)) return undefined;
  const slash = text.indexOf('//');
  return slash >= 0 ? text.slice(0, slash) : text;
}

export function scanSensitiveLines(lines: AddedLine[], rules: Rule[]): SecurityRuleHit[] {
  const hits: SecurityRuleHit[] = [];
  for (const line of lines) for (const rule of rules) {
    const hay = codeForRule(line.text, rule.scope ?? 'code');
    if (hay === undefined) continue;
    let matched = false;
    try { matched = new RegExp(rule.pattern).test(hay); } catch { matched = false; }
    if (matched) hits.push({ ruleId: rule.id, description: rule.description, path: line.path, line: line.line, text: line.text, change: 'new', route: rule.route ?? 'none', points: rule.points ?? 0, unitId: line.unitId });
  }
  return hits;
}

function addedLines(d: { files: FileDiff[]; units?: ChangeUnit[] }): AddedLine[] {
  const out: AddedLine[] = [];
  for (const f of d.files) for (const h of f.hunks) for (const l of h.lines) if (l.t === 'add' && l.n) {
    const unitId = d.units?.find((u) => u.hunkIds.includes(h.id))?.id;
    out.push({ path: f.path, line: l.n, text: l.s, unitId });
  }
  return out;
}

function packageSummary(p: SecurityPackageChange) {
  return `${p.name}${p.to ? ` ${p.to}` : ''}${p.file ? ` (${p.file})` : ''}`;
}

export async function security(ctx: Ctx, units: ChangeUnit[] = ctx.dossier.units): Promise<SecurityReport> {
  const d = ctx.dossier;
  const base = await tree(ctx.repoDir, ctx.mergeBase);
  const head = await tree(ctx.repoDir, d.pr.headSha);
  const dependencies = compareDependencyTrees(base, head);
  const rules = (ctx.policy.security?.rules ?? []) as Rule[];
  const hits = scanSensitiveLines(addedLines({ files: d.files, units }), rules);
  const evidenceIds: string[] = [];
  const range = `${ctx.mergeBase.slice(0, 12)}..${d.pr.headSha.slice(0, 12)}`;
  evidenceIds.push(ctx.addEvidence({
    kind: 'analysis', strength: 'verified-static', title: 'Dependency and build-input diff',
    conclusion: `${dependencies.added.length} package(s) added, ${dependencies.removed.length} removed, ${dependencies.changed.length} changed; compared ${dependencies.comparedFiles.length} manifest, lock, build, Docker and CI file(s).`,
    polarity: 'neutral', command: `git diff --no-color ${range} -- ${dependencies.comparedFiles.join(' ') || '<dependency files>'}`, producedBy: 'security/dependency-diff (deterministic)',
  }));
  evidenceIds.push(ctx.addEvidence({
    kind: 'analysis', strength: 'verified-static', title: 'Sensitive-surface rule scan',
    conclusion: `${hits.length} sensitive-surface rule hit(s) on added lines; comments are ignored except for rules that explicitly inspect literals or pragmas.`,
    polarity: hits.length ? 'undermines' : 'neutral', command: `git diff --no-color --unified=0 ${range} -- <all files> | security rule table from policy/default.yml`, producedBy: 'security/rule-scan (deterministic)',
  }));
  const report: SecurityReport = {
    dependencies, hits, evidenceIds,
    cannotSee: [
      'The scan does not execute packages, inspect transitive dependencies not present in a lock file, or prove what a package does at runtime.',
      'Regex rules do not understand aliases, macros, generated output that is not in the diff, or values assembled across multiple lines.',
      'Network hosts and the exact packages pulled by a build require executed build evidence; this static lens has none.',
    ],
  };
  d.security = report;

  const dependencyChanged = dependencies.added.length + dependencies.removed.length + dependencies.changed.length > 0 || dependencies.newSources.length > 0 || dependencies.changedBuildScripts.length > 0 || dependencies.changedCiWorkflows.length > 0;
  if (dependencyChanged && !d.notChecked.some((n) => n.what.startsWith('Security dependency diff'))) {
    d.notChecked.push({ what: 'Security dependency diff and build inputs', why: 'The static comparison found dependency or build-input changes. No executed build evidence covers exactly what this commit pulled in; a CRACI SBOM can replace this line.' });
  }
  const decisions: string[] = [];
  for (const p of dependencies.added) decisions.push(`New dependency ${packageSummary(p)} from source ${dependencies.newSources[0] ?? 'the repository manifest'}: accept?`);
  for (const source of dependencies.newSources) decisions.push(`New package source or registry ${source}: accept?`);
  for (const question of [...new Set(decisions)]) if (!d.refusals.some((r) => r.question === question)) d.refusals.push({ id: `R${d.refusals.length + 1}`, question, why: 'Whether a new code or package source is acceptable is a security and supply-chain decision for the owner.', reasonKind: 'security-posture', options: [{ id: 'accept', label: 'Accept this source', consequence: 'The source may supply code used by this build.' }, { id: 'reject', label: 'Reject this source', consequence: 'The change must use an already approved source or be revised.' }], context: `Static evidence: ${evidenceIds[0]}.`, evidenceIds: [evidenceIds[0]], blocking: true });
  ctx.detail('security', `${dependencies.added.length} added · ${dependencies.changed.length} changed · ${hits.length} rule hit(s)`);
  return report;
}

export function addedLinesForTest(lines: { path: string; line: number; text: string }[]) {
  return scanSensitiveLines(lines, [{ id: 'SEC-UNSAFE', description: 'unsafe code', pattern: '\\bunsafe\\b', scope: 'code', route: 'read', points: 4 }]);
}
