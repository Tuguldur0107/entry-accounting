# Entry Accounting — CLAUDE.md

## Төслийн тойм

Монгол нягтлан бодох бүртгэлийн вэб программ. Одоогийн байдал болон төлөвлөгдсөн feature-үүд:

| Feature | Одоо | Төлөвлөгдсөн |
|---------|------|--------------|
| Ерөнхий журнал (GL) | ✅ | — |
| Draft → Post журнал | ✅ | — |
| Мөнгөн хөрөнгө (Cash) | ✅ | — |
| Авлага / Өглөг (AR/AP) + кредит нэхэмжлэл / дебит нэхэмжлэх (ENT-029) + ECL нөөц, найдваргүй авлага (ENT-065) | ✅ | eBarimt засвар (inactiveId), PO-той нэхэмжлэхийн дебит |
| Бараа материал (Inventory) | ✅ | — |
| Өртөг (Costing) | ✅ | — |
| Хангамж (Procurement — PO, хүлээн авалт, landed cost, дутуу хаалт ENT-064) | ✅ | хангамжийн тайлан, урьдчилгаа/LC, receipt type |
| Үндсэн хөрөнгө (FA) | ✅ | — |
| Period систем | ✅ | — |
| AI холболт — ChatGPT / Claude-д MCP-ээр (апп доторх чат 2026-09-25-нд хасагдсан) | ✅ | — |
| НӨАТ модуль | ✅ | — |
| Цалингийн модуль (Payroll) | ✅ | — |
| Сар хаалтын wizard | ✅ | — |
| Аудитын мөр (audit log) | ✅ | — |
| Банкны хуулгын автомат тулгалт | ✅ | — |
| `custom/` өргөтгөлийн давхарга (fork) | ✅ | seed script, манифест |
| REST API v1 (гадаад интеграци) | ✅ | — |
| Fork нэвтрүүлэлт: version + upstream sync | ✅ | — |
| POS (борлуулалтын цэг) — кассын дэлгэц, борлуулах үнэ, борлуулалт→АР→касс→бараа→өртөг, хөнгөлөлт, ээлж, тайлан, **eBarimt 3.0 автомат баримт**, **QPay Quick QR (нэг товчны холболт)** | ✅ | QPay пилот, камер barcode, B2B нэхэмжлэх |
| Мэдэгдлийн систем (in-app хонх, и-мэйл, Telegram, custom суваг, тохиргоо, AI tools) | ✅ фаз 0–2 | SSE realtime, web push (фаз 3) |
| Мэдлэгийн сан — IFRS/татвар/цалин/урсгал хэрэглэгчийн AI + MCP-д; SaaS багц бүрд үнэгүй, систем ашиглахгүй бол «AI нягтлан» (skills) захиалга | ✅ фаз 1–2 (агуулга хувийн `entry-knowledge` repo-д) | dedicated харилцагчид лицензээр sync |
| Төрийн системийн холболт — eTax (Цахим татварын систем, ITC), e-Balance (Цахим санхүүгийн тайлан, Сангийн яам) | 📋 бэлтгэл (`docs/integrations/`); ✅ `lib/itc/` scaffold (Keycloak нэвтрэлт, TPI parser, ДДТД тулгалт — ЦЭВЭР, тесттэй); ✅ e-Balance маягтын тайлан + Excel (`/gl/reports?report=ebalance`, `lib/reports/ebalance.ts` ЦЭВЭР, тесттэй, AI `get_ebalance_statements`) | НӨАТ тайлан илгээх, ТЕГ ↔ Entry тулгалт (TPI), e-Balance тодруулга / импорт спек |

## Файлын бүтэц

```
entry-accounting/
├── app/
│   ├── (auth)/login|register     # Нэвтрэх / бүртгүүлэх
│   ├── (dashboard)/
│   │   ├── layout.tsx            # Topbar + auth guard
│   │   ├── gl/
│   │   │   ├── journal/          # Журналын жагсаалт
│   │   │   ├── accounts/         # Дансны тохиргоо
│   │   │   └── reports/          # GL тайлан
│   │   ├── cash/rates/           # Валютын ханшийн түүх (татах + харах)
│   │   ├── procurement/          # Хангамж: самбар · orders · receipts · costs
│   │   └── inventory/pos, sales  # POS: кассын дэлгэц · борлуулалт/ээлж/тохиргоо
│   └── api/
│       ├── auth/[...nextauth]/   # NextAuth handler
│       └── attachments/          # Хавсралт: POST upload, GET [id] татах
├── components/gl/                # GL client components
├── components/procurement/       # Хангамжийн client components
├── components/pos/               # POS: checkout, payment-dialog, receipt, sales-page-view, sales-report-view
├── components/attachments/       # Хавсралтын жагсаалт (нийтлэг, ui-kit-ээр)
├── lib/
│   ├── auth.ts                   # NextAuth config
│   ├── actions/gl.ts             # Server Actions
│   ├── actions/auth.ts           # Register action
│   ├── actions/procurement.ts    # PO / хүлээн авалтын Server Actions
│   ├── actions/attachments.ts    # Хавсралт унших / устгах
│   ├── actions/exchange-rates.ts # Ханш татах / түүх унших Server Actions
│   ├── cash/exchange-rates.ts    # Ханш татагч + СУУРЬ ханш (getOfficialRateForDate)
│   ├── cash/rate-store.ts        # Ханшийн ТҮҮХ: өдрөөр upsert / унших (store-first)
│   ├── procurement/              # Цэвэр логик: constants, close-lines, po-math,
│   │                             #   types, load-data
│   ├── pos/                      # POS: constants, types, discounts, sale-math, payments,
│   │                             #   load-data, reports (§5c)
│   ├── ebarimt/                  # eBarimt 3.0: receipt (ЦЭВЭР), client, lookup,
│   │                             #   queue, worker, ticker (§5c)
│   ├── itc/                      # ITC (eTax / eBarimt TPI) холболтын scaffold: constants,
│   │                             #   auth (Keycloak, ЦЭВЭР), tpi (parser, ЦЭВЭР), client —
│   │                             #   docs/integrations/00 §4.3; eTax замууд спек ирмэгц
│   ├── qpay/                     # QPay Quick QR (dashboard-аар): constants, intent
│   │                             #   (ЦЭВЭР), readiness (ЦЭВЭР), client, store (§5c)
│   ├── actions/pos.ts            # POS Server Actions (createPosSale атомик, буцаалт, ээлж)
│   ├── attachments/constants.ts  # Хэмжээний хязгаар, төрлийн шошго
│   ├── notifications/            # Мэдэгдэл: catalog · rules (аудит гүүр) · attention
│   │                             #   (нүүр + scheduler НЭГ эх) · emit · scheduler · ticker
│   ├── db/schema.ts              # Drizzle schema
│   ├── db/index.ts               # DB connection
│   └── store/gl-store.ts         # Zustand UI state
├── custom/                       # ХАРИЛЦАГЧИЙН өргөтгөл (fork) — core энд бичихгүй
├── docs/deployment/              # Fork нэвтрүүлэлт, API, master data загвар
├── docs/dev/                     # Модуль бүрийн ХӨГЖҮҮЛЭЛТИЙН дүрмийн дэлгэрэнгүй
│                                 #   (энэ файлд хураангуй + холбоос л) — docs/dev/README.md
├── knowledge/                    # Зөвхөн 03-стандарт (дансны жагсаалт, mapping, UI spec)
│                                 #   01/02/04-skills → ХУВИЙН repo `entry-knowledge` (§9e)
├── .env.local                    # DATABASE_URL, AUTH_SECRET
└── drizzle.config.ts
```

