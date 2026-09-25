"""Сарын үлдсэн ноорог хөдөлгөөнийг цэгцлэх: батлах → огноо шилжүүлж батлах → болохгүй бол устгаж oracle-оос хасах; дахин өртөг тооцох; oracle rebuild; тулгах; хаах.
python3 steps/fix_moves.py C 2025-09 [--noclose]"""
import sys, os, re, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import *
import closing as C
org, m = sys.argv[1], sys.argv[2]
o = Org(org); L = o.L; s = o.s
ok, t = o.call('list_inventory_movements', {'status': 'draft', 'from': f'{m}-01', 'to': eom(m), 'limit': 200}, f'{m}:fix')
for item, q, mid in re.findall(r'зарлага · (IMP-\d{3}) × (\d+) · (?:WH-\d\d|WH-TR) · draft · ID ([0-9a-f]{8})', t):
    q = int(q)
    ok2, t2 = o.call('confirm_inventory_movement', {'movementId': mid}, f'{m}:fix')
    if not ok2 and 'хасах' in t2.lower():
        o.call('update_inventory_movement', {'movementId': mid, 'date': eom(m)}, f'{m}:fix')
        ok2, t2 = o.call('confirm_inventory_movement', {'movementId': mid}, f'{m}:fix')
    if not ok2:
        o.call('delete_inventory_movement', {'movementId': mid}, f'{m}:fix')
        mv = next((x for x in L.inv_moves[m] if x['t'] == 'out' and x['item'] == item and x['qty'] == q and x['ref'].startswith('AR-')), None)
        if mv:
            L.inv_moves[m].remove(mv); o.note(m, f'oracle зарлага хасав {item}×{q} (системд үлдэгдэл хүрээгүй)')
for other in re.findall(r'· (?:орлого|шилжүүлэг|тохируулга) · [^\n]*· ID ([0-9a-f]{8})', t):
    o.call('confirm_inventory_movement', {'movementId': other}, f'{m}:fix')
o.call('run_monthly_costing', {'period': m}, f'{m}:fix')
ok, t = o.call('post_cost_entries', {'month': m}, f'{m}:fix')
if not ok:
    C.node(org, 'bulk_post.mjs', '/costing/entries', m, f'costfix-{m}')
L.inv_rebuild()
s['stock'] = {f'{k[0]}|{k[1]}': round(v['qty'], 3) for k, v in L.inv.items() if v['qty'] > 0.0005}
o.save()
subprocess.run([sys.executable, os.path.join(ROOT, 'steps', 'compare.py'), org, m])
if '--noclose' not in sys.argv:
    ok, t = C.close(o, m); o.save(); print(t[:100])
