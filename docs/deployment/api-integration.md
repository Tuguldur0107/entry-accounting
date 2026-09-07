# Гадаад системтэй холбох — REST API v1 ба MCP

Entry-д **нэг л tool давхарга** бий (`lib/ai/tools.ts` + `custom/`): чатын AI,
MCP клиент, REST API гурвуулаа ижил 90+ tool-ийг ижил дүрмээр (ноорог-first,
10 сая ₮ хязгаар, периодын хамгаалалт, `externalRef` idempotency) дууддаг.
Тиймээс интеграци = "аль tool-ийг, ямар input-тэй дуудах вэ" гэдэг л асуулт.

## Нэвтрэлт

Тохиргоо → AI туслах → MCP холболт → **Шинэ token** (`eak_...`, нэг л удаа
харагдана). Интеграци бүрд тусдаа token, хугацаатай. OAuth-оор холбогдсон
клиентийн `eoat_` token мөн ажиллана.

```
Authorization: Bearer eak_xxxxxxxx
```

## REST API v1

### Tool жагсаалт + JSON schema

```bash
curl -s https://<domain>/api/v1/tools -H "Authorization: Bearer $TOKEN" | jq '.tools[] | .name'
```

### Tool дуудах

```bash
curl -s -X POST https://<domain>/api/v1/tools/create_cash_transaction \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "documentType": "receipt",
    "cashAccount": "Хаан банк MNT",
    "date": "2026-09-07",
    "amount": 550000,
    "counterparty": "Говь ХК",
    "description": "POS борлуулалт #A-1042",
    "externalRef": "pos:A-1042"
  }'
```

Хариу:

```json
{ "ok": true, "result": "Мөнгөн хөрөнгийн баримт үүслээ: ...", "action": { "type": "cash", "id": "…" }, "dedup": false, "mode": "draft" }
```

| HTTP | `code` | Утга |
|------|--------|------|
| 200 | — | Амжилт. `dedup:true` = ижил `externalRef` байсан, шинээр үүсгээгүй |
| 401 | `UNAUTHORIZED` | Token буруу/хугацаа дууссан |
| 404 | `TOOL_NOT_FOUND` | Нэр буруу — `GET /api/v1/tools` |
| 422 | `COUNTERPARTY_NOT_FOUND`, `ACCOUNT_NOT_FOUND`, `CONFLICT`, `AMOUNT_LIMIT_EXCEEDED`, `DIRECT_MODE_REQUIRED`, `TOOL_ERROR` … | Бизнес/validation алдаа — `error` монгол текст |
| 429 | `RATE_LIMITED` | 10 хүсэлт/минут — `Retry-After: 60` |
| 500 | `TOOL_ERROR` | Дотоод алдаа (лог руу бичигдсэн) |

Бүх хариунд `X-Entry-Version` header — интеграци аль хувилбартай ярьж
байгаагаа логлож болно.

### Idempotency (retry аюулгүй)

`create_journal_voucher`, `create_arap_invoice`, `create_cash_transaction`
(+ batch хувилбарууд) `externalRef` авдаг — гадаад системийн давтагдашгүй
дугаар (POS чек, eBarimt ДДТД, банкны гүйлгээний ID). Сүлжээний алдаанд
дахин илгээхэд давхар баримт үүсэхгүй.

### Batch

`create_counterparties_batch`, `create_arap_invoices_batch`,
`create_cash_transactions_batch`, `create_journal_vouchers_batch`,
`create_gl_accounts_batch`, `create_inventory_items_batch`,
`create_employees_batch`, `create_fixed_assets_batch` — `{ "items": [...] }`,
max 100, partial success (мөр бүрийн үр дүн тусдаа).

### Ердийн интеграцийн хэв маяг

| Систем | Урсгал | Tool |
|--------|--------|------|
| POS / онлайн дэлгүүр | Захиалга бүрд АР нэхэмжлэх + төлбөр | `create_arap_invoice` (vatMode) → `pay_arap_document` эсвэл `create_cash_transaction` (`applyTo`) |
| Банк | Хуулгыг өдөр бүр татаж импорт | `import_bank_statement` → вэб дээр авто тулгалт |
| CRM | Шинэ клиент → харилцагч | `create_counterparty` (ТТД давхардал → `[CONFLICT]`, алгасна) |
| HR | Ажилтны өөрчлөлт | `create_employee` / `update_employee` |
| BI / Data warehouse | Тайлан татах | `get_trial_balance`, `get_income_statement`, `get_balance_sheet`, `get_account_ledger` (унших — аль ч горимд) |
| n8n / Make / Zapier | HTTP Request node → дээрх endpoint | — |

## Outbound (Entry → гадагш)

Батлагдсан журнал бүрд гадаад систем рүү мэдэгдэх бол `custom/` hook:
`custom/packages/demo/index.ts`-ийн `afterJournalPost` — `CUSTOM_WEBHOOK_URL`
env-д POST хийдэг жишээ. Алдаа нь бичилтийг унагахгүй (логлогдоно), 5 сек
timeout. Өөрийн багцад хуулж URL/бүтцээ өөрчилнө.

## MCP (AI клиентэд)

```bash
claude mcp add --transport http --scope user entry-accounting \
  https://<domain>/api/mcp --header "Authorization: Bearer eak_..."
```

Cowork / claude.ai: Connectors → Add custom connector → URL `https://<domain>/api/mcp`,
Authentication: OAuth → нэвтрээд зөвшөөрнө (token хэрэггүй).

## Custom tool нэмэх (шинэ endpoint = шинэ tool)

Гадаад системд хэрэгтэй, core-д байхгүй үйлдэл (жишээ нь "барааны үлдэгдлийг
POS-ийн форматаар өгөх") бол `custom/packages/<нэр>/index.ts`-д tool бичнэ —
шууд `POST /api/v1/tools/<нэр>` болж, MCP-д ч харагдана. Заавар: `custom/CLAUDE.md`.