## Технологи (одоогийн)

- **Next.js 16** App Router + TypeScript
- **PostgreSQL** on Railway — Drizzle ORM
- **NextAuth v5** (Credentials + JWT)
- **Tailwind CSS** + shadcn/ui (Base UI)
- **AG Grid Community v35** — бүх хүснэгтийн UI, `DataGrid` wrapper-ээр ([UI стандарт](docs/dev/ui.md))
- **Zustand** — UI state, grid undo/redo store (`lib/store/grid-store.ts`)
- Server Actions — mutations (createVoucher, deleteVoucher, createAccount…)

---

## ⚠️ UI стандартын зөрчил

`knowledge/03-стандарт/ui-standards/` файлууд нь хуучин **Chakra UI** spec.
Энэ төсөл shadcn/ui (Base UI) + AG Grid Community ашигладаг тул:

| Сэдэв | Knowledge файл | Энэ төсөлд |
|-------|----------------|-----------|
| Хүснэгт | `<StandardTable>` (Chakra) | AG Grid (`DataGridDynamic`) — нэгдсэн стандарт |
| Modal | `<Modal>` (Chakra) | shadcn `Dialog` |
| Дизайн | Dark mode + glassmorphism | Light + dark, `--ea-*` CSS токенууд |
| i18n | `t('key')`, 4 хэл | Зөвхөн монгол, hardcoded |

Нягтлан бодох логик, дансны код, IFRS/татварын дүрэм бүгд хамаарна.

---

## Гол дүрэм

- **Баримт хоёр түвшинтэй:** энэ файл (session бүрд ачаалагддаг) = хөндлөн дүрэм +
  модулийн ХАТУУ дүрмийн хураангуй; дэлгэрэнгүй нь `docs/dev/<модуль>.md`
  (`docs/dev/README.md`). Модулийн код хөндөхийн ӨМНӨ тэр файлыг уншина; шинэ
  дэлгэрэнгүйг ТЭНД бичнэ, хатуу дүрэм өөрчлөгдвөл энд ч ХАМТ шинэчилнэ
- **Server Component by default:** Data fetch нь page.tsx дотор, mutation нь `lib/actions/` Server Action-аар
- **Client Component:** `"use client"` зөвхөн state/event handler шаардагдах үед
- **Монгол хэл:** UI текст бүгд монголоор
- **Server action алдааг THROW ХИЙХГҮЙ** — client component-оос дуудагддаг
  action нь алдаагаа `{ error }` УТГААР буцаана (`lib/action-result.ts`-ийн
  `actionError`). Next.js PRODUCTION дээр шидсэн алдааны мессежийг далдалж
  React #441 «An error occurred in the Server Components render…» болгодог
  тул хэрэглэгч монгол тайлбарын оронд ойлгомжгүй код хардаг.
  `tests/action-result.test.ts` энэ дүрмийг АВТОМАТААР сахиулна: хамгаалалтгүй
  action нэмэгдвэл тест УНАНА. Онцгой тохиолдол нь өөрийн `{ ok, code }` үр
  дүнгийн хэв маягтай панелийн loader-ууд (тестийн KNOWN_UNGUARDED-д ил
  бүртгэлтэй). Server талын дуудагч (lib/ai/tools.ts) `unwrapAction`-оор
  шидэлтээ хадгална.
- **Нэмэх модулиуд:** periods/, vat/, payroll/ — тус бүрийн үед `app/(dashboard)/` доор нэмнэ
- **Гишүүний эрх — ХОЁР давхарга** (`lib/permissions.ts` цэвэр, `lib/auth.ts` DB):
  - **Route guard:** модулийн хавтас бүрийн `layout.tsx`-д
    `<ModuleGuard moduleKeys="…">` (`components/layout/access-guard.tsx`) —
    эрх «Байхгүй» (none) гишүүнд URL-ээр ч нээгдэхгүй; admin+ хуудас
    (`/admin/*`, `/settings/permissions`) `<RoleGuard minRole="admin">`.
    `tests/module-route-guards.test.ts` хавтас бүрд guard байгааг статикаар
    шалгана — шинэ модулийн хавтас нэмбэл тестийн `EXPECTED`-д бүртгэнэ.
    POS нь Бараа материалын дотор боловч `pos` түлхүүрээр тусдаа (кассчин
    `inv`-гүй байж болно): `inventory/layout` inv|pos, дэд хавтас бүр өөрийнхөө
  - **Action guard:** бичилт/батлах `requireModuleAction(key, "write"|"post")`,
    УНШИЛТЫН loader (панелийн өгөгдөл, тайлан, API route) мөн
    `requireModuleAction(key, "read")` — `getActiveOrg()` дангаараа эрх
    шалгадаггүй (зөвхөн scope). Хоёр модулийн аль нэг нь хүрэлцэх бол
    `requireAnyModuleAction`. Лавлах өгөгдөл (сегмент, период, ханш) шалгалтгүй
  - **Байгууллага устгах = ЗӨВХӨН `purgeOrganization`** (`lib/org/purge.ts`):
    46 FK `RESTRICT` тул `delete from organizations` cascade дундаас гацдаг
    (цалин/POS/PO/төлбөртэй байгууллага). Гүйлгээний хүснэгтүүдийг ИЛ дараалал
    `ORG_PURGE_ORDER` (`lib/org/purge-order.ts`)-аар устгаад үлдсэнийг cascade,
    НЭГ транзакцаар. Шинэ RESTRICT/NO ACTION FK нэмбэл `tests/org-purge.test.ts`
    (DB каталогоор) унаж дараалалд бүртгэхийг шаардана. `db.delete(organizations)`
    шууд дуудахгүй
  - **Урилга** (`org_invitations`) 7 хоног хүчинтэй (`expiresAt`,
    `ORG_INVITATION_TTL_DAYS`); дахин урихад token + хугацаа шинэчлэгдэнэ;
    урилгын ЛИНК зөвхөн admin+ хардаг (`getOrgSettingsData`). Байгууллага/
    гишүүн/урилгын үйлдэл бүр `logAuditEvent` (`organization` / `membership` /
    `invitation`) — байгууллага устгах нь cascade тул зөвхөн сервер лог
