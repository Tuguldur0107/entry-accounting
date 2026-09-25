import sys, os, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common')); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import *
import closing as C
m = sys.argv[1]; o = Org('B')
C.node('B', 'post_arap_all.mjs', 'receivables', m, f'ar-{m}')
C.node('B', 'post_arap_all.mjs', 'payables', m, f'ap-{m}')
C.node('B', 'bulk_post.mjs', '/cash/transactions', m, f'cash-{m}')
C.payroll(o, m); o.save()
C.post_drafts_web(o, m)
C.pay_payroll(o, m); o.save()
C.node('B', 'bulk_post.mjs', '/cash/transactions', m, f'cash2-{m}')
C.fa_dep(o, m); o.save()
C.vat_manual(o, m); o.save()
C.post_drafts_web(o, m)
C.node('B', 'bulk_post.mjs', '/cash/transactions', m, f'cash3-{m}')
C.check(o, m)
subprocess.run([sys.executable, os.path.join(ROOT, 'steps', 'compare.py'), 'B', m])
if '--noclose' not in sys.argv:
    C.close(o, m); o.save()
