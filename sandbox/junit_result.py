#!/usr/bin/env python3
"""Convert pytest's JUnit XML into the sandbox RunResult contract."""
import argparse, json, os, xml.etree.ElementTree as ET

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); ap.add_argument('--status', default='ran'); ap.add_argument('--exit-code', type=int, default=0); ap.add_argument('--duration-ms', type=int, default=0); ap.add_argument('--message', default='')
    a = ap.parse_args(); path = os.path.join(a.out, 'junit.xml'); passed=failed=skipped=0; names=[]; excerpt=''
    try:
        root = ET.parse(path).getroot()
        suites = [root] if root.tag.endswith('testsuite') else list(root.iter('testsuite'))
        for suite in suites:
            for case in suite.iter('testcase'):
                name = f"{case.get('classname','')}.{case.get('name','')}".strip('.')
                if case.find('failure') is not None or case.find('error') is not None:
                    failed += 1; names.append(name)
                    node = case.find('failure')
                    if node is None: node = case.find('error')
                    excerpt = ((node.get('message','') if node is not None else '') + '\n' + ((node.text or '') if node is not None else '')).strip()[:1500]
                elif case.find('skipped') is not None: skipped += 1
                else: passed += 1
    except Exception as e:
        result={'outcome':'error','passed':0,'failed':0,'skipped':0,'durationMs':a.duration_ms,'failing':[],'excerpt':f'Unreadable pytest JUnit XML: {e}','log':'log.txt'}
    else:
        outcome = 'fail' if failed else ('pass' if passed + skipped else ('build-error' if a.exit_code else 'error'))
        if a.status != 'ran': outcome = 'error'
        result={'outcome':outcome,'passed':passed,'failed':failed,'skipped':skipped,'durationMs':a.duration_ms,'failing':names[:30],'excerpt':excerpt,'log':'log.txt'}
    tmp=os.path.join(a.out,'result.json.tmp'); json.dump(result,open(tmp,'w'),indent=1); open(tmp,'a').write('\n'); os.replace(tmp,os.path.join(a.out,'result.json'))
    print(json.dumps(result))
if __name__ == '__main__': main()
