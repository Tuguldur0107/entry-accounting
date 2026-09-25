"""Сим 2.0 олдворууд — SIM2-NNN (сим 1-ийн ENT-001..076-ийн үргэлжлэл, шинэ угтвар)."""
import json, os, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = os.path.join(ROOT, 'out', 'issues2.jsonl')

def _load():
    return [json.loads(l) for l in open(F)] if os.path.exists(F) else []

def add(sev, module, channel, category, title, detail='', expected='', actual='', solution='', evidence='', org='', related=''):
    L = _load()
    for i in L:
        if i['title'] == title:
            return i['id']
    iid = f'SIM2-{len(L)+1:03d}'
    rec = dict(id=iid, sev=sev, module=module, channel=channel, category=category, title=title, detail=detail, expected=expected, actual=actual,
               solution=solution, evidence=evidence, org=org, related=related, ts=datetime.datetime.now().isoformat(timespec='seconds'))
    open(F, 'a').write(json.dumps(rec, ensure_ascii=False) + '\n')
    print('ISSUE', iid, sev, title, flush=True)
    return iid
