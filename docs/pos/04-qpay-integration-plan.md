# QPay нэвтрүүлэлтийн төлөвлөгөө — POS Фаз 3b (`ewallet` → QPay Quick QR)

**Төлөв:** **БАТЛАГДСАН** (2026-09-20, D1–D8 санал болгосноор) — Фаз 0 (dashboard) ✅, **Фаз 1 (Entry цөм) ✅**, **Фаз 2 (нэг товчны холболт §3.6, ажиллагаа) ✅** — гэрээ `01-implementation-contract.md` §10, байдал `02-implementation-status.md`, нэвтрүүлэлт `docs/deployment/qpay.md`. Дараагийн: пилот (Хос Хас, 100₮ бодит тест).
**Суурь:** `00-proposal.md` §3.4 (`ewallet` kind — «Фаз 3 API (QPay invoice → callback)»),
`03-ebarimt-integration-plan.md` (ижил бүтэц: дараалал, readiness, attention).
**Эх сурвалж:** `Tuguldur0107/qpay-dashboard` repo (код + `PROGRESS.md` 2026-08-10,
`docs/MCP.md`, `Qpay docs/`), Railway `qpay-dashboard` (production), ККТТ-ийн
«Хамтран ажиллах гэрээ» (ХСН загвар), ККТТ-ийн и-мэйлүүд (Link-үүд.docx),
QPay developer портал (Quick QR v2 / Merchant V2 — dashboard-ын судалгаанаас).

---

## 1. Судалгааны дүн — юу байгаа, юу байхгүй

### 1.1 QPay-тэй харилцах ЗАГВАР: Entry = ХСН, qpay-dashboard = хаалга

ККТТ-тэй байгуулах гэрээ нь «**Хэрэглэгчийн систем нийлүүлэгч (ХСН)**» загвар —
eBarimt-ийн операторын загвартай ИЖИЛ: Хос Хас Технологи (CHIPMO) нэг эцэг
мерчант, харилцагч бүр **sub-merchant** (Quick QR `/v2/merchant/person|company`),
төлбөр нь харилцагчийн ӨӨРИЙН банкны данс руу шууд орно (`bank_accounts[]`
нэхэмжлэх бүрд). Шимтгэл: **үнийн дүнгийн 1%**, гүйлгээ хийгдэх үед суутгагдана
(гэрээ §3); байгууллага ККТТ-тэй өөрийн мерчантын гэрээтэй бол тэр хувиар.

`qpay-dashboard` энэ загварыг аль хэдийн хэрэгжүүлсэн:

| Юу | Төлөв | Entry-д хамаарал |
|---|---|---|
| Sub-merchant онбординг (РД, MCC, хот/дүүрэг, банкны данс) | ✅ production | Харилцагч dashboard дээр өөрөө бүртгүүлнэ — Entry давтахгүй |
| Public REST `POST /api/v1/invoices`, `GET /api/v1/invoices/{id}`, `DELETE`, `GET /api/v1/payments/check?invoice_id=` — `x-api-key` (мерчант бүрд `qpd_live_…`) | ✅ | Entry-ийн ЦОРЫН ГАНЦ холболтын цэг |
| Webhook → мерчантын URL: `POST` JSON `{event:"payment.paid", invoice_id, amount, description, merchant_id, payment_id, paid_at}`, `x-webhook-signature` = hex HMAC-SHA256(body, webhook_secret), 3 оролдлого (0/1/3с), 5с timeout, 4xx бол зогсоно | ✅ | Entry-ийн `/api/pos/qpay/webhook` хүлээн авагч |
| Нэхэмжлэх бүрд `callback_url` өгч болно (мерчантын ерөнхий webhook-оос давуу) | ✅ | Entry борлуулалт бүрдээ `?intent=<id>` дагуулна |
| Төлбөр баталгаажуулалт = QPay `POST /v2/payment/check` + дүнгийн шалгалт (`verifyAndMarkPaid`) — «callback нь дохио, эх сурвалж биш» | ✅ | Entry ч webhook-ийн `amount`-ыг ӨӨРИЙН дүнтэй тулгана |
| MCP server (`/api/mcp`, 5 tool) | ✅ | Entry-д хэрэггүй (Entry өөрийн tool давхаргатай) |
| Refund / eBarimt / payment list | ❌ **Quick QR-д БАЙХГҮЙ** (албан баримтаар батлагдсан) | Буцаалт → бэлэн/кредитээр; eBarimt → Entry өөрөө (аль хэдийн) |
| PAID урсгал БОДИТ төлбөрөөр туршигдсан | ❌ (sandbox симуляцгүй) | Фаз 0-ийн ЭХНИЙ ажил |
| Production deploy | ⚠️ сүүлийн deploy (ee5aba0, 2026-08-17) **FAILED** — амьд нь 8d507a5 (08-12) | Фаз 0-д засна |
| Rate limit | 120 хүсэлт/мин мерчант тус бүр | Polling-ийн дээд хязгаар |