- **Deployment-ийн ХОЁР горим — хольж хутгахгүй** (`lib/deployment-mode.ts`,
  env `ENTRY_DEPLOYMENT_MODE`):
  - `saas` — Entry-ийн ҮНДСЭН сервис (Railway `entry-accounting`): олон
    байгууллага нэг DB-д, **бүртгэл үргэлж нээлттэй** (шинэ харилцагч бүр
    өөрөө бүртгүүлж өөрийн tenant-аа үүсгэнэ), и-мэйл баталгаажуулалт бодитой
  - `dedicated` (default, env байхгүй үед) — эх код авсан харилцагчийн тусдаа
    сервис + тусдаа DB: эхний хэрэглэгч чөлөөтэй, дараа нь зөвхөн урилгаар
    (`lib/registration.ts`); `ENTRY_OPEN_REGISTRATION=1` демод дардаг
  - Өгөгдлийн тусгаарлалт (`organizationId`) хоёр горимд ИЖИЛ; горим зөвхөн
    бүртгэл/баталгаажуулалтын зан төлөвт. `/api/health` ба `/settings/system`
    горимоо ил харуулна. Тест `tests/deployment-mode.test.ts`
- **Billing / entitlement** (`docs/billing/00-proposal.md` + `docs/dev/platform.md` —
  ЗААВАЛ уншина; `lib/billing/`): шалгах цэг ЗӨВХӨН `guards.ts`, код даяар
  `if plan === …` ХОРИОТОЙ. **Нягтлан бодох ажлыг дунд нь блоклохгүй** — унших,
  тайлан, экспорт, сар хаах үргэлж. Үнэ огноотой ГУРВАН давхарга (`pricing.ts`),
  `null` = тогтоогоогүй (0₮ БИШ, таамаглахгүй). **Багц ба үнэ засах нь апп дотор
  БАЙХГҮЙ** — зөвхөн Entry Console `/api/platform/*` (Bearer, saas-only); апп дотор
  platform admin эрх ҮҮСГЭХГҮЙ. QPay-ээр өөрөө төлөх (§6a) — мөнгө хэзээ ч
  алдагдахгүй. Туршилтын funnel `GET /api/platform/trial-funnel`
- **Дэмжлэгийн хандалт** (`docs/deployment/support-access.md` + `docs/dev/platform.md`):
  эрх СЕССЭД уягдана, линкийг ЗӨВХӨН Console олгоно, `owner` ХЭЗЭЭ Ч олгогдохгүй,
  MCP/REST token-ий замд хэрэглэхгүй; орох/гарах бүр аудит + instant мэдэгдэл —
  ХЭЗЭЭ Ч чимээгүй болохгүй
- **Нууц үг сэргээх, и-мэйл баталгаажуулалт** (`docs/dev/platform.md`): token DB-д
  sha256 hash, нэг удаагийн, хугацаатай; баталгаажуулалт нэвтрэлтийг ХЭЗЭЭ Ч хаахгүй;
  сэргээх хүсэлт хаяг байгаа эсэхийг задлахгүй
- ⚠️ **Client/server хил: `"use client"` component нь `@/lib/db` татдаг модулийг
  import хийж БОЛОХГҮЙ.** Төрөл нь зөв байсан ч bundler `Can't resolve 'fs' /
  'net' / 'tls'` гэж `next build`-ийг унагаана (postgres драйвер browser
  bundle-д орно). **`tsc` энэ алдааг ТАНИХГҮЙ** — 2026-09-19-нд яг ийм алдаа
  CI-г давж production-ийн 3 deploy дараалан унасан.
  **Хэв маяг:** цэвэр логик/төрлийг DB импортгүй тусдаа модульд гаргаж
  (`lib/gl/journal-list-types.ts`, `lib/pos/report-math.ts`), DB-тэй файл нь
  `export *`-ээр дахин гаргана — server талын дуудагчид хөндөгдөхгүй.
  CI-д `next build` алхам ЭНЭ ангиллыг барина (`.github/workflows/ci.yml`)

---

## Нягтлан бодох стандарт

### 1. Журналын баланс (journal-balance guardrail)

```
abs(ΣДебет − ΣКредит) ≤ 0.01   → тэнцсэн
ΣДебет = 0                       → хоосон, хориотой
Мөр бүрд дебет ЭСВЭЛ кредит    → хоёулаа зэрэг байж болохгүй
Мөр бүрийн дүн ≥ 0
```

Тэнцээгүй бол "Хадгалах" товч идэвхгүй — **одоогийн кодонд хэрэгжсэн**.

### 2. Draft → Post журнал — ХЭРЭГЖСЭН

Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md`

```
Draft үүсгэх → хэрэглэгч шалгана → Post дарах → хадгалагдана
  ↑ засвал draft руу буцна
```

- Draft статустай журнал нь period close-д ороогүй байна
- Post хийхэд journal_balance guardrail заавал давна
- `adjustment_type`: `regular` | `prior_period` | `closing` | `reversing` | `fx_reval` | `accrual`

### 2a–2c. Журналын дугаар, валют, хяналтын данс — ХЭРЭГЖСЭН

Дэлгэрэнгүй: `docs/dev/gl.md` — журналын код хөндөхийн ӨМНӨ уншина.

- **Дугаар** `<МОДУЛЬ>-<YY>-<NNNNNN>` (`lib/gl/voucher-no.ts`); модулийн кодыг
  ӨӨРЧЛӨХГҮЙ; тоолуур АТОМИК (`select max(...) + 1` ХОРИОТОЙ); буцаалт эх
  модулиа өвлөнө. **Шинэ бичилтийн зам `journalVouchers`-д insert хийх бүрд
  `documentNo: await nextVoucherNo(tx, orgId, "<модуль>", <огноо>)` ЗААВАЛ**
- **Валют (IAS 21):** баримтад НЭГ валют, НЭГ ханш; MNT-г гараар бичихгүй —
  сервер дахин бодно (`resolveVoucherCurrency`); тэнцэл валютаар; ханш ЗОХИОХГҮЙ
- **Батлагдсан журнал УСТГАГДАХГҮЙ** (буцаалтаар); хяналтын дансанд гар журнал
  `control_account_guard` warn|block — AI сулруулж чадахгүй; нээлтийн журнал дэд
  дэвтрийн толин баримт үүсгэхгүй

### 3. Дансны бүлгийн бүтэц (8 оронтой код)

Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md`

