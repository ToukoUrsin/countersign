#!/usr/bin/env python3
"""Build the public backtest ledger from completed snapshot dossiers."""
import json, os, statistics, datetime, tempfile
from pathlib import Path
ROOT=Path('/home/ubuntu/junction/linearcodereview')
SEL=json.loads((ROOT/'work/backtest/selection.json').read_text())
SZZ=json.loads((ROOT/'work/backtest/szz.json').read_text())
DOS=Path('/bulk2/runs/linearcodereview/backtest/data/dossiers')
OUT=ROOT/'data/backtest'; OUT.mkdir(parents=True,exist_ok=True)
bypr={p['number']:p for p in SZZ['eligible']}
fix_for={}
for fp in SZZ['eligible']:
 for x in fp.get('szz',[]):
  fix_for.setdefault(x['pr'],[]).append(x)

def changed_line_sets(d):
  files={f['path']:f for f in d.get('files',[])}
  out=[]
  for u in d.get('units',[]):
   ls={}
   for f in d.get('files',[]):
    for h in f.get('hunks',[]):
     if h['id'] not in u.get('hunkIds',[]): continue
     nums=[x.get('n') for x in h.get('lines',[]) if x.get('n') is not None and x.get('t') in ('add','ctx')]
     if nums: ls.setdefault(f['path'],set()).update(nums)
   out.append((u,ls))
  return out

def dt(s):
 try:return datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
 except:return None

def row_for(p):
 n=p['number']; slug=f"messagepack-csharp__messagepack-csharp__{n}"; path=DOS/slug/'dossier.json'
 if not path.exists(): return None
 try:d=json.loads(path.read_text())
 except:return None
 if d.get('status') not in ('ready','failed'):
  return None
 evidence_errors=[(e.get('title','e.get'), k.get('excerpt','')) for e in d.get('evidence',[]) for k in [e.get('base'),e.get('head')] if isinstance(k,dict) and k.get('outcome')=='error']
 failed=d.get('status')=='failed' or any(s.get('status')=='failed' for s in d.get('stages',[])) or bool(evidence_errors)
 fixxs=fix_for.get(n,[])
 # dedupe fix labels and lines
 fix=None
 if fixxs:
  fx=fixxs[0]; fp=bypr.get(fx['fixPr'],{})
  lines=[]; seen=set()
  for x in fixxs:
   k=(x['path'],x['line'])
   if k not in seen: seen.add(k); lines.append({'path':x['path'],'line':x['line']})
  later=dt(fp.get('mergedAt','')); here=dt(p.get('mergedAt',''))
  fix={'pr':fx['fixPr'],'title':fx['fixTitle'],'daysLater':(later-here).days if later and here else 0,'lines':lines}
 total=d.get('routing',{}).get('totalLines',0) or 0; read=d.get('routing',{}).get('readLines',0) or 0; skim=d.get('routing',{}).get('skimLines',0) or 0; skip=d.get('routing',{}).get('skipLines',0) or 0
 stage_failed=[s for s in d.get('stages',[]) if s.get('status')=='failed']
 full=(d.get('recommendation',{}).get('verdict')=='full-read-required' or (total>0 and read==total))
 outcome='failed' if failed else ('full-read' if full else ('clean' if p['kind']=='control' else 'missed'))
 why='Pipeline infrastructure failure: '+('; '.join((s.get('detail') or s.get('title','failed'))[:160] for s in stage_failed) or (evidence_errors[0][1] or 'sandbox evidence returned error')[:240]) if failed else ''
 if not failed and p['kind']=='escaped':
  units=changed_line_sets(d); findings=d.get('findings',[])
  caught=[]; routed=[]; skimmed=[]; missed=[]
  for fl in (fixxs or []):
   path0,line=fl['path'],fl['line']; hit=None
   for f in findings:
    for ref in f.get('refs',[]):
     if ref.get('path')!=path0: continue
     a=ref.get('startLine',0); b=ref.get('endLine',a)
     if a-1<=line<=b+1: hit=f; break
    if hit: break
   if hit:
    # strict description check: require at least one meaningful token from fix title/body in finding text
    fixtext=' '.join([fl.get('fixTitle',''),p.get('title','')]).lower()
    ft=set(w for w in __import__('re').findall(r'[a-z]{4,}',fixtext) if w not in {'fix','fixed','change','issue','merge','drop','master','into','develop','write','string','calls','various'})
    ftext=(hit.get('title','')+' '+hit.get('body','')+' '+hit.get('scenario','')).lower()
    if ft and any(t in ftext for t in ft): caught.append((path0,line,hit)); continue
   target=None
   for u,mp in units:
    if line in mp.get(path0,set()) or any(abs(line-x)<=1 for x in mp.get(path0,set())): target=u; break
   if full or (target and target.get('ask')=='read'): routed.append((path0,line,target.get('id') if target else 'full-read'))
   elif target and target.get('ask')=='skim': skimmed.append((path0,line,target.get('id')))
   else: missed.append((path0,line,target.get('id') if target else None))
  if caught: outcome='caught'; why=f'{len(caught)} later-fixed line(s) had a shown finding with an adjacent same-file reference and matching defect language.'
  elif routed: outcome='full-read' if full else 'routed'; why='The later-fixed lines were in a unit the plan required the human to read.'
  elif skimmed: outcome='skim'; why='The later-fixed lines were in a skim unit; no shown finding named the later defect.'
  else: outcome='missed'; why='The plan let the human skip the later-fixed lines and no shown finding named the defect.'
 if not why: why='No later SZZ-labelled fix was mapped to this PR; recorded as a control.' if p['kind']=='control' else 'Full human read was required.'
 stages=d.get('stages',[]); costs=sum((s.get('costUsd') or 0) for s in stages)
 starts=[dt(s.get('startedAt','')) for s in stages if dt(s.get('startedAt',''))]; end=dt(d.get('generatedAt','')); wall=((end-min(starts)).total_seconds()/60 if starts and end else 0)
 return {'pr':n,'title':p['title'],'mergedAt':p['mergedAt'][:10],'kind':p['kind'],'fix':fix,'tier':d.get('routing',{}).get('tier','T3'),'lines':{'total':total,'read':read,'skim':skim,'skip':skip},'findingsShown':len(d.get('findings',[])),'outcome':outcome,'why':why,'estMinutes':d.get('routing',{}).get('estMinutes',0) or 0,'wallMinutes':round(wall,2),'costUsd':round(costs,4)}
