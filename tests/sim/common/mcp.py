"""Sim 2.0 MCP client — байгууллага бүрт тусдаа token/log; read 60/мин, write 20/мин хязгаарт тааруулсан throttle."""
import json, time, os, requests, datetime, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Default ЛОКАЛ — production-ийг санамсаргүй цохихгүй (tests/sim/README.md).
BASE = os.environ.get('SIM_BASE', 'http://localhost:3000')
READ_PREFIXES = ('list_', 'get_', 'lookup_', 'read_', 'reconcile_')


class Client:
    def __init__(self, org=None, base=None, token=None, role='owner'):
        self.org = org or os.environ.get('SIM_ORG', 'C')
        self.base = base or BASE
        self.odir = os.path.join(ROOT, 'orgs', self.org)
        tf = os.path.join(self.odir, '.token' if role == 'owner' else f'.token-{role}')
        # Token env-ээс (SIM_TOKEN_<ORG>[_<ROLE>]) эсвэл orgs/<org>/.token (gitignore).
        env_key = f'SIM_TOKEN_{self.org}' + ('' if role == 'owner' else f'_{role.upper()}')
        self.token = token or os.environ.get(env_key) or open(tf).read().strip()
        self.url = f'{self.base}/api/mcp/{self.token}'
        self.log = os.path.join(self.odir, 'mcplog.jsonl')
        self.s = requests.Session()
        self.s.headers.update({'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
        self._id = 0
        self._last = {'read': 0.0, 'write': 0.0}
        self._gap = {'read': 1.05, 'write': 3.1}
        self.lock = threading.Lock()

    def rpc(self, method, params=None):
        self._id += 1
        for attempt in range(4):
            try:
                r = self.s.post(self.url, json={'jsonrpc': '2.0', 'id': self._id, 'method': method, 'params': params or {}}, timeout=180)
                break
            except requests.exceptions.RequestException as e:
                open(self.log, 'a').write(json.dumps({'ts': datetime.datetime.now().isoformat(), 'tool': method, 'retry': attempt, 'err': str(e)[:200]}) + '\n')
                if attempt == 3:
                    raise
                time.sleep(15 * (attempt + 1))
        txt = r.text
        if txt.startswith('event:') or 'data:' in txt[:20]:
            txt = [l[5:].strip() for l in txt.splitlines() if l.startswith('data:')][-1]
        return r.status_code, json.loads(txt)

    def call(self, name, args=None, tag=''):
        kind = 'read' if name.startswith(READ_PREFIXES) else 'write'
        while True:
            with self.lock:
                wait = self._gap[kind] - (time.time() - self._last[kind])
                if wait > 0:
                    time.sleep(wait)
                self._last[kind] = time.time()
            t0 = time.time()
            st, j = self.rpc('tools/call', {'name': name, 'arguments': args or {}})
            dt = round(time.time() - t0, 2)
            if 'error' in j and j['error'].get('code') == -32000:
                time.sleep(20)
                continue
            if 'error' not in j:
                res = j['result']
                text = '\n'.join(c.get('text', '') for c in res.get('content', []))
                if res.get('isError') and 'Хэт олон хүсэлт' in text:
                    time.sleep(15)
                    continue
            break
        if 'error' in j:
            ok = False
            text = 'RPC_ERROR ' + json.dumps(j['error'], ensure_ascii=False)
        else:
            res = j['result']
            text = '\n'.join(c.get('text', '') for c in res.get('content', []))
            ok = not res.get('isError')
        with open(self.log, 'a') as f:
            f.write(json.dumps({'ts': datetime.datetime.now().isoformat(), 'org': self.org, 'tag': tag, 'tool': name, 'args': args, 'ok': ok, 'sec': dt, 'text': text[:6000]}, ensure_ascii=False) + '\n')
        return ok, text

    def tools(self):
        st, j = self.rpc('tools/list')
        return j['result']['tools']


if __name__ == '__main__':
    import sys
    c = Client(sys.argv[1] if len(sys.argv) > 1 else None)
    print(c.rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'sim2', 'version': '2'}})[1].get('result', {}).get('serverInfo'))
    t = c.tools()
    print(len(t))
    json.dump(t, open(os.path.join(ROOT, 'out', 'tools.json'), 'w'), ensure_ascii=False, indent=1)
    print(c.call('get_active_company', {})[1])
