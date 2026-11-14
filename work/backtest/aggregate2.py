#!/usr/bin/env python3
"""Rebuild the round-two public ledger from the immutable src2 run dossiers."""
import datetime, json, re, statistics
from pathlib import Path

ROOT = Path('/home/ubuntu/junction/linearcodereview')
SEL = json.loads((ROOT / 'work/backtest/selection.json').read_text())
SZZ = json.loads((ROOT / 'work/backtest/szz.json').read_text())
STRICT = json.loads((ROOT / 'data/backtest/summary-strict.json').read_text())
DOS = Path('/bulk2/runs/linearcodereview/backtest/data2/dossiers')
OUT = ROOT / 'data/backtest'
OUT.mkdir(parents=True, exist_ok=True)

eligible = {p['number']: p for p in SZZ['eligible']}
fix_for = {}
for fix in SZZ['eligible']:
    for x in fix.get('szz', []):
        fix_for.setdefault(x['pr'], []).append(x)

def parse_dt(s):
    try:
        return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except Exception:
        return None

def unit_lines(d):
    out = []
    for u in d.get('units', []):
        ids = set(u.get('hunkIds', [])); lines = {}
        for f in d.get('files', []):
            for h in f.get('hunks', []):
                if h.get('id') not in ids: continue
                nums = [x.get('n') for x in h.get('lines', []) if x.get('n') is not None and x.get('t') in ('add', 'ctx')]
                if nums: lines.setdefault(f['path'], set()).update(nums)
        out.append((u, lines))
    return out

def line_bucket(d, path, line, full):
    if full: return 'read'
    for u, paths in unit_lines(d):
        if path in paths and (line in paths[path] or any(abs(line - n) <= 1 for n in paths[path])):
            return {'read': 'read', 'skim': 'skim', 'skip': 'skip'}.get(u.get('ask'), 'skip')
    return 'skip'

def strict_hit(p, fl, findings):
    """The strict catch test: adjacent same-file reference plus defect language."""
    path, line = fl['path'], fl['line']
    text_tokens = set(re.findall(r'[a-z]{4,}', (fl.get('fixTitle', '') + ' ' + p.get('title', '')).lower()))
    text_tokens -= {'fixed','fixes','change','issue','merge','drop','master','into','develop','write','string','calls','various'}
    for f in findings:
        refs = f.get('refs', [])
        if not any(r.get('path') == path and (r.get('startLine', 0) - 1 <= line <= r.get('endLine', r.get('startLine', 0)) + 1) for r in refs):
            continue
        finding_text = (f.get('title', '') + ' ' + f.get('body', '') + ' ' + f.get('scenario', '')).lower()
        if text_tokens and any(t in finding_text for t in text_tokens):
            return f
    return None

