"""Sim 2.0 engine — байгууллага бүрийн төлөв (sim_state.json), MCP client, oracle."""
import json, os, re, sys, calendar, importlib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'common')); sys.path.insert(0, os.path.join(ROOT, 'profiles'))
from mcp import Client
from oracle import Ledger, eom, day, add_months, r2, payroll_calc
from issues import add as issue

VAT = 0.10


class Org:
    def __init__(self, org):
        self.org = org
        self.P = importlib.import_module(org)
        self.c = Client(org)
        self.L = Ledger(org)
        self.L.load_state()
        self.path = os.path.join(ROOT, 'orgs', org, 'sim_state.json')
        self.s = json.load(open(self.path)) if os.path.exists(self.path) else dict(open_ar=[], open_ap=[], stock={}, drafts=[], months_done=[], notes=[], rates={}, fa=[], employees={})
        self.ITEM = {i['code']: i for i in self.P.ITEMS}

    def save(self):
        json.dump(self.s, open(self.path, 'w'), ensure_ascii=False, indent=1)
        self.L.save_state()

    def call(self, name, args, tag=''):
        ok, t = self.c.call(name, args, tag=tag)
        print(f'== {name} [{tag}] ok={ok}\n{t[:1200]}\n', flush=True)
        return ok, t

    def rate(self, cur, date):
        k = f'{cur}:{date}'
        if k not in self.s['rates']:
            ok, t = self.call('get_exchange_rate', {'currency': cur, 'date': date}, 'rate')
            m = re.search(r'ханш [\d-]+: ([\d,\.]+)₮', t)
            self.s['rates'][k] = float(m.group(1).replace(',', '')) if m else None
        return self.s['rates'][k]

    def docnos(self, text, prefix):
        return re.findall(rf'({prefix}-\d{{8}}-[0-9A-F]{{6}})', text)

    def jvnos(self, text):
        return re.findall(r'((?:GL|CM|PAY|FX|AR|AP|COST|CL|YE|FA)-\d\d-\d{6})', text)

    def note(self, m, txt):
        self.s['notes'].append(f'{m}: {txt}')
        print('NOTE', m, txt, flush=True)