| Бүлэг | Код | Жишээ |
|-------|-----|-------|
| Эргэлтийн хөрөнгө | 1XXXXXXX | `11210000` Касс, `11000001` Банк |
| Эргэлтийн бус хөрөнгө | 2XXXXXXX | `21010000` Үндсэн хөрөнгө |
| Өр төлбөр | 3XXXXXXX | `31000001` AP, `31410000` НӨАТ өглөг |
| Эздийн өмч | 4XXXXXXX | `41100000` Эздийн өмч, `44000001` Хуримтлагдсан ашиг |
| Орлого | 5XXXXXXX | `51100000` Борлуулалтын орлого |
| COGS | 6XXXXXXX | `61100000` COGS |
| Үйл ажиллагааны зардал | 7XXXXXXX | `72100000` Цалингийн зардал |
| Санхүүгийн зардал | 8XXXXXXX | `87100001` Хүүгийн зардал |

### 3a. Сегментийн стандарт утга + компанийн автомат сегмент

Дэлгэрэнгүй: `docs/dev/gl.md`. Стандарт утга татахад байгаа КОДЫГ ХӨНДӨХГҮЙ;
S1/S6 нь `organizations`-оос АВТОМАТ — код нэг удаа хуваарилагдаж ХЭЗЭЭ Ч
өөрчлөгдөхгүй, гарсан компанийн утга устахгүй; S6 posting-ийн автомат default
болохгүй (`canAutoDefaultSegment`).

### 4. Period систем — ХЭРЭГЖСЭН

