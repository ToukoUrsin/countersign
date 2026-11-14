#!/usr/bin/env python3
"""Run the fixed round-two list with two workers and one retry per failed process."""
import json, os, subprocess, time
from pathlib import Path

ROOT = Path('/home/ubuntu/junction/linearcodereview')
rows = json.loads((ROOT / 'work/backtest/selection.json').read_text())['selected'][2:]
pending = [(p, 0) for p in rows]
active = {}
while pending or active:
    while pending and len(active) < 2:
        p, attempt = pending.pop(0)
        cmd = [str(ROOT / 'work/backtest/run_one2.sh'), str(p['number']), p['baseRefOid'], p['headRefOid']]
        print('start', p['number'], 'attempt', attempt + 1, flush=True)
        active[subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)] = (p, attempt)
    if not active:
        break
    done = []
    for proc, (p, attempt) in list(active.items()):
        rc = proc.poll()
        if rc is None: continue
        done.append(proc)
        print('done', p['number'], 'attempt', attempt + 1, 'rc', rc, flush=True)
        subprocess.run(['python3', 'work/backtest/aggregate2.py'], cwd=ROOT, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        if rc != 0 and attempt == 0:
            time.sleep(5)
            pending.append((p, 1))
    for proc in done: del active[proc]
    if not done: time.sleep(2)
subprocess.run(['python3', 'work/backtest/aggregate2.py'], cwd=ROOT, check=False)
print('batch complete', flush=True)
