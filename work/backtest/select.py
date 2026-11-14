import json,random,datetime
j=json.load(open('work/backtest/szz.json'))
allp=j['eligible']; escaped={2206,2258,2273}; controls={2212,2226,2310}
selected=[]
for p in allp:
 if p['number'] in escaped or p['number'] in controls:
  p=dict(p); p['kind']='escaped' if p['number'] in escaped else 'control'; selected.append(p)
r=random.Random(20261114); r.shuffle(selected)
json.dump({'seed':20261114,'eligibleCount':len(allp),'consideredCount':36,'selected':selected},open('work/backtest/selection.json','w'),indent=2)
for p in selected: print(p['kind'],p['number'],p['title'],p['baseRefOid'],p['headRefOid'])