Дэлгэрэнгүй: `docs/dev/periods.md` (топбарын шүүлтүүр, snapshot + delta, хаалтын
дараалал). Код: `lib/periods/`. Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md`

- Период = хуанлийн сар `YYYY-MM`; **бүртгэгдээгүй сар = НЭЭЛТТЭЙ**; хаагдсан
  периодод бичилт хориотой
- **Шинэ бичилтийн зам нэмэхэд `assertPeriodOpen` + транзакц дотор
  `assertPeriodOpenInTx` ЗААВАЛ**; буцаалт ЭХ огноогоор (тэр периодыг шалгана)
- Ноорог үлдсэн сарыг хаахгүй; өмнөх сар нээлттэй бол хаахгүй, зөвхөн сүүлийн
  хаалттай үеийг дахин нээнэ
- Огноо (`lib/periods/document-date.ts`): хуанлид байхгүй огноо татгалзана;
  ирээдүйн САРЫН огноо батлагдахгүй; шинэ баримтын анхдагч огноо
  `currentDocumentDate()` — `new Date().toISOString()`-оор баримтын огноо ӨГӨХИЙГ ХОРИГЛОНО
- Огноо-шүүлттэй шинэ хуудас: URL параметр → байхгүй бол `getPeriodSelection()`
- Урт хугацааны үлдэгдлийг snapshot + delta-аар (`loadBalanceRowsFast` г.м.) —
  баримтыг JS-д ачаалахгүй
- Year-end: `Dr 51100000 → Cr 44000099`, `Dr 44000099 → Cr 6/7/8XXXXXXX`,
  `Dr 44000099 net → Cr 44000001`
- Татварын хуваарь: НӨАТ дараа сарын 10, НДШ дараа сарын 5, ААНОАТ улирлын дараа сарын 20

### 5. Өртгийн бүртгэл (Costing) — ХЭРЭГЖСЭН

**ЗААВАЛ уншина:** `docs/cost/` (README → 01…04 → CLAUDE.md), `docs/dev/costing.md`.

- **Зөвхөн Periodic Weighted Average** — FIFO/LIFO/moving average/standard ХОРИОТОЙ;
  хамрах хүрээ бараа × агуулах × компани; период = GL-ийн сар
- Дансны дугаар кодод хатуу бичихгүй — `costing_account_settings` /
  `costing_item_settings`; зарлагын төрөл, бүрэлдэхүүн нь хэрэглэгчийн лавлах
- **Үнэ ХЭЗЭЭ Ч зохиохгүй** — өртөггүй / сөрөг үлдэгдэлд тэр бараа-агуулах-сар
  ЗОГСОЖ шалтгаан UI-д харагдана
- Нэг үнэлгээний суурь `cost_period_results` — GL-ээс өртөг бодохгүй
- Нээлттэй шийдвэрийг код, migration, default, fallback дансанд НУУХГҮЙ —
  product owner-оос асууна

### 5a. Хангамж (Procurement — PO + landed cost) — ХЭРЭГЖСЭН

**ЗААВАЛ уншина:** `docs/procurement/00-proposal.md` → `01-implementation-contract.md`
(функцийн нэр/параметр зөрөхгүй), `docs/dev/procurement.md`; шийдвэр `docs/cost/README.md` 0.6.

- PO = НЭГ бизнес объект, хоёр түр данс; бүх бичилт `businessObjectType:
  "purchase_order"` + ID-тай (бичих мөчид)
- Бараа ХҮЛЭЭН АВСАН ӨДРИЙН Монголбанкны албан ханшаар; зөрүү PO хаалтад ханшийн
  олз/гарз болно (өртөгт шингэхгүй); ханш ЗОХИОХГҮЙ
- Данс кодод хатуу бичихгүй (тохиргооны роль); `po_receipt` хөдөлгөөнийг бараа
  материалын модулиас засах/устгахгүй
- Хаалтын нөхцөл `poCloseBlockers` — зөрүүг АВТОМАТААР нөхөхгүй; дутуу хаалтад
  шалтгаан + зардлын дансыг хэрэглэгч ИЛ сонгоно
- Сар хаалт хүлээн авалттай нээлттэй PO-той бол хориглогдоно (`open_po_close_mode`)

### 5c. POS, eBarimt, QPay (Бараа материалын дотор) — ХЭРЭГЖСЭН

**ЗААВАЛ уншина:** `docs/dev/pos.md` (урсгал, файлын жагсаалт, бүх дүрэм);
POS `docs/pos/00-proposal.md` → `01-implementation-contract.md` (функцийн
нэр/параметр зөрөхгүй), шийдвэр `docs/cost/README.md` 0.8; eBarimt
`docs/pos/03-ebarimt-integration-plan.md` + `docs/deployment/ebarimt.md`; QPay
`docs/pos/04-qpay-integration-plan.md` + `docs/deployment/qpay.md`.

**POS**
- Борлуулалт = НЭГ транзакц (`createPosSale`): АР нэхэмжлэх + зарлага + урьдчилсан
  COGS (явцын дундаж, moving average БИШ) + төлбөр; сар хаалт залруулна (`cogs_true_up`)
- `[POS_SOURCED]`: POS-оос үүссэн АР/касс/хөдөлгөөн/өртгийг эх модулиас засах/устгах
  ХОРИОТОЙ — ЗӨВХӨН `returnPosSale`
- Үнэ, өртөг, данс ЗОХИОХГҮЙ — дансууд `pos_settings` рольууд; касс үнэ засахгүй
  (буулгах нь хөнгөлөлтөөр, зөвшөөрөл шаардвал `pos:post`; AI-д ИЛ `managerApproval`)
- НӨАТ `vat_settings.isVatPayer`-ээс; НХАТ-ын хувь байгууллага ӨӨРӨӨ бичнэ
  (`cityTaxPercent`, кодод хуулийн тоо БАЙХГҮЙ), зөвхөн `cityTaxable` бараанд
- Хасах үлдэгдэл тохиргоогоор (шинэ байгууллагад ХААЛТТАЙ); огноо серверийн УБ цагаар,
  `assertPeriodOpen` + `assertPeriodOpenInTx`

**eBarimt 3.0**
- Борлуулалт илгээлтээс болж ХЭЗЭЭ Ч зогсохгүй (commit-ийн ДАРАА async дараалал)
- Код (ангилал, татварын бүтээгдэхүүн, төлбөрийн хэлбэр, дүүрэг, ТТД) ЗОХИОХГҮЙ — дутвал
  ил алдаа; сугалаа ба QR ХЭЗЭЭ Ч ХАДГАЛАХГҮЙ
- Хэсэгчилсэн буцаалт = `inactiveId` гинж, DELETE зөвхөн бүтэн буцаалт; `sent` ДДТД-г
  гараар засахгүй; НӨАТ төлөгч БУС байгууллага ч баримт олгоно (`NOT_VAT`)
- Операторын нууц header ЗӨВХӨН allowlist-ийн хост руу; иргэний РД-аар лавлахгүй

**QPay Quick QR**
- Entry QPay-тэй ШУУД харьцахгүй — `qpay-dashboard` REST-ээр; QPay-г polling ХИЙХГҮЙ
- Intent машин ЦЭВЭР, `markIntentPaid` идемпотент; дүн зөрвөл `failed` — төлбөр ЗОХИОХГҮЙ;
  төлөгдсөн ч борлуулалт болоогүй intent ХЭЗЭЭ Ч чимээгүй үлдэхгүй
- Нууц (API key, webhook secret) шифртэй, УТГА нь лог/аудит/health-д ХЭЗЭЭ Ч гарахгүй
- Raw `sql`-д Date объект ШУУД параметр болохгүй (`tests/sql-date-params.test.ts`)

### 5b. Валютын ханшийн түүх (Монголбанк) — ХЭРЭГЖСЭН

Дэлгэрэнгүй: `docs/dev/exchange-rates.md`.

- Монголбанкны албан ханш = системийн СУУРЬ ханш (арилжааны банкных зөвхөн төлбөрт)
- Ханшийн уншилт бүр `getOfficialRateForDate` (store-first) — модуль дотроос МБ-ыг
  `fetch`-ээр дуудахгүй
- **ХАНШ ХЭЗЭЭ Ч ЗОХИОГДОХГҮЙ** — ≤10 хоногийн нөөц ханш ИЛ тэмдэглэгдэнэ, эс
  бөгөөс ШИДНЭ, хэрэглэгч гараар оруулна
- `lib/cash/exchange-rates.ts` `@/lib/db`-г import ХИЙХГҮЙ (client bundle)
- `exchange_rates` нийтийн лавлах (organizationId-гүй, unique INDEX); FX
  тэгшитгэл хэрэглэгчийн сонгосон огноо + ханшийн баримттай хадгалагдана

### 5d–5e. Кредит нэхэмжлэл / дебит нэхэмжлэх, ECL нөөц — ХЭРЭГЖСЭН

Дэлгэрэнгүй: `docs/dev/arap.md`; шийдвэр `docs/product/2026-09-audit-followup-proposal.md` §3–§4.

- Нэхэмжлэхийн буцаалт = тусдаа баримт (дүн эерэг, эх нэхэмжлэх/мөртэй) — сөрөг
  мөртэй нэхэмжлэх ХЭРЭГЛЭХГҮЙ
- Төрлөөс хамаарах шийдвэр ЗӨВХӨН `lib/arap/document-kind.ts` — `=== "ar_invoice"
  ? … : …` хоёр салаат шалгалт ШИНЭ КОДОД ХОРИОТОЙ
- Буцаах дүн эх мөрийн үлдэгдлээс хэтрэхгүй (батлахад дахин шалгана), эх валют,
  ханшаар
- ECL (IFRS 9): дансууд роль (`arap_ecl_settings`), сарын журнал ЗААВАЛ ноорог,
  ААНОАТ-ын хувь ЗОХИОХГҮЙ; хасалтад шалтгаан заавал, нөөц ХЭЗЭЭ Ч Дт болохгүй

### 6. НӨАТ (VAT) — 10% — ХЭРЭГЖСЭН

Дэлгэрэнгүй: `docs/dev/vat.md`. Knowledge: `entry-knowledge/01-онол-хууль-стандарт/tax/vat.md`

```
Exclusive: Авлага = Нийт, Орлого = Нийт/1.1, НӨАТ өглөг = Нийт × 10/110
Борлуулалт: Dr 13110000 Авлага / Cr 51100000 Орлого + Cr 31410000 НӨАТ өглөг
Худалдан авалт: Dr Зардал + Dr 13620000 НӨАТ авсан / Cr 31000001 AP
Тооцоо: Dr 31410000 / Cr 13620000 / Cr 11000001 Банк (зөрүү)
```

- Дансууд `vat_settings`-ээс — кодод хатуу дугаар байхгүй
- Тооцооны журнал ЗААВАЛ ноорог, сард нэг, огноо = тайлант үеийн сүүлийн өдөр
- Тайлан + төлбөр дараа сарын **10-нд**, хоцорвол 0.1%/хоног

### 7. Цалин (Payroll) — Gross → Net — ХЭРЭГЖСЭН

Дэлгэрэнгүй: `docs/dev/payroll.md` (нэмэгдэл, НДШ, урьдчилгаа/сүүл, цалингийн хуудас).
Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/`