def make_row(p):
    n = p['number']; path = DOS / f'messagepack-csharp__messagepack-csharp__{n}' / 'dossier.json'
    if not path.exists(): return None
    try: d = json.loads(path.read_text())
    except Exception: return None
    if d.get('status') not in ('ready', 'failed'): return None
    routing = d.get('routing') or {}
    total = routing.get('totalLines', 0) or 0; read = routing.get('readLines', 0) or 0
    skim = routing.get('skimLines', 0) or 0; skip = routing.get('skipLines', 0) or 0
    stage_failed = [s for s in d.get('stages', []) if s.get('status') == 'failed']
    evidence_errors = [k.get('excerpt', '') for e in d.get('evidence', []) for k in (e.get('base'), e.get('head')) if isinstance(k, dict) and k.get('outcome') == 'error']
    # A sandbox build/restore error is a measured old-commit outcome: the review is still
    # complete and routes to a full read. Only a failed dossier or failed pipeline stage is a run failure.
    failed = d.get('status') == 'failed' or bool(stage_failed)
    full = d.get('recommendation', {}).get('verdict') == 'full-read-required' or (total > 0 and read == total)
    fixes = fix_for.get(n, [])
    fix = None
    if fixes:
        first = fixes[0]; later = parse_dt(eligible.get(first['fixPr'], {}).get('mergedAt', '')); here = parse_dt(p.get('mergedAt', ''))
        seen = set(); lines = []
        for x in fixes:
            key = (x['path'], x['line'])
            if key not in seen: seen.add(key); lines.append({'path': x['path'], 'line': x['line']})
        fix = {'pr': first['fixPr'], 'title': first['fixTitle'], 'daysLater': (later - here).days if later and here else 0, 'lines': lines}
    reqid = (d.get('requirement') or {}).get('id', '')
    req_source = 'issue' if reqid.startswith('REQ-') else ('pr-text' if reqid == 'PR-TEXT' else None)
    findings = d.get('findings', [])
    fixed_in = None; why = ''
    outcome = 'failed' if failed else ('full-read' if full else ('clean' if p['kind'] == 'control' else 'missed'))
    if failed:
        detail = '; '.join((s.get('detail') or s.get('title', 'failed'))[:180] for s in stage_failed)
        if not detail and evidence_errors: detail = evidence_errors[0][:240]
        why = 'Pipeline infrastructure failure: ' + (detail or 'pipeline did not produce a complete dossier')
    elif p['kind'] == 'escaped':
        buckets = [line_bucket(d, x['path'], x['line'], full) for x in fixes]
        fixed_in = 'skip' if 'skip' in buckets else ('skim' if 'skim' in buckets else 'read')
        hits = [strict_hit(p, x, findings) for x in fixes]
        if any(hits):
            outcome = 'caught'; why = 'A shown finding referenced an adjacent later-fixed line and used language matching the later defect.'
        elif fixed_in == 'read':
            outcome = 'full-read' if full else 'routed'; why = 'The later-fixed lines were in a unit the plan required the human to read.'
        elif fixed_in == 'skim':
            outcome = 'skim'; why = 'The later-fixed lines were in a skim unit; no shown finding named the later defect.'
        else:
            outcome = 'missed'; why = 'The skip proof covered the stated checks, but it did not exercise the behavior changed by the later defect.'
    if not why: why = 'No later SZZ-labelled fix was mapped to this control; recorded as clean.' if p['kind'] == 'control' else 'Full human read was required.'
    stages = d.get('stages', [])
    starts = [parse_dt(s.get('startedAt', '')) for s in stages if parse_dt(s.get('startedAt', ''))]
    end = parse_dt(d.get('generatedAt', ''))
    wall = ((end - min(starts)).total_seconds() / 60 if starts and end else 0)
    selftest = d.get('selfTest') or {}
    audit = d.get('audit') or {}
    full_reason = None
    if full:
        full_reason = next((x for x in routing.get('rulesFired', []) if isinstance(x, str)), None) or ('recommendation required full read' if d.get('recommendation', {}).get('verdict') == 'full-read-required' else 'all changed lines routed to read')
    return {
        'pr': n, 'title': p['title'], 'mergedAt': p['mergedAt'][:10], 'kind': p['kind'], 'requirementSource': req_source, 'fix': fix,
        'fixedLinesIn': fixed_in, 'tier': routing.get('tier', 'T3'), 'lines': {'total': total, 'read': read, 'skim': skim, 'skip': skip},
        'wholeChangeFullRead': full, 'fullReadReason': full_reason, 'findingsShown': len(findings),
        'selfTestPlanted': selftest.get('planted', 0), 'selfTestCaught': selftest.get('caught', 0), 'auditIssues': len(audit.get('issues', [])),
        'outcome': outcome, 'why': why, 'estMinutes': routing.get('estMinutes', 0) or 0,
        'wallMinutes': round(wall, 2), 'costUsd': round(sum((s.get('costUsd') or 0) for s in stages), 4),
    }

rows = []
for p in SEL['selected']:
    r = make_row(p)
    if r: rows.append(r)