### 1.2 ККТТ-ийн ХАТУУ шаардлага (и-мэйл + гэрээ §4.1.5)

- Token 24 цаг хүчинтэй — **нэг л удаа авна** (dashboard кэшлэдэг, Entry токентой
  харьцахгүй).
- «Нэхэмжлэх үүсгэхдээ оруулсан Callback URL-аараа мэдээлэл авсны ДАРАА
  `payment/check` дуудна. Зөвхөн PAID төлөв дамжуулсан тохиолдолд үйлчилгээ
  үзүүлнэ.» — **Cron / bill-check тогтмол ажиллуулах, webhook тохируулахгүй
  байхыг ХОРИГЛОНО**, зөрчвөл ККТТ түр хязгаарлана.
- Дансны нэр/дугаар зөрсний хариуцлага **Байгууллага** (харилцагч) хүлээнэ —
  ХСН нь дансны мэдээллийг баталгаажуулж ККТТ-д мэдэгдэнэ.

→ Entry-ийн дизайн: **webhook үндсэн, polling нөөц** (§3.3).

### 1.3 Аюулгүй байдлын дутагдал (dashboard repo-д, ЯАРАЛТАЙ)

- `Qpay docs/Link-үүд.docx`, `Qpay docs/Quick QR test API/Credential.txt`,
  `Test Environment/e-mail.txt` — **CHIPMO production ба sandbox нэвтрэх
  нууц үг plaintext-ээр git-д tracked**. Repo private байсан ч түүхэнд үлдсэн.
  Фаз 0: файлуудыг repo-оос хасах (`git rm`, `.gitignore`), ККТТ-ээс production
  нууц үгийг **солиулах** (Railway `QPAY_QR_PASSWORD` шинэчлэх).
- Энэ төлөвлөгөө, Entry-ийн код, docs-д нууц ХЭЗЭЭ Ч хуулагдахгүй (ижил дүрэм
  eBarimt-тэй).

---

## 2. Зорилго, хамрах хүрээ

**Зорилго:** Entry POS-ийн «Төлбөр авах» диалогт **[QPay]** товч — кассчин
дарахад QR (+ 22 банкны deeplink) гарч, харилцагч банкны апп-аар төлмөгц
диалог **автоматаар** «Төлөгдлөө» болж борлуулалт батлагдана (`createPosSale`),
ТЕГ-д eBarimt илгээгдэнэ (одоогийн зам), GL-д QPay түр данс → банкны хуулгаар
тэгшитгэгдэнэ.

**Хамрахгүй (Фаз 3c+):** АР нэхэмжлэхийг QPay-ээр төлүүлэх (и-мэйл дэх QR),
SocialPay/MonPay, харилцагч руу харсан хоёр дахь дэлгэц, QPay refund
(Quick QR-д байхгүй), онбордингийг Entry дотор давтах.

