"""B сарын бүтэн цикл: ops → вэб батлалт → цалин → ҮХ → НӨАТ → шалгалт → тулгалт → хаалт. python3 steps/run_month_B.py 2025-07 [--noclose]"""
import sys, os, random, subprocess, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import *
import closing as C
import month_B as MB
import specials_B as SB
m = sys.argv[1]; noclose = '--noclose' in sys.argv
o = MB.o
R = random.Random(int(m.replace('-', '')) * 7)
print(f'######## B {m}', flush=True)
SB.early(o, m, R)
for st in ['sales', 'purchases', 'collections', 'misc']:
    getattr(MB, st)(m, R); o.save()
SB.late(o, m, R); o.save()
C.node('B', 'post_arap_all.mjs', 'receivables', m, f'ar-{m}')
C.node('B', 'post_arap_all.mjs', 'payables', m, f'ap-{m}')
C.node('B', 'bulk_post.mjs', '/cash/transactions', m, f'cash-{m}')
C.payroll(o, m); o.save()
C.post_drafts_web(o, m)
C.pay_payroll(o, m); o.save()
C.node('B', 'bulk_post.mjs', '/cash/transactions', m, f'cash2-{m}')
C.fa_dep(o, m); o.save()
C.ensure_arap_posted(o, m)
C.vat_manual(o, m); o.save()
C.post_drafts_web(o, m)
C.node('B', 'bulk_post.mjs', '/cash/transactions', m, f'cash3-{m}')
C.check(o, m)
subprocess.run([sys.executable, os.path.join(ROOT, 'steps', 'compare.py'), 'B', m])
if not noclose:
    C.close(o, m); o.save()
print(f'######## B {m} DONE', flush=True)
