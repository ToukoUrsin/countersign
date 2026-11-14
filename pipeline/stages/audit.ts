import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Audit, AuditFinding, AuditIssue, Finding } from '../../shared/dossier';
import { exec, norm } from '../lib/util';
import type { Ctx } from '../lib/ctx';
import { unitChangedLines } from './map';

interface AuditRaw { issues: { unitId: string; path: string; line: number; title: string; why: string; severity: Finding['severity'] }[]; findings: { id: string; verdict: 'agrees' | 'disputes'; why: string }[] }
const SCHEMA = { type: 'object', properties: {
  issues: { type: 'array', items: { type: 'object', properties: { unitId: { type: 'string' }, path: { type: 'string' }, line: { type: 'integer' }, title: { type: 'string' }, why: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'note'] } }, required: ['unitId', 'path', 'line', 'title', 'why', 'severity'] } },
  findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['agrees', 'disputes'] }, why: { type: 'string' } }, required: ['id', 'verdict', 'why'] } },
}, required: ['issues', 'findings'] };

async function runCodex<T>(ctx: Ctx, cwd: string, prompt: string): Promise<T> {
  const out = resolve(ctx.runDir, 'audit.json');
  const r = await exec('codex', ['exec', '-m', 'gpt-6.1-sol', '-s', 'read-only', '--json', '--skip-git-repo-check', '-C', cwd, '-o', out, '-'], { cwd, input: prompt, timeoutMs: 20 * 60_000 });
  const raw = existsSync(out) ? readFileSync(out, 'utf8') : r.stdout;
  for (const s of [raw, ...raw.split('\\n').reverse()]) {
    try { return JSON.parse(s) as T; } catch {}
    const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) try { return JSON.parse(s.slice(a, b + 1)) as T; } catch {}
  }
  throw new Error(`codex audit produced no JSON (exit ${r.code})`);
}

function maxTier(a: string, b: string) { return ['T0', 'T1', 'T2', 'T3'][Math.max(['T0', 'T1', 'T2', 'T3'].indexOf(a), ['T0', 'T1', 'T2', 'T3'].indexOf(b))] as 'T0'|'T1'|'T2'|'T3'; }

export async function audit(ctx: Ctx) {
  const d = ctx.dossier; const started = Date.now();
  const candidates = d.units.filter((u) => u.ask === 'none' || u.ask === 'skim');
  const lines = candidates.reduce((n, u) => n + unitChangedLines(ctx, u), 0);
  const units = candidates.map((u) => `${u.id} (${u.kind}, ${u.ask}) ${u.title}: ${u.summary}\\n  hunks: ${u.hunkIds.join(', ')}`).join('\\n');
  const criteria = d.requirement.criteria.map((c) => `${c.id} ${c.text}`).join('\\n');
  const shown = d.findings.map((f) => `${f.id} [${f.severity}] ${f.title}: ${f.body}\\nrefs: ${f.refs.map((r) => `${r.path}:${r.startLine}`).join(', ')}`).join('\\n');
  let raw: AuditRaw = { issues: [], findings: [] };
  try {
    raw = await runCodex<AuditRaw>(ctx, ctx.wt('head'), `You are an independent code auditor from the GPT model family. The PR head is the current read-only working directory. Read every unit listed below that the first routing plan lets the human skip or skim. Use the requirement and acceptance criteria, but do not rely on or repeat the first reviewer's findings while auditing those units. Report only concrete defects, with exact path and line. Then, separately, try to refute every shown finding; for each finding return exactly one agrees or disputes verdict and explain why. Do not approve the PR. Return JSON only.\\n\\nRequirement:\\n${d.requirement.body.slice(0, 9000)}\\n\\nCriteria:\\n${criteria}\\n\\nUnits to audit:\\n${units || '(none)'}\\n\\nShown findings for the refutation pass only:\\n${shown || '(none)'}`);
  } catch (e) { ctx.detail('audit', `Codex audit failed: ${(e as Error).message.slice(0, 120)}`); }
  const validIds = new Set(d.units.map((u) => u.id));
  const issues: AuditIssue[] = (raw.issues ?? []).filter((x) => validIds.has(x.unitId) && x.path && Number.isFinite(x.line)).map((x) => ({ ...x, severity: x.severity ?? 'minor' }));
  const findings: AuditFinding[] = d.findings.map((f) => raw.findings?.find((x) => x.id === f.id) ?? ({ id: f.id, verdict: 'agrees', why: 'The independent audit did not refute this finding.' } as AuditFinding));
  const result: Audit = { model: 'gpt-6.1-sol', family: 'gpt', linesAudited: lines, unitsAudited: candidates.length, issues, findings, durationMs: Date.now() - started };
  d.audit = result;
  let escalated = 0;
  for (const issue of issues) {
    const u = d.units.find((x) => x.id === issue.unitId); if (!u || u.ask === 'read') continue;
    u.ask = 'read'; u.tier = maxTier(u.tier, 'T2'); u.readingNote = 'raised by the independent audit'; escalated++;
    d.findings.push({ id: `AUDIT-${issue.unitId}-${issue.line}`, title: `Independent audit: ${issue.title}`, severity: issue.severity, category: 'correctness', body: issue.why, refs: [{ path: issue.path, startLine: issue.line, endLine: issue.line }], strength: 'reasoned', evidenceIds: [], unitId: issue.unitId, origin: 'audit', reproduced: false });
  }
  if (escalated) {
    const oldRead = d.routing.readLines; d.routing.readLines = d.units.filter((u) => u.ask === 'read').reduce((n, u) => n + unitChangedLines(ctx, u), 0);
    d.routing.skimLines = d.units.filter((u) => u.ask === 'skim').reduce((n, u) => n + unitChangedLines(ctx, u), 0);
    d.routing.skipLines = d.units.filter((u) => u.ask === 'none').reduce((n, u) => n + unitChangedLines(ctx, u), 0);
    d.routing.rulesFired.push(`Independent audit escalated ${escalated} unit(s) from skip/skim to read`);
    d.routing.estMinutes = Math.max(d.routing.estMinutes, Math.round(d.routing.estMinutes + Math.max(0, d.routing.readLines - oldRead) / (ctx.policy.reading.readLinesPerMinute || 40)));
  }
  ctx.detail('audit', `${lines} planned skip/skim lines audited; ${issues.length} issue(s); ${escalated} unit(s) escalated`);
  ctx.save();
  return result;
}