---

## 3. Дизайн

### 3.1 Архитектур (D1)

```
Entry (SaaS / dedicated)                  qpay-dashboard (Railway)                 QPay Quick QR
┌────────────────────────┐   x-api-key   ┌──────────────────────────┐            ┌─────────┐
│ POS төлбөрийн диалог   │──────────────▶│ POST /api/v1/invoices    │───────────▶│ /v2/    │
│  [QPay] → intent       │               │  (sub-merchant, банк)    │  QR+urls   │ invoice │
│  QR + deeplink + таймер│◀──────────────│                          │◀───────────│         │
│                        │               │                          │            │         │
│ /api/pos/qpay/webhook  │◀──HMAC POST───│ /api/webhook (QPay→)     │◀──callback─│ PAID    │
│  → intent paid         │               │  verifyAndMarkPaid       │            │         │
│  → createPosSale       │  (нөөц)       │ GET /api/v1/payments/    │            │         │
│ [Шалгах] ≤ 1/10с      │──────────────▶│      check               │───────────▶│ check   │
└────────────────────────┘               └──────────────────────────┘            └─────────┘
```

- Entry QPay-тэй **шууд ярихгүй** — dashboard нь токен, sub-merchant, банкны
  данс, ККТТ-ийн дүрмийг нэг газар барина (eBarimt-ийн PosAPI-тай ижил давхарга).
- Харилцагч бүр: dashboard дээр бүртгүүлж онбординг → **API key + webhook
  secret** → Entry → Тохиргоо → POS → «QPay» табд буулгана. Console-д БИШ
  (eBarimt-тэй ижил: мерчантын тохиргоо харилцагчийн апп-д).
- Dedicated (on-prem, нийтийн URL-гүй) харилцагчид webhook хүрэхгүй → polling
  нөөц зам л ажиллана (§3.3), тохиргоонд ил анхааруулна.

### 3.2 Мөнгөний урсгал ба GL (өөрчлөлт ҮГҮЙ)

`ewallet` kind аль хэдийн бий: Dr **QPay түр данс** (`cash_accounts` bank, роль
`pos_payment_methods.cashAccountId`) / Cr Авлага, `businessObjectType pos_sale`.
Төлбөр харилцагчийн банкны дансанд шимтгэл (1%) хасагдаад орно → банкны хуулга
импорт `transfer` + шимтгэл `payment` (`feePercent` мэдээллийн) — картын
терминалтай ЯГ ижил. Шинэ данс, шинэ бичилт байхгүй.

### 3.3 Төлбөрийн урсгал — «intent» объект (D2, D3)

Борлуулалт нь төлбөр батлагдтал ҮҮСДЭГГҮЙ (одоогийн атомик дүрэм) тул QPay
нэхэмжлэхийг **`pos_qpay_intents`** мөрөнд түр хадгална:

```
① Кассчин [QPay] → createQpayIntent({shiftId, amount, cartSnapshot, buyer})
     → dashboard POST /api/v1/invoices {amount, sender_invoice_no: intent.id,
        invoice_description: "<дэлгүүр> POS", callback_url: <Entry>/api/pos/qpay/webhook?intent=<id>}
     → intent {status: "open", qpayInvoiceId, qrText, qrImage, urls[], expiresAt = +3 мин}
② Диалог: QR (том), 22 банкны deeplink (гар утаснаас нээх), таймер, [Шалгах], [Цуцлах]
     кассын дэлгэц ӨӨРИЙН DB-ээс intent статусыг 2 сек тутам уншина (QPay-д хүрэхгүй)
③ Харилцагч төлнө → QPay → dashboard verifyAndMarkPaid → Entry webhook (HMAC + amount тулгалт)
     → intent {status: "paid", paymentId, paidAt}   (идемпотент: paid бол дахин бичихгүй)
④ Кассын дэлгэц paid харангуут createPosSale({payments:[{method: QPay, amount, reference: qpayInvoiceId}], qpayIntentId})
     → intent {status: "finalized", saleId}; хэвийн зам: АР + касс (QPay түр данс) + eBarimt
⑤ Цуцлах / хугацаа дуусах → DELETE /api/v1/invoices/{id} → intent "cancelled" | "expired"
```

