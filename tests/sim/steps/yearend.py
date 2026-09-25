"""Жилийн хаалт: python3 steps/yearend.py ORG YYYY — create_year_end_closing (3 ноорог) → вэбээр батлах → oracle хаалт → тулгалт (12-31 ба дараа оны 01-01 нээлт)."""
import sys, os, re, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import *
import closing as C
org, year = sys.argv[1], sys.argv[2]
o = Org(org); L = o.L; s = o.s
m = f'{year}-12'
ok, t = o.call('create_year_end_closing', {'year': year}, f'{year}:ye')
reopened = False
if not ok and 'хаагдсан' in t:
    from issues import add as issue
    issue('S3', 'Жилийн хаалт', 'MCP + Web', 'Ажлын урсгал', 'create_year_end_closing: 12-р сар хаагдсан бол алдаа — сарын хаалт ба жилийн хаалтын дараалал зөрчилдөнө',
          f'B: 2025-01..12 бүгд хаагдсан → create_year_end_closing 2025 → «{t[:120]}». Нягтлан эхлээд бүх сарыг хааж, дараа нь жилийн хаалт хийх нь ердийн дараалал; reopen хийхээс өөр аргагүй.',
          'Жилийн хаалтын системийн журнал 12-31-нд хаагдсан сард ч бичигдэх (эсвэл «12-р сарыг хаахаас өмнө жилийн хаалтаа хий» гэсэн зөвлөмж checklist-д)', 'Алдаа, зам заахгүй',
          'Жилийн хаалтын журналыг period lock-оос чөлөөлөх (системийн бичилт), эсвэл алдаанд reopen_period → create_year_end_closing → close_period гэсэн зам бичих', 'orgs/B/mcplog.jsonl 2025:ye', 'B')
    o.call('reopen_period', {'code': m}, f'{year}:ye'); reopened = True
    ok, t = o.call('create_year_end_closing', {'year': year}, f'{year}:ye')
nos = re.findall(r'((?:YE|CL|GL)-\d\d-\d{6})', t)
o.note(year, f'year-end drafts {nos}')
C.post_drafts_web(o, m)
L.remove(lambda l: l['ref'] == f'YE:{year}')
# oracle: орлого/зардлын дансдыг 44000001 руу (12-31)
d = f'{year}-12-31'
bal = L.tb('0000-01-01', d)
ent = []
net = 0.0
for acc, v in bal.items():
    if acc[0] in '5678' and abs(v) > 0.004:
        ent.append((acc, -v if v < 0 else 0, v if v > 0 else 0)); net += v
ent.append(('44000001', net if net > 0 else 0, -net if net < 0 else 0))
L.post(d, ent, f'YE:{year}')
o.save()
subprocess.run([sys.executable, os.path.join(ROOT, 'steps', 'compare.py'), org, m])
if reopened:
    C.close(o, m); o.save()
ok, t = o.call('get_balance_sheet', {'asOf': d}, f'{year}:ye')
ok, t = o.call('get_trial_balance', {'from': f'{int(year)+1}-01-01', 'to': f'{int(year)+1}-01-31'}, f'{year}:ye-next')
print(t[:1500])
