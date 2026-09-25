"""python3 steps/compare.py ORG YYYY-MM [tolerance] — системийн TB vs oracle (сарын хаалт, cumulative)."""
import sys, os, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
from engine import *
org, m = sys.argv[1], sys.argv[2]; tol = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
o = Org(org)
ok, t = o.c.call('get_trial_balance', {'from': f'{m}-01', 'to': eom(m)}, f'{m}:compare')
sysb = {}
for l in t.split('\n'):
    mm = re.match(r'(\d{8}) .*Хаалт Дт ([\d,\.]+) Кт ([\d,\.]+)', l)
    if mm:
        sysb[mm.group(1)] = round(float(mm.group(2).replace(',', '')) - float(mm.group(3).replace(',', '')), 2)
ora = o.L.tb('2000-01-01', eom(m))
bad = []
for a in sorted(set(sysb) | set(ora)):
    d = round(sysb.get(a, 0) - ora.get(a, 0), 2)
    if abs(d) > tol:
        bad.append((a, sysb.get(a, 0), ora.get(a, 0), d))
print(f'===== {org} {m}: accounts {len(set(sysb)|set(ora))}, diffs {len(bad)}')
for a, sv, ov, d in bad:
    print(f'  {a}  system {sv:>18,.2f}  oracle {ov:>18,.2f}  diff {d:>16,.2f}')
open(os.path.join(ROOT, 'orgs', org, f'compare_{m}.txt'), 'w').write(f'diffs {len(bad)}\n' + '\n'.join(f'{a} {sv} {ov} {d}' for a, sv, ov, d in bad))
