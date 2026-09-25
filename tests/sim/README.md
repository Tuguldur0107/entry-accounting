# Симуляцийн harness (sim 2.0)

Бодит хэмжээний байгууллагыг (B — үйлчилгээ, дунд жилийн нээлт; C — импорт +
POS) MCP + вэбээр сар сараар ажиллуулж, бие даасан **oracle** дэвтэртэй
(`common/oracle.py`) тулгадаг. Зорилго: засвар бүрийн дараа `compare.py`
**0 зөрүү** (align бичилтгүйгээр).

> Production руу ХЭЗЭЭ Ч ажиллуулахгүй — зөвхөн local / тусдаа тестийн сервер.
> Бодит харилцагчийн өгөгдөлд хүрэхгүй.

## Орчин (env)

| Хувьсагч | Утга |
|----------|------|
| `SIM_BASE` | Серверийн хаяг (default `http://localhost:3000`) |
| `SIM_ORG` | `B` / `C` (скриптүүд өөрсдөө тавина) |
| `SIM_EMAIL`, `SIM_NAME`, `SIM_PASSWORD` | Бүртгүүлэх / нэвтрэх хэрэглэгч — **repo-д хадгалахгүй** |
| `SIM_TOKEN_<ORG>` | MCP token (байхгүй бол `orgs/<ORG>/.token` — `web/token.mjs` бичнэ) |

`orgs/` (session cookie, token, лог, oracle төлөв) `.gitignore`-д — commit хийхгүй.

## Local сервер

```bash
createdb entry_sim
DATABASE_URL=postgres://…/entry_sim AUTH_SECRET=… npm run db:predeploy
DATABASE_URL=postgres://…/entry_sim AUTH_SECRET=… AUTH_TRUST_HOST=1 \
  ENTRY_DEPLOYMENT_MODE=saas NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  NOTIFICATIONS_TICKER=off EBARIMT_WORKER=off npx next dev -p 3000
```

`next dev` лицензийн шалгалтгүй тул sim-д тохиромжтой. Playwright:
`cd tests/sim && npm ci` (Chromium нь `PLAYWRIGHT_BROWSERS_PATH`-аас).

## Ажиллуулах

```bash
cd tests/sim
export SIM_BASE=http://localhost:3000 SIM_PASSWORD=…
SIM_EMAIL=sim-b@example.test SIM_NAME="SIM Технологи ХХК" ./run_org.sh B 2025-07 2025-08 2025-09
SIM_EMAIL=sim-c@example.test SIM_NAME="SIM Импорт ХХК"    ./run_org.sh C 2025-01 2025-02
```

`run_org.sh` = `setup_org.sh` (бүртгүүлэх → «Шууд бичих» горим → MCP token →
`sync_standard_accounts`) → `steps/master.py` → `steps/opening_<ORG>.py` →
(C: `setup_pos_C.py`) → сар бүр `steps/run_month_<ORG>.py <YYYY-MM>`.
Сар бүрийн `compare` алхам `orgs/<ORG>/compare_<YYYY-MM>.txt`-д бичнэ;
тусад нь: `python3 steps/compare.py B 2025-07`. Нэг алхмаас үргэлжлүүлэх:
`python3 steps/run_month_B.py 2025-08 --from=payroll`.

## Бүтэц

```
common/   mcp.py (MCP клиент + лог), engine.py (Org төлөв), oracle.py (бие даасан
          дэвтэр), harness.mjs (Playwright нэвтрэлт), issues.py
profiles/ B.py / C.py / D.py — master data, нээлт, сарын гүйлгээний генератор
steps/    master, opening_*, run_month_*, month_*, specials_*, closing, compare, tracker
web/      Зөвхөн вэбээр хийгддэг алхмууд (Excel импорт, бөөн батлалт, PO/GR, сар хаах…)
```