rows=[]
for p in SEL['selected']:
 r=row_for(p)
 if r: rows.append(r)
completed=sum(r['outcome']!='failed' for r in rows); failed=len(rows)-completed
esc=[r for r in rows if r['kind']=='escaped']; ctl=[r for r in rows if r['kind']=='control']
fullread=sum(r['outcome']=='full-read' for r in esc)
summary={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':f"The population is merged MessagePack-CSharp pull requests from 2025-05-11 through 2026-11-11. SZZ marked a source line as escaped when a later fix PR changed a line blamed to an earlier merged PR; the seed-fixed sample contains {len(esc)} escaped PRs and {len(ctl)} controls because only 14 of 36 merged PRs met the size/source filter. Each selected PR was run at its merge-time base parent and head through the unchanged pipeline stages in an isolated snapshot, then scored against the mapped fix lines.",'population':{'from':'2025-05-11','to':'2026-11-11','mergedPrsConsidered':36,'eligible':14,'seed':SEL['seed']},'runs':len(rows),'completed':completed,'failed':failed,'escaped':{'prs':len(esc),'caught':sum(r['outcome']=='caught' for r in esc),'routed':sum(r['outcome'] in ('routed','full-read') for r in esc),'skim':sum(r['outcome']=='skim' for r in esc),'missed':sum(r['outcome']=='missed' for r in esc),'fullRead':fullread},'controls':{'prs':len(ctl),'findingsShown':sum(r['findingsShown'] for r in ctl),'findingsPerPr':round(sum(r['findingsShown'] for r in ctl)/len(ctl),2) if ctl else 0},'lines':{'total':sum(r['lines']['total'] for r in rows),'read':sum(r['lines']['read'] for r in rows),'skim':sum(r['lines']['skim'] for r in rows),'skip':sum(r['lines']['skip'] for r in rows)},'readFraction':round(sum(r['lines']['read'] for r in rows)/sum(r['lines']['total'] for r in rows),4) if sum(r['lines']['total'] for r in rows) else 0,'medianEstMinutes':statistics.median([r['estMinutes'] for r in rows]) if rows else 0,'medianWallMinutes':statistics.median([r['wallMinutes'] for r in rows]) if rows else 0,'totalCostUsd':round(sum(r['costUsd'] for r in rows),4),'caveats':['Models may have seen these PRs and fixes in training, so detection is an upper bound.','SZZ labels are noisy: a later change to a line is not proof that the earlier line was buggy.','The sample is six PRs because only 14 PRs were eligible in this one repository and period.','This is one .NET repository and stack, with old commits that may not build.','Selection is constrained by the short recent history and seeded shuffle; it is not representative of all GitHub PRs.'],'rows':rows}
# atomic outputs, valid after every invocation
for dest,obj in [(OUT/'summary.json',summary)]:
 tmp=dest.with_suffix('.tmp'); tmp.write_text(json.dumps(obj,indent=2)); tmp.replace(dest)
with (OUT/'results.jsonl').open('w') as f:
 for r in rows:f.write(json.dumps(r,separators=(',',':'))+'\n')
print('rows',len(rows),'completed',completed,'failed',failed)