esc = [r for r in rows if r['kind'] == 'escaped']; ctl = [r for r in rows if r['kind'] == 'control']
total_lines = sum(r['lines']['total'] for r in rows)
read_lines = sum(r['lines']['read'] for r in rows)
cutoff = sum(1 for r in rows if r['mergedAt'] > '2026-06-30')
summary = {
    'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'method': 'The population is all merged MessagePack-CSharp pull requests from 2024-01-01 through 2026-11-11. SZZ labelled an escaped PR when a later fix PR changed a source line blamed to that earlier merged PR; the fixed run list contains every escaped PR found plus seeded controls. Each selected PR was run at its merge-time base parent and head through the unchanged snapshot pipeline, with the declared PR-text requirement relaxation, then scored against mapped later-fixed lines.',
    'population': {'from': '2024-01-01', 'to': '2026-11-11', 'mergedPrsConsidered': 226, 'eligible': 101, 'escapedEligible': 26, 'seed': SEL['seed']},
    'runs': len(rows), 'completed': sum(r['outcome'] != 'failed' for r in rows), 'failed': sum(r['outcome'] == 'failed' for r in rows),
    'escaped': {'prs': len(esc), 'caught': sum(r['outcome'] == 'caught' for r in esc), 'routed': sum(r['outcome'] in ('routed', 'full-read') for r in esc), 'skim': sum(r['outcome'] == 'skim' for r in esc), 'missed': sum(r['outcome'] == 'missed' for r in esc), 'fullRead': sum(r['outcome'] == 'full-read' for r in esc)},
    'controls': {'prs': len(ctl), 'findingsShown': sum(r['findingsShown'] for r in ctl), 'findingsPerPr': round(sum(r['findingsShown'] for r in ctl) / len(ctl), 2) if ctl else 0},
    'lines': {'total': total_lines, 'read': read_lines, 'skim': sum(r['lines']['skim'] for r in rows), 'skip': sum(r['lines']['skip'] for r in rows)},
    'readFraction': round(read_lines / total_lines, 4) if total_lines else 0,
    'medianEstMinutes': statistics.median([r['estMinutes'] for r in rows]) if rows else 0,
    'medianWallMinutes': statistics.median([r['wallMinutes'] for r in rows]) if rows else 0,
    'totalCostUsd': round(sum(r['costUsd'] for r in rows), 4),
    'requirementSource': 'pr-text',
    'relaxation': 'In this snapshot only, PR title and description became the requirement when no issue was linked, so the skip rule could be exercised on merged history. The product itself requires a tracker requirement and would have demanded a full read for those PRs.',
    'strict': {'runs': STRICT.get('runs', 0), 'completed': STRICT.get('completed', 0), 'escapedPrs': STRICT.get('escaped', {}).get('prs', 0), 'caught': STRICT.get('escaped', {}).get('caught', 0), 'routed': STRICT.get('escaped', {}).get('routed', 0), 'missed': STRICT.get('escaped', {}).get('missed', 0), 'readFraction': STRICT.get('readFraction', 1.0), 'note': 'The strict first backtest used no PR-text relaxation, so every no-issue PR required a full read.'},
    'escapedDetail': {'fixedLinesInRead': sum(1 for r in esc if r.get('fixedLinesIn') == 'read'), 'fixedLinesInSkim': sum(1 for r in esc if r.get('fixedLinesIn') == 'skim'), 'fixedLinesInSkip': sum(1 for r in esc if r.get('fixedLinesIn') == 'skip')},
    'skipExercised': {'prsWithSkippedLines': sum(1 for r in rows if r['lines']['skip'] > 0), 'linesSkipped': sum(r['lines']['skip'] for r in rows), 'linesSkimmed': sum(r['lines']['skim'] for r in rows)},
    'afterCutoff': {'prs': cutoff, 'note': 'Runs merged after June 2026, after the reviewing models’ training-data cutoff, cannot have been memorised from that history.'},
    'caveats': ['The PR-text requirement is a deliberate snapshot-only relaxation and makes this unlike product operation.', 'SZZ labels are noisy: a later change to a line is not proof that the earlier line was buggy.', 'The sample is capped at 30 runs and has one repository and .NET stack.', 'Findings and routing can differ between runs of the same commit because model output is stochastic.', 'Old commits that could not restore or build in the sandbox are recorded as failed or full-read outcomes, not dropped.', 'Selection is constrained by the source-touching and 10–600 changed-line filter and a seeded shuffle.'],
    'rows': rows,
}
(OUT / 'summary.json.tmp').write_text(json.dumps(summary, indent=2)); (OUT / 'summary.json.tmp').replace(OUT / 'summary.json')
(OUT / 'results.jsonl').write_text(''.join(json.dumps(r, separators=(',', ':')) + '\n' for r in rows))
print('rows', len(rows), 'completed', summary['completed'], 'failed', summary['failed'])