- **[Шалгах] товч** = dashboard `payments/check` (QPay-ийн `payment/check`) —
  ≤ 1 удаа/10 сек (client + server debounce), таймер дуусахад нэг удаа
  автоматаар. ККТТ-ийн «cron шалгалт» хориг зөрчигдөхгүй.
- **Төлөгдсөн ч батлагдаагүй** (кассчин диалог хаасан, цахилгаан тасарсан):
  intent `paid` хэвээр → Борлуулалт → «QPay хүлээгдэж буй» chip (тоолуур),
  cartSnapshot-оос НЭГ товчоор борлуулалт бүртгэнэ; `attention.ts`
  `pos.qpay_paid_unfinalized` (paid ≥ 10 мин, батлагдаагүй) — мөнгө орсон
  боловч бараа хасагдаагүй, eBarimt үүсээгүй байх нь хамгийн том эрсдэл.
- **Хэсэгчилсэн QPay төлбөр** (QPay + бэлэн холимог): intent дүн = QPay-ийн
  мөрийн дүн; бусад мөр ердийн. Нэг борлуулалтад нэг QPay intent.
- **Буцаалт:** QPay хэлбэрт `allowsRefund = false` (seed) → `returnPosSale`
  бэлэн эсвэл дэлгүүрийн кредитээр (одоогийн UI зөвшөөрдөг). Quick QR refund
  API байхгүй тул автомат буцаалт ҮГҮЙ — docs-д ил.

### 3.4 Схем (Entry)

```
pos_settings          + qpayEnabled boolean default false
                      + qpayApiUrl text default 'https://qpay-dashboard-production.up.railway.app'
                      + qpayApiKeyEnc text        (AES-256-GCM — lib/ai/crypto.ts encryptSecret, ai_settings-тэй ижил)
                      + qpayWebhookSecretEnc text (мөн адил)
                      + qpayMerchantId text       (dashboard-оос уншсан, зөвхөн харуулах)
                      + qpayInvoiceTtlSec integer default 180
pos_payment_methods   + provider text null        ("qpay" — ewallet kind-ийн дэд төрөл; SocialPay г.м. дараа)
pos_qpay_intents      id, organizationId, shiftId, cashierUserId, amount numeric(18,2),
                      cartSnapshot jsonb (SaleQuoteInput + buyer), status text
                      (open|paid|finalized|cancelled|expired|failed), qpayInvoiceId,
                      qrText, qrImage (base64, түр — finalized/expired-д null-дана),
                      urls jsonb, paymentId, paidAmount, paidAt, expiresAt, saleId → pos_sales,
                      lastCheckAt, lastError, createdAt, updatedAt
                      uniqueIndex (organizationId, qpayInvoiceId); index (organizationId, status)
```