- Дансууд, доод цалин, НДШ cap, татваргүй босго, коэффициент `payroll_settings`-ээс —
  кодод хатуу тоо байхгүй; коэффициент хуулийн доод хэмжээнээс ДООШ орохгүй
- НДШ: ажилтан 11.5%, ажил олгогч `employees.employerSiPercent`; cap = доод цалин × 10;
  ХАОАТ огноогоор (effective date)
- Нэмэгдэл цаг/хоногоос АВТОМАТ бодогдоно; гар засвар (`*Manual`) ХЭЗЭЭ Ч дарагдахгүй
- ХЧТА-ийн хувь ЗОХИОХГҮЙ; ХЧТА нь НДШ, ХАОАТ-ын сууринд ОРОХГҮЙ
- GL журнал ЗААВАЛ ноорог, сард нэг (`payroll:YYYY-MM`)
- Цалингийн хуудсын и-мэйл: журнал батлагдсан үед л, гарчиг/биед ДҮН БИЧИХГҮЙ

### 7a. Үндсэн хөрөнгийн элэгдэл — САНХҮҮ + ТАТВАР зэрэг

Дэлгэрэнгүй: `docs/dev/fixed-assets.md`. Код: `lib/fa/`.

- Санхүүгийн (IAS 16 — GL-д) ба татварын (ААНОАТ — мэмо) элэгдэл ЗЭРЭГ, тусдаа
  хуримтлагдана; татварын хугацааг кодод ЗОХИОХГҮЙ
- Сарын бүх элэгдэл НЭГ журнал; дахин бодоход өмнөхийг автоматаар буцаана
- Нээлтийн хуримтлагдсан элэгдэл картад (`openingAsOf` заавал); ашиглалтын
  хугацаа дуусмагц элэгдэл ЗОГСОНО

### 8. Domain separation (guardrail)

- **IFRS treatment ≠ Татварын treatment** — ялгааг тодорхой тусгана
- **Цалингийн ХАОАТ ≠ Бизнесийн WHT** — андуурахгүй
- **Элэгдэл:** IAS 16 (дансны) vs татварын хуулийн хувь зөрүү → IAS 12 DTA/DTL

### 9. Human-in-the-loop (draft-first policy)

Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/human-in-the-loop.md`

- AI agent бичилт default-оор **ноорог** үүсгэнэ — хэрэглэгч баталгаажуулна
- Хэрэглэгч чатнаас "Шууд бичих" горим ИЛ сонгосон үед л тэнцсэн, **батлах
  хязгаарын дотор** бичилт шууд батлагдана
- Том дүн (хязгаараас их), period хаалт, payroll post → нягтланч
  баталгаажуулалт шаарддаг — post горимд ч ноорог үлдэнэ

**Батлах хязгаар нь БАЙГУУЛЛАГААР тохируулагдана** (`company_settings.
aiPostLimitMnt`, null = default 10 сая ₮) — Тохиргоо → Компанийн мэдээлэл:

```
lib/ai/post-limit.ts   ЦЭВЭР (тесттэй): DEFAULT_AI_POST_LIMIT_MNT (10M),
                       resolveAiPostLimit, planAiPostLimitChange (tool-оор
                       ӨСГӨЛТ [HUMAN_REQUIRED])
                       + AsyncLocalStorage (runWithAiPostLimit / currentAiPostLimit)
tests/ai-post-limit.test.ts  өсгөлтийн хориг, бууруулалт, default сэргээлт, зэрэгцээ хүсэлт
```

- **Хязгаарыг хүсэлт бүрд НЭГ л удаа уншина** — `executeAiTool` нь
  `runWithAiPostLimit`-ээр контекстод тавьж, гүн дэх `assertPostLimit` (22
  дуудах цэг) `currentAiPostLimit()`-ээр SYNC хэвээр уншина. Контекстгүй
  дуудагдвал default (хамгийн болгоомжтой); зэрэгцээ хүсэлтүүд бие биенийхээ
  утгыг ХАРАХГҮЙ (AsyncLocalStorage, module-level хувьсагч ХОРИОТОЙ)
- **AI өөрийн хязгаарыг ХЯЗГААРГҮЙ өсгөж чадахгүй** (SIM ENT-068 — симуляцид
  агент PO хаах гацааг тойрохын тулд лимитээ 50 сая болгосон; prompt
  injection-ийн зам ч болно). `update_company_settings`-ийн `aiPostLimitMnt`
  нь `planAiPostLimitChange({viaTool:true})`-ээр дайрна: өсгөлт
  `AI_POST_LIMIT_TOOL_MAX_MNT` (**1 тэрбум ₮**) хүртэл зөвшөөрөгдөнө, түүнээс
  дээш `[HUMAN_REQUIRED]` — зөвхөн ВЭБЭЭС админ хүн. **БУУРУУЛАХ / default
  руу буцаах чөлөөтэй.** Таазыг өөрчилбөл UI-ийн тайлбар
  (`components/settings/organization-profile-form.tsx`) ба tool description
  хамт шинэчилнэ
- Өөрчлөлт бүр `logAuditEvent` (`settings` / `ai_post_limit`) + эзэн/админд
  `settings.ai_limit_changed` мэдэгдэл (instant и-мэйл)
- `lib/payroll/calc.ts`-ийн `{ upTo: 10_000_000 }` нь ХАОАТ-ын шатлалын хил
  (ХУУЛИЙН тоо) — үүнтэй хольж тохируулга болгохыг ХОРИГЛОНО

### 9a–9b. AI tool давхарга, MCP сервер — ХЭРЭГЖСЭН

Дэлгэрэнгүй: `docs/dev/ai-mcp.md` (tool бүлгийн хүснэгт, OAuth, анхны туршилт).

- **Апп доторх чат / серверийн AI ХАСАГДСАН** — буцааж нэмэхийг ХОРИГЛОНО; Entry
  сервер AI-ийн API дуудахгүй, хэрэглэгч өөрийн ChatGPT / Claude-оос MCP-ээр
- MCP ба REST НЭГ tool давхарга (`lib/ai/tools.ts`) — тусдаа логик ХОРИОТОЙ;
  шинэ consumer `aiToolsForSurface(<зам>)`
- Tool executor алдаа ШИДЭХГҮЙ (`[CODE] текст`); нэрээр олдохгүй / олон таарвал
  таамаглахгүй; `externalRef`-ээр idempotent
- Бичилт ноорог-first + батлах хязгаар (§9); бичилтийн горим `ai_settings.write_mode`
- Бүх нууц (OAuth code/access/refresh, PAT) зөвхөн sha256 hash
- Анхны туршилтын карт, `STARTER_PROMPTS` НЭГ эх (`lib/onboarding/first-run.ts`);
  демо компани картад БАЙХГҮЙ

### 9c. Fork нэвтрүүлэлт, custom/ өргөтгөл, REST API

Дэлгэрэнгүй: `docs/dev/fork-custom.md`, `docs/deployment/README.md`, `custom/CLAUDE.md`.

- Харилцагч = GitHub fork; core `custom/`-д ХЭЗЭЭ Ч бичихгүй, core custom багцын
  нэр/зам hardcode хийхгүй
- Hook байгаа хоригийг сулруулж ЧАДАХГҮЙ; fork `package.json`-д гар хүрэхгүй
  (`custom/predeploy.mjs`); template repo ХОРИОТОЙ
- REST API v1 нь tool давхаргаар л — тусдаа логик ХОРИОТОЙ

### 9d. Мэдэгдлийн систем (Notifications) — фаз 0–2 ХЭРЭГЖСЭН

Дэлгэрэнгүй: `docs/dev/notifications.md`; шийдвэр `docs/notifications/00-proposal.md`.

- Call site-д `emit` ГАР дуудахгүй — `logAuditEvent` + `rules.ts`-ийн дүрэм
- Анхаарлын/хугацааны дүрэм ЗӨВХӨН `attention.ts`-д (нүүр + scheduler НЭГ эх)
- Мэдэгдэл ХЭЗЭЭ Ч шидэхгүй; `dedupeKey` ЗААВАЛ; actor өөртөө мэдэгдэхгүй (ил
  бүртгэсэн 2 үл хамаарахаас бусад)
- Scheduler request scope-гүй (`cookies()` / `getActiveOrg()` дуудахгүй); и-мэйлийн
  гарчигт ДҮН БИЧИХГҮЙ

### 9e. Мэдлэгийн сан — хэрэглэгчид хүргэх (Фаз 1–2 ХЭРЭГЖСЭН)

Дэлгэрэнгүй: `docs/dev/knowledge.md`; шийдвэр `docs/knowledge/00-proposal.md`.

- Агуулга ХУВИЙН `Tuguldur0107/entry-knowledge` repo-д; production-ийг ЗӨВХӨН
  Railway `knowledge-sync` бичнэ — `entry-accounting`-д `KNOWLEDGE_REPO*` env ТАВИХГҮЙ;
  parser хоёр repo-д ИЖИЛ хуулбар
- Хандалт ЗӨВХӨН багцын `knowledge` боломжоор; `skills` багцад нягтлан бодох систем
  хаалттай — шинэ tool-ыг нээх эсэхийг ЗӨВХӨН `ACCOUNTING_FREE_TOOLS`-оор шийднэ
- Хэсгээр л (бүгдийг буцаах зам НЭМЭХГҮЙ), `surfaces: ["mcp"]`, квот DB-ээс

### 10. Effective date (татвар/цалины тооцоололд)

Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/effective-date.md`

