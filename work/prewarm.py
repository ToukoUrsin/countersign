import json, urllib.request, concurrent.futures as cf, time
jobs=[]
for n in range(1,5):
    s=f'toukoursin__junction26-messagepack-csharp__{n}'
    d=json.load(open(f'data/dossiers/{s}/dossier.json'))
    jobs += [(s,'unit',u['id']) for u in d['units']] + [(s,'finding',f['id']) for f in d['findings']]
def run(j):
    s,k,i=j
    for attempt in range(3):
        try:
            t=time.time()
            r=json.load(urllib.request.urlopen(f'http://localhost:4317/api/dossiers/{s}/live/diagram?kind={k}&id={i}',timeout=180))
            dg=r['diagram']
            return f"{s[-1]} {k} {i} ok {len(dg['nodes'])}n {dg['kind']} {time.time()-t:.0f}s"
        except Exception as e:
            err=str(e)
    return f"{s[-1]} {k} {i} FAILED {err}"
with cf.ThreadPoolExecutor(4) as ex:
    for r in ex.map(run,jobs): print(r,flush=True)
