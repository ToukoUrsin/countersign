import json, subprocess, re, os, datetime
repo='/bulk2/runs/linearcodereview/backtest/repo'
rows=json.load(open('work/backtest/population.json'))
# eligible selection definition
eligible=[]
for p in rows:
 total=(p.get('additions') or 0)+(p.get('deletions') or 0)
 if total<10 or total>600 or not any(f.startswith('src/') for f in p.get('files',[])): continue
 p['srcFiles']=[f for f in p['files'] if f.startswith('src/')]
 eligible.append(p)
fix_re=re.compile(r'\b(fix|fixes|fixed|bug|bugfix|regression|revert|incorrect|prevent|security|issue)\b',re.I)
def run(*args):
 return subprocess.check_output(['git','-C',repo,*args],text=True,stderr=subprocess.DEVNULL)
def parents(sha): return run('rev-list','--parents','-n','1',sha).split()[1:]
def blame(path,commit,start,end):
 try: return run('blame','-w','-l',f'-L{start},{end}',commit,'--',path).splitlines()
 except: return []
# Map candidate changed source files and PR date; choose latest earlier PR whose head/merge contains blame commit and changed path
for p in eligible:
 p['szz']=[]
 if not fix_re.search((p.get('title') or '')+'\n'+(p.get('body') or '')): continue
 ms=p.get('mergeSha')
 if not ms: continue
 try: par=parents(ms)[0]
 except: continue
 # diff old sides, only src files, collect deleted/changed old line ranges
 try: diff=run('diff','--unified=0',par,ms,'--','src/')
 except: continue
 curfile=None; oldranges=[]
 for line in diff.splitlines():
  if line.startswith('+++ '): continue
  if line.startswith('--- '): curfile=line[6:] if line.startswith('--- a/') else line[4:]; continue
  if line.startswith('@@') and curfile:
   m=re.search(r' -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))?',line)
   if m:
    os_,oc=int(m.group(1)),int(m.group(2) or 1); ns,nc=int(m.group(3)),int(m.group(4) or 1)
    # blame old deleted lines; for pure add, use adjacent old context line
    if oc: oldranges.append((curfile,os_,os_+oc-1))
    elif os_>1: oldranges.append((curfile,os_-1,os_-1))
 for path,a,b in oldranges:
  bl=blame(path,par,a,b)
  for blline in bl:
   sha=blline.split()[0].lstrip('^')
   # source commit must predate fix and be non-fix merge; locate latest eligible PR whose merge/head contains sha and touched path
   cand=[]
   for q in eligible:
    if q['number']==p['number'] or q['mergedAt']>=p['mergedAt']: continue
    if not any(path==f for f in q.get('srcFiles',[])): continue
    for qsha in [q.get('mergeSha'),*(q.get('commitShas') or []),q.get('headRefOid')]:
     if not qsha: continue
     r=subprocess.run(['git','-C',repo,'merge-base','--is-ancestor',sha,qsha],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
     if r.returncode==0: cand.append(q); break
   if not cand: continue
   q=max(cand,key=lambda z:z['mergedAt'])
   # line number in q head: identify same blamed line at head with git blame target path and use match sha; fallback old line
   qline=a
   try:
    # find lines attributed to introducing sha in q head; nearest line
    qbl=run('blame','-w','-l',q.get('headRefOid') or q.get('mergeSha'),'--',path).splitlines()
    hits=[i+1 for i,x in enumerate(qbl) if x.split()[0].lstrip('^')==sha]
    if hits: qline=min(hits,key=lambda x:abs(x-a))
   except: pass
   p['szz'].append({'fixPr':p['number'],'fixTitle':p['title'],'path':path,'fixParent':par,'introducing':sha,'pr':q['number'],'prTitle':q['title'],'line':qline})
 # dedup
 uniq=[]; seen=set()
 for x in p['szz']:
  k=(x['pr'],x['path'],x['line'])
  if k not in seen: seen.add(k); uniq.append(x)
 p['szz']=uniq
 print(p['number'],p['title'],'=>',[(x['pr'],x['path'],x['line']) for x in uniq])
json.dump({'eligible':eligible},open('work/backtest/szz.json','w'),indent=2)
print('eligible',len(eligible),'fixes',sum(bool(p['szz']) for p in eligible),'escaped',sorted({x['pr'] for p in eligible for x in p['szz']}))
