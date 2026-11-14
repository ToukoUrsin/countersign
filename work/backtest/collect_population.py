import json, subprocess, datetime, concurrent.futures
repo='MessagePack-CSharp/MessagePack-CSharp'
prs=json.load(open('/tmp/allprs.json'))
lo=datetime.datetime.fromisoformat('2024-01-01T00:00:00+00:00'); hi=datetime.datetime.fromisoformat('2026-11-12T00:00:00+00:00')
rows=[]
for p in prs:
 if p.get('mergedAt'):
  dt=datetime.datetime.fromisoformat(p['mergedAt'].replace('Z','+00:00'))
  if lo<=dt<=hi:
   p['mergeSha']=(p.get('mergeCommit') or {}).get('oid'); rows.append(p)
def one(p):
 try:
  j=json.loads(subprocess.check_output(['gh','pr','view',str(p['number']),'--repo',repo,'--json','files,commits'],text=True,timeout=20))
  p['files']=[x.get('path','') for x in j.get('files',[])]; p['commitShas']=[x.get('oid') for x in j.get('commits',[]) if x.get('oid')]
 except Exception as e: p['files']=[]; p['commitShas']=[]; p['fetchError']=str(e)
 return p
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
 rows=list(ex.map(one,rows))
json.dump(rows,open('work/backtest/population.json','w'),indent=2)
print('merged in period',len(rows))
for p in sorted(rows,key=lambda x:x['mergedAt']):
 src=any(x.startswith('src/') for x in p.get('files',[])); changed=(p.get('additions',0) or 0)+(p.get('deletions',0) or 0)
 if src and 10<=changed<=600: print(p['number'],p['mergedAt'][:10],changed,p['title'])