- Татварын хувь, НДШ, ХАОАТ bracket-ийг **огноогоор** lookup хийнэ
- Хамаарах огноогүй тооцоолол хийхгүй — хэрэглэгчээс асууна

---

## UI, хүснэгт, Excel стандарт

**UI хөндөхийн ӨМНӨ ЗААВАЛ уншина:** `docs/dev/ui.md` (токен, панель, төлөв,
тайлангийн стандарт, AG Grid, товчлол, Excel, surface inventory).

- Өнгө/сүүдэр/радиус ЗӨВХӨН `ui-kit/tokens.css` — component дотор hex/rgba
  ХОРИОТОЙ; семантик ТЕКСТЭД `--ea-*-fg`
- Хүснэгт бүр AG Grid `DataGridDynamic` — `<table>` / custom grid ХОРИОТОЙ;
  column kind ЗӨВХӨН `lib/grid/columnTypes.ts`
- Жагсаалтаас панель ДАВХАР даралтаар; мөрийн өндрийн эзэн НЭГ (`getRowHeight` ба
  `autoHeight` хамт ХОРИОТОЙ)
- Таб/chip `components/ui/tabs.tsx`, форм `components/ui/form-field.tsx`, төлөв
  `lib/status.ts`, панель `components/panel/floating-panel.tsx` — өөрийн хувилбар
  бичихгүй; панельд хавсралт НЭГ мөр
- **Тайлан:** солих нь ЗӨВХӨН топбарын сонгогч (`lib/constants/report-registry.ts`),
  огноо ЗӨВХӨН топбарын период, жааз `components/reports/report-layout.tsx`, хөл дүнтэй
- Сегмент: editor бүр бүтэн 10-part код, paste/Excel/AI бүгд `normalizePastedAccount`
- Excel: багана НЭРЭЭР, зөвхөн зөв мөр орно, загвар спекээс, багц журнал НООРОГ
- Client-ээс DB руу шууд хандахгүй — mutation бүр Server Action-аар
- Статик тестүүд: `report-standard`, `grid-row-height`, `ui-latin-text`, `hotkeys`

---

## DB өгөгдлийн бүтэц (Drizzle / PostgreSQL)

Өгөгдөл `organizationId`-аар тусгаарлагдана (`userId` = үүсгэсэн хэрэглэгч).
Нийтийн лавлах (organizationId-гүй): `exchange_rates`, `platform_plan_prices`,
`knowledge_articles`. Бүлэг тус бүрийн хүснэгт, баганын тайлбар:
`docs/dev/db-schema.md`; эх нь `lib/db/schema.ts`.

Migration: `npx drizzle-kit generate` → `npx drizzle-kit push`

⚠️ `drizzle-kit push` нь одоо байгаа DB-тэй diff хийдэг. Урьд нь шууд SQL-ээр
хэрэгжүүлсэн хүснэгтүүд бий тул generate-ийн гаргасан файл бүхэлдээ
ажиллуулбал "already exists" гэж унана — шинэ DDL-ийг л хэрэглэнэ.

⚠️ **`db:push` нь `--force`-той (deploy-ийн preDeploy энийг дууддаг).** Энгийн
`drizzle-kit push` нь unique constraint нэмэх, багана хасах зэрэг "data loss"
өөрчлөлт дээр ИНТЕРАКТИВ асуулт тавьдаг — Railway-ийн non-TTY preDeploy дээр
crash хийж, схемийн БҮХ өөрчлөлт DB-д ОГТ ОРОХГҮЙ үлддэг (дараа нь код шинэ
баганыг асуухад "column does not exist" 500 алдаа өгнө). `--force` бүх
өөрчлөлтийг автоматаар зөвшөөрнө — **гэхдээ хүснэгт truncate хийж болзошгүй**
(одоо байгаа мөр дээр unique constraint нэмэх г.м.). Railway нөөцлөлт
(DAILY/WEEKLY) идэвхтэй байх ЁСТОЙ. Бодит production өгөгдөлтэй GA-д
`drizzle-kit generate` + `migrate` (батлагдсан migration файл) руу шилжинэ —
push нь dev/pilot-д зориулагдсан.