Дүрмүүд: `uniqueIndex` л (constraint ХОРИОТОЙ — #5955); preDeploy
`apply-pending-ddl.mjs` add-column жагсаалт; нууц `/api/health`-д ГАРАХГҮЙ
(зөвхөн тоолуур: enabledOrganizations, openIntents, paidUnfinalized).

### 3.5 Модулиуд (Entry)

```
lib/qpay/
├── constants.ts      QPAY_PROVIDER, статусууд, TTL, CHECK_MIN_INTERVAL_MS, шошго — CLIENT-SAFE
├── types.ts          DashboardInvoice (invoice_id, qr_text, qr_image, urls[]), WebhookPayload, IntentView
├── intent.ts         ЦЭВЭР (тесттэй): шилжилтийн машин (open→paid→finalized, cancel/expire дүрэм),
│                     verifyWebhook(rawBody, signature, secret) timing-safe, amountMatches(intent, payload)
├── client.ts         dashboard REST клиент (x-api-key, timeout 8с, алдаа → [QPAY_*] код) — DB-гүй
├── store.ts          DB давхарга: createIntent / markPaid (идемпотент) / finalize / cancel / expireStale
└── readiness.ts      ЦЭВЭР: асаахын ӨМНӨ — API key, webhook secret, QPay хэлбэр (provider=qpay,
                      cashAccountId, ebarimtCode), нийтийн URL (dedicated анхааруулга)
lib/actions/qpay.ts   createQpayIntent / checkQpayIntent (throttled) / cancelQpayIntent /
                      finalizeQpayIntent (→ createPosSale) / listPendingQpayIntents /
                      saveQpaySettings / testQpayConnection (GET /api/v1/invoices?limit=1 эсвэл check)
app/api/pos/qpay/webhook/route.ts   POST: rawBody → HMAC → intent=? → amount тулгах → markPaid → 200
                                    (алдаанд 4xx — dashboard дахин оролдохгүй; 5xx — оролдоно)
components/pos/checkout/qpay-dialog.tsx   QR, deeplink жагсаалт, таймер, статус, [Шалгах]/[Цуцлах]
components/pos/pos-settings-view.tsx      «QPay» дэд таб (URL, key, secret, холболт шалгах, readiness)
components/pos/sales-list-view.tsx        «QPay хүлээгдэж буй» chip + finalize үйлдэл
lib/notifications/attention.ts            pos.qpay_paid_unfinalized, pos.qpay_webhook_failing
lib/ai/tools.ts                           get_qpay_status (унших), list_qpay_intents; create_pos_sale-д
                                          QPay ОРОХГҮЙ (харилцагч уншуулах ёстой — AI-аар утгагүй)
```

Хатуу дүрмүүд (eBarimt-тэй нийцүүлсэн):

- **Борлуулалт intent-гүй QPay төлбөрөөр батлагдахгүй** — `createPosSale`-д
  QPay хэлбэрийн мөр ирвэл `qpayIntentId` заавал, intent `paid`, дүн таарна
  (`[QPAY_INTENT_REQUIRED]` / `[QPAY_AMOUNT_MISMATCH]`). Кассчин «төлсөн» гэж
  гараар тэмдэглэх зам ҮГҮЙ (одоогийн `ewallet` гар лавлагаа нь `provider`
  хоосон хэлбэрт л үлдэнэ — QPay биш SocialPay г.м.).
- **Webhook = дохио, dashboard-ын `verifyAndMarkPaid` = баталгаа**; Entry
  нэмээд `amount === intent.amount` шалгана, зөрвөл `failed` + аудит.
- **Нууц шифртэй**, лог/аудит/health-д хэзээ ч гарахгүй; API key солиход
  dashboard дээр rotate → Entry-д шинийг буулгана.
- **Polling QPay-руу ≤ 1/10 сек, зөвхөн хэрэглэгчийн үйлдлээр** — cron
  БАЙХГҮЙ. `expireStale` нь зөвхөн Entry DB-д (сүлжээгүй).
- Intent бүр `logAuditEvent` (`pos_qpay_intent`: create/paid/finalize/cancel/
  expire) — мэдэгдэл `rules.ts`-ээр (гар emit үгүй).

### 3.6 Нэг товчны холболт (Фаз 2, БАТЛАГДСАН 2026-09-20)

Харилцагч key хуулахгүй — OAuth-ийн «authorization code» загвар:

```
Entry [QPay холбох] → state (AES-GCM: org, user, apiUrl, nonce, 15 мин; lib/qpay/connect.ts)
  → {dashboard}/connect?app=entry&callback={entry}/api/pos/qpay/connect/callback&state&org
  → dashboard: нэвтрэлт / бүртгэл / онбординг (post-auth.ts хадгалсан замаар буцна) → consent
  → POST /api/connect/approve (session+CSRF): API хандалт нээгдэнэ, key ҮҮСНЭ / байгаа бол СОЛИГДОНО,
    secret байгаа бол хэвээр → connect_grants (code sha256, 5 мин) → callback?state&code
  → Entry callback: state тайлна → сервер-сервер POST {dashboard}/api/connect/exchange {code,state}
    → key + secret (НЭГ удаа) → encryptSecret → хэлбэр/данс seed (ensureQpayPaymentMethod)
    → readiness (хатуу) → асаана → тохиргооны QPay таб (?qpay=connected|connected-off|error)
```

- Нууц URL / browser / лог / аудитад ХЭЗЭЭ Ч орохгүй; state нь authenticated
  шифр тул өөр байгууллагын нэрээр холболт зохиох боломжгүй; code нэг удаагийн
- Асаахад **«QPay» хэлбэр + «QPay түр данс» (GL 11000099) автоматаар**
  (`lib/qpay/seed.ts` ЦЭВЭР төлөвлөгч, ratified-seed) — байгааг хөндөхгүй;
  eBarimt код ЗОХИОХГҮЙ (T1) — хэрэглэгч оноож өгнө
- Гар зам (key хуулах) хэвээр — нийтийн URL-гүй dedicated суулгацад
- Dashboard: `src/lib/connect-grants.ts`, `src/app/connect`, `src/app/api/connect/{approve,exchange}`,
  `src/lib/post-auth.ts`; `docs/API.md` «Connect» (v1 ӨӨРЧЛӨГДӨӨГҮЙ)
- Нэвтрүүлэлтийн заавар: `docs/deployment/qpay.md`

---

## 4. Шийдвэрлэх асуултууд (батлах)

| # | Асуулт | Санал |
|---|---|---|
| **D1** | Entry QPay-тэй dashboard-аар (x-api-key) юу, шууд (харилцагч бүрийн Quick QR creds) юу? | **Dashboard-аар.** Онбординг, токен, банк, ККТТ-ийн дүрэм нэг газар; Entry-д QPay нууц байхгүй |
| **D2** | Intent хаана амьдрах: Entry DB (`pos_qpay_intents`) юу, dashboard-ын `invoice_records` юу? | **Entry DB.** Борлуулалтын сагс, ээлж, кассчин Entry-д л бий; dashboard нь QPay-ийн толь |
| **D3** | Төлөгдсөн ч батлагдаагүй intent-ийг АВТОМАТААР борлуулалт болгох уу? | **Үгүй** — кассчин/менежер нэг товчоор баталгаажуулна (сагс өөрчлөгдсөн байж болно); 10 мин дараа attention |
| **D4** | Webhook хүрэхгүй dedicated харилцагчид? | Polling нөөц (кассчин [Шалгах] + таймер дуусахад 1 удаа); тохиргоонд «нийтийн URL алга» анхааруулга |
| **D5** | QPay буцаалт | Quick QR-д байхгүй → `allowsRefund=false`, бэлэн/кредитээр; ККТТ-ээс Merchant V2 refund эрх авбал Фаз 3c |
| **D6** | API key / secret хадгалалт | `pos_settings`-д AES шифртэй (ai_settings-ийн `encryptSecret`); Console-д БИШ |
| **D7** | eBarimt төлбөрийн код | QPay хэлбэрийн `ebarimtCode` — ТЕГ-ийн жагсаалтаас харилцагч сонгоно (код зохиохгүй; QPay нь `PAYMENT_CARD` биш байж болно — ТЕГ-ийн кодын жагсаалтаас баталгаажуулах, §6 T1) |
| **D8** | Dashboard-д Entry-д зориулж ЮУ өөрчлөх? | (а) webhook payload-д `sender_invoice_no` нэмэх (intent id-г invoice_id-гүйгээр ч холбоно), (б) `GET /api/v1/invoices?limit=1` = холболт шалгах, (в) failed deploy засах, (г) нууц файлуудыг repo-оос хасах. Бусад нь хэвээр |

---

## 5. Фазууд ба хугацаа

| Фаз | Ажил | Хугацаа | Гарц |
|---|---|---|---|
| **0 — Dashboard бэлтгэл** (эхлээд, Entry-гүй) | (1) Repo-оос нууц файл хасах + ККТТ-ээс production нууц үг солиулах; (2) FAILED deploy (ee5aba0) засах — build лог хоосон, дахин deploy/шалгах; (3) **Хос Хас-ын тест sub-merchant дээр 100₮-ийн БОДИТ төлбөр** — callback GET/POST, `ref`, webhook → таны туршилтын URL (webhook.site) хүрсэн эсэх; (4) D8 (а)(б) жижиг өөрчлөлт; (5) API гэрээг «v1 хөлдөөсөн» гэж `docs/`-д тэмдэглэх | 1 өдөр | PAID урсгал production-д батлагдсан |
| **1 — Entry цөм** ✅ | Схем + preDeploy; `lib/qpay/*` (intent машин, HMAC, client — тесттэй); actions; webhook route; QPay диалог; `createPosSale` intent холболт; тохиргооны таб + readiness; «хүлээгдэж буй» баннер + finalize; (Фаз 2-оос урьдчилж) attention `pos.qpay_paid_unfinalized` + `/api/health.qpay` | 3 өдөр | Кассын дэлгэцээс QPay-ээр борлуулалт |
| **2 — Ажиллагаа** ✅ | **Нэг товчны холболт** (§3.6 — dashboard connect + Entry callback), асаахад хэлбэр/данс автомат seed, борлуулалтын тайланд provider багана, AI `get_qpay_status`, `docs/deployment/qpay.md`, CLAUDE.md §5c, CHANGELOG. (webhook-failing дохио — пилотын дараа, хэрэгцээ гарвал) | 1 өдөр | Харилцагчид өгөх заавар бэлэн |
| **Пилот** | Хос Хас-ын дэлгүүр (eBarimt пилоттой ХАМТ — нэг борлуулалт хоёуланг шалгана) | 1 долоо хоног | v1.6.0 |
| 3c (дараа) | АР нэхэмжлэх QPay QR (и-мэйл/нээлттэй хуудсанд), SocialPay/MonPay provider, refund (эрх авбал) | — | — |

Нийт хөгжүүлэлт ≈ 5 ажлын өдөр + пилот. Зардал: dashboard Railway аль хэдийн
ажиллаж байгаа (нэмэлт үйлчилгээ ҮГҮЙ); ККТТ шимтгэл 1% харилцагчаас.

---

## 6. Нээлттэй асуулт (ККТТ / ТЕГ-ээс тодруулах)

| # | Асуулт | Хэнээс | Хаагдах үе |
|---|---|---|---|
| T1 | eBarimt `payments[].code` — QPay-ийн албан код (`PAYMENT_CARD`? тусдаа код?) | ТЕГ PosAPI кодын жагсаалт | Фаз 1 |
| T2 | Quick QR нэхэмжлэхийн хугацаа (expiry) QPay талд байдаг уу, эсвэл Entry л `DELETE`-ээр хаах уу | ККТТ / Postman doc | Фаз 0 |
| T3 | Callback хэлбэр production-д (GET/POST, `qpay_payment_id`) — sandbox-д батлагдаагүй | Фаз 0 бодит төлбөр | Фаз 0 |
| T4 | Sub-merchant-д refund эрх (Merchant V2) авах боломж, нөхцөл | ККТТ мерчант менежер | 3c |
| T5 | ХСН гэрээ гарын үсэг зурагдсан эсэх (2024 загвар) — шимтгэлийн хувь, settlement хугацаа (T+0/T+1) | Хос Хас / ККТТ | Фаз 0 |