⚠️ **Схемээс хүснэгт эсвэл багана ХАСАХ бүрд
`scripts/lib/removed-schema-objects.mjs`-д бүртгэнэ.** drizzle-kit-ийн push нь
diff-д УСТГАГДАХ ба ҮҮСЭХ объект ЗЭРЭГ байвал «нэр солигдсон уу?» гэж
ИНТЕРАКТИВ асуудаг (`tablesResolver` / `columnsResolver`) — `--force` үүнийг
ХАМРАХГҮЙ (тэр нь зөвхөн өгөгдөл алдах statement-ийг зөвшөөрнө). Railway-ийн
non-TTY preDeploy дээр `Interactive prompts require a TTY terminal` гэж унаж,
схемийн БҮХ өөрчлөлт DB-д ОРОХГҮЙ үлддэг. 2026-09-19: v1.5.0 нь 8 хүснэгт
хасаж 15 нэмсэн тул v1.4.0-ийн DB-тэй харилцагчийн deploy яг ингэж унасан.
preDeploy нь хасагдсан ХҮСНЭГТИЙГ `archive` схем рүү ЗӨӨНӨ (өгөгдөл үлдэнэ,
drop хийхгүй), хасагдсан БАГАНЫГ утгыг нь шинэ талбарт хөрвүүлсний дараа л
устгана. `tests/removed-schema-objects.test.ts` нь амьд объектыг санамсаргүй
бүртгэхээс сэргийлнэ.

⚠️ **Схемд `unique()` constraint бичихийг ХОРИГЛОНО — зөвхөн
`uniqueIndex("…_ux")`.** drizzle-kit 0.31.x нь DB-д БАЙГАА unique constraint-ыг
танихгүй тул push бүрд "нэмэх үү, truncate хийх үү?" гэж дахин асууж non-TTY
preDeploy-г унагаана (#5955 — composite ба баганы түвшний аль алинд). Unique
INDEX нь `pg_indexes`-ээс зөв танигдаж, ижил баталгаа өгнө.

⚠️ **`public` схемд өргөтгөлийн view байвал push мөн унана** — схемд
зарлагдаагүй view бүрийг DROP хийх гэж оролдоод
`cannot drop view pg_stat_statements_info because extension … requires it`
гэж таслагдана. Тиймээс `scripts/apply-pending-ddl.mjs` нь
`pg_stat_statements`-ийг `extensions` схем рүү зөөж (search_path-д нэмнэ),
үлдсэн public view-үүдийг логт ил бичдэг.

## Анхдагч дансны мэдээлэл

| Дугаар | Нэр |
|--------|-----|
| 11210000 | Касс |
| 11000001 | Харилцах данс |
| 51100000 | Борлуулалтын орлого |
| 61100000 | Үндсэн үйл ажиллагааны зардал |

---

## Knowledge Base — хэзээ, юу уншихыг

**Нягтлан бодох логик нэмэхийн өмнө холбогдох файлыг заавал уншина. Татварын хувь, account code, IFRS дүрмийг дур мэдэн таахгүй.**

`entry-knowledge/…` = ХУВИЙН repo `Tuguldur0107/entry-knowledge` (core-ийн хажууд
`../entry-knowledge` болгон clone хийнэ, §9e). Session-д байхгүй бол эхлээд нэмнэ —
файл байхгүй гэдгээр дүрмийг ТААХГҮЙ.

| Нөхцөл | Унших файл |
|--------|-----------|
| **Аль ч модулийн код хөндөхийн ӨМНӨ (ЗААВАЛ)** | `docs/dev/<модуль>.md` — энэ файлын хэсэг бүрийн «Дэлгэрэнгүй» холбоос; жагсаалт `docs/dev/README.md` |
| **Өртгийн логик (ЗААВАЛ)** | `docs/cost/README.md` → `01`…`04` → `docs/cost/CLAUDE.md` |
| **Хангамж / PO (ЗААВАЛ)** | `docs/procurement/00-proposal.md` → `01-implementation-contract.md`; батлагдсан шийдвэр `docs/cost/README.md` 0.6, норматив §11 FR-PROC-006…012 |
| **POS (ЗААВАЛ)** | `docs/pos/00-proposal.md` → `01-implementation-contract.md`; батлагдсан шийдвэр `docs/cost/README.md` 0.8 |
| **eBarimt 3.0 (ЗААВАЛ)** | `docs/pos/03-ebarimt-integration-plan.md` → `docs/deployment/ebarimt.md`; төлөв `docs/pos/02-implementation-status.md` |
| **Мэдлэгийн сан хэрэглэгчид (ЗААВАЛ)** | `docs/knowledge/00-proposal.md` — D1–D7; хэсэглэлт/квот/surfaces-ийн дүрэм §9e |
| **ITC developer портал / eTax / e-Balance холболт (ЗААВАЛ)** | `docs/integrations/00-itc-developer-portal.md` (портал, нэвтрэлт, орчин, гео-хязгаар, нээлттэй асуулт) → eBarimt-ийн албан баримттай тулгалт `01-ebarimt-posapi-verification.md` (P0–P2, staging тест) |
| Account код, GL posting template | `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/01-gl-posting-matrix.md` |
| Period close workflow | `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md` |
| Журнал бичих workflow | `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/journal-entry.md` |
| НӨАТ тайлан workflow | `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md` |
| Цалингийн workflow | `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/payroll-run.md` |
| Цалин, НДШ тооцоолол | `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/` |
| IFRS стандарт | `entry-knowledge/01-онол-хууль-стандарт/ifrs/_index.md` → тухайн файл |
| Татварын хууль | `entry-knowledge/01-онол-хууль-стандарт/tax/_index.md` → тухайн файл |
| 2026 татварын шинэчлэлт | `entry-knowledge/01-онол-хууль-стандарт/tax/2026-updates.md` |
| Дансны нэгдсэн жагсаалт | `knowledge/03-стандарт/chart-of-accounts.md` |
| Тайлангийн mapping (BS / IS / CF) | `knowledge/03-стандарт/reports/01-line-mapping.md` |
