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
| POS (борлуулалтын цэг) — кассын дэлгэц, борлуулах үнэ, борлуулалт→АР→касс→бараа→өртөг, хөнгөлөлт, ээлж, тайлан, **eBarimt 3.0 автомат баримт**, **QPay Quick QR (нэг товчны холболт)** | ✅ | QPay пилот, камер barcode, B2B нэхэмжлэх, хотын татвар |
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

### 5c. POS (Борлуулалтын цэг — Бараа материалын дотор) — ХЭРЭГЖСЭН

**Баримт бичиг: `docs/pos/` — POS-ийн код хөндөхийн ӨМНӨ заавал уншина.**
`00-proposal.md` (дизайн, БАТЛАГДСАН 2026-09-19: D1–D9, C1–C3) →
`01-implementation-contract.md` (функцийн нэр/параметр — зөрөхийг хориглоно).
Батлагдсан шийдвэр `docs/cost/README.md` change-control **0.8**.

Борлуулалт = "Төлбөр авах" нэг товч = НЭГ транзакц (`createPosSale`):

```
pos_sales → АР нэхэмжлэх (posted, sourceType "pos": Dr Авлага / Cr Орлого цэвэр [+ Cr НӨАТ — НӨАТ төлөгч бол])
          → зарлага бүр confirmed (sourceType "pos_sale", зарлагын төрөл = COGS)
          → УРЬДЧИЛСАН COGS (cost_entries valuationSource "provisional_avg", posted: Dr COGS / Cr Бараа явцын дунджаар)
          → төлбөр бүрд: касс/банк/түр данс → cash_documents (posted) + settlement; урьдчилгаа/бэлгийн карт/кредит → журнал Dr өглөг / Cr Авлага; зээл → АР нээлттэй
сар хаалт: computePeriodCosting posted урьдчилсан бичилтийг ЗАЛРУУЛНА — ноорог cogs_true_up (ТЭМДЭГТЭЙ) → postCostEntries; хөдөлгөгч (periodic.ts) ӨӨРЧЛӨГДӨӨГҮЙ
```

Хатуу дүрмүүд:

- **Явцын дундаж = PWA-ийн томьёо "өнөөдрийг хүртэл"** (`lib/costing/provisional-cost.ts`):
  сүүлийн тооцоологдсон сарын C2 + түүнээс хойшхи ӨРТӨГТЭЙ орлого; зарлага
  нөлөөлөхгүй (moving average БИШ); өртөгтэй тоо ≤ 0 → бичилт ҮГҮЙ (үнэ
  зохиохгүй), сар хаалтад л үнэлэгдэнэ. Σ(урьдчилсан + залруулга) = тоо × сарын
  эцсийн дундаж — идемпотент, дахин нээх/хаахад давхардахгүй
- **`[POS_SOURCED]`:** POS-оос үүссэн АР / касс / хөдөлгөөн / урьдчилсан өртгийн
  бичилтийг эх модулиас нь засах/устгах/буцаахыг хориглоно — ЗӨВХӨН
  `returnPosSale` (АР кредит + `return_in` + урьдчилсан урвуу + буцаан олголт)
- **Хасах үлдэгдэл — тохиргоогоор** (`pos_settings.allowNegativeStock`, D9;
  ШИНЭ байгууллагад анхдагч ХААЛТТАЙ — SIM ENT-054, хуучин байгууллагын утга
  хэвээр). Асаалттай үед — баримт,
  самбар, сар хаалтын checklist-д мэдэгдэл; хөдөлгөгч тэр бараа×сарыг зогсоодог
  тул `closePeriod` `unvalued-movements` хоригоор (сарын тооцоололд "calculated"
  биш scope-той батлагдсан зарлага/буцаалт/тохируулга) засагдтал хаагдахгүй;
  мөн `open-pos-shifts` (нээлттэй ээлж)
- **НӨАТ `vat_settings.isVatPayer`-ээс** (D4): төлөгч → барааны `salesPrice` НӨАТ
  ОРСОН, мөр бүр `vatMode`-оор задарна; төлөгч биш → НӨАТ мөр огт үгүй
- **Хөнгөлөлтийн хөдөлгөгч** (`lib/pos/discounts.ts`, 9 төрөл, тесттэй): төлөх
  дүнд шууд нөлөөлнө, НӨАТ хөнгөлөлтийн ДАРААХ дүнгээс; `approvalReasons`
  хоосон биш → `pos:post` эрх (`[APPROVAL_REQUIRED]`); GL default цэвэр орлого,
  `discountPosting=contra` бол GL-д Cr орлого бүтэн + Dr хөнгөлөлт (АР мөр цэвэр).
  **AI/MCP-ийн `create_pos_sale`** зөвшөөрөл шаардсан борлуулалтад эрхтэй token
  байсан ч ИЛ `managerApproval: true`-гүйгээр `[APPROVAL_REQUIRED]` (ENT-054)
- **Төлбөрийн хэлбэр = лавлах** (`pos_payment_methods`, 10 `kind`): карт/QPay/
  BNPL нь ТҮР ДАНСТАЙ (`cash_accounts` bank) — банкны хуулгаар тэгшитгэнэ,
  `businessObjectType "pos_sale"`-аар объект бүрээр
- **Дансны дугаар кодод байхгүй** — `pos_settings` рольууд (ratified-seed
  `ensurePosSettings`: данс, "Бэлэн худалдан авагч", COGS төрөл, CASH/CREDIT хэлбэр)
- Огноо серверийн УБ цагаар, кассчин огноо сонгохгүй; `assertPeriodOpen` +
  `assertPeriodOpenInTx`; advisory lock 1 (бараа) + 7 (дугаарлалт); эрх `pos`
  (`read`/`write`/`post`) — кассчин `pos:write` л байж болно
- Дараалсан дугаар `POS-YYMM-NNNN`, `RET-…`, `SH-YYMM-NNN`; АР нэхэмжлэх
  `AR-<POS-№>`, кассын баримт `<POS-№>-P<n>` / `-R<n>` / `<SH-№>-V`

Гол файлууд:

```
lib/pos/
├── constants.ts        POS_MODULE_KEY/POS_SOURCE_TYPE/POS_MOVEMENT_SOURCE_TYPE/
│                       POS_BUSINESS_OBJECT/PROVISIONAL_VALUATION_SOURCE/COGS_TRUE_UP_ENTRY_TYPE,
│                       kind/дүрэм/НӨАТ шошго — литералын ЦОРЫН ГАНЦ эх сурвалж
├── types.ts            plain төрлүүд (CartLine, DiscountRule, PaymentMethodView, PosSaleView…)
├── discounts.ts        applyDiscounts — ЦЭВЭР (тесттэй): 9 дүрэм, stacking, pro-rata, approvalReasons
├── sale-math.ts        computeSaleTotals (inclusive НӨАТ), roundToCashUnit, discountNetOf, ulaanbaatarNow
├── payments.ts         planPayments / planRefund — ЦЭВЭР (тесттэй): хариулт, лимит, ханш, үлдэгдэл
├── load-data.ts        ensurePosSettings (ratified-seed), view ачаалагч, loadCheckoutData (бүлгүүд, lastShift)
├── checkout-state.ts   Кассын дэлгэцийн ЦЭВЭР төлөв (тесттэй): addToCart, тоо/хөнгөлөлтийн оролт,
│                       filterCheckoutItems/resolveScan, парк (localStorage бүтэц, шалгалттай parse)
└── reports.ts          loadSalesReport + ЦЭВЭР нэгтгэл (aggregateBy/summarize/aggregatePayments, тесттэй)
lib/costing/provisional-cost.ts  явцын дундаж + trueUpDelta (ЦЭВЭР, тесттэй) + loadProvisionalUnitCosts
lib/costing/period-close.ts      cogs_true_up залруулга (posted урьдчилсан бичилтэд)
lib/actions/pos.ts               createPosSale (атомик) / returnPosSale / ээлж / бэлгийн карт /
                                 тохиргоо / төлбөрийн хэлбэр / хөнгөлөлтийн дүрэм / quotePosSale
app/(dashboard)/inventory/pos    Кассын дэлгэц v2 — дэлгүүрийн POS (tile + ticket; сканнер = гар,
                                 F9 төлбөр, нэг товчны ээлж, баримт хэвлэх) — docs/pos §4.1
app/(dashboard)/inventory/sales  Борлуулалт (жагсаалт) — Ээлж `/inventory/shifts`,
                                 Бэлгийн карт·кредит `/inventory/gift-cards`,
                                 POS тохиргоо `/inventory/pos-settings` нь ТУСДАА нав цэс
                                 (хуудас бүр зөвхөн ӨӨРИЙН өгөгдлөө ачаална; хуучин
                                 `/inventory/sales?tab=` линк redirect хийнэ)
app/(dashboard)/inventory/reports?tab=sales  Борлуулалтын тайлан (8 зүсэлт, COGS cost_period_results-ээс;
                                 топбарын сонгогч «Борлуулалтын тайлан (POS)»)
components/pos/                  pos-checkout-view (orchestrator) + checkout/{product-panel, ticket-panel,
                                 discount-dialog, parked-dialog}, payment-dialog, receipt-preview
                                 (80мм хэвлэлт, usePosPrint); хуудас бүрийн харагдац ТУСДАА —
                                 sales-page-view → sales-list-view / shifts-view + shift-dialogs
                                 (нээх, хаах, Z-тайлан) / gift-cards-view / pos-settings-view
                                 (+ discount-rule-dialog, хөнгөлөлтийн симуляци),
                                 sales-report-view (/inventory/reports?tab=sales, 8 зүсэлт)
components/panel/pos-sale-panel  Борлуулалтын панель (буцаалт: мөр/дүн, буцаан олголт эсвэл
                                 дэлгүүрийн кредит; дахин хэвлэх; eBarimt; АР/журнал/хавсралт)
tests/pos-*.test.ts, tests/provisional-cost.test.ts
```

**eBarimt 3.0 (PosAPI 3.0) — ХЭРЭГЖСЭН (v2, албан баримттай тулгасан).** Баримт:
`docs/pos/03-ebarimt-integration-plan.md` (дизайн v2, §8 хаагдсан),
`docs/deployment/ebarimt.md` (ОПЕРАТОРЫН загвар — нэг PosAPI, олон мерчант).

```
борлуулалт батлагдав ──commit──▶ pos_ebarimt_submissions (pending)
   server горим: ШУУД илгээж ≤8 сек хүлээнэ (sendSubmissionNow) → баримт ДДТД+сугалаа+QR-тай
   хэтэрвэл worker (20 сек) ард үргэлжилнэ; browser горим: кассын дэлгэц илгээнэ
        └─▶ POST {операторын posApiUrl}/rest/receipt ──▶ ДДТД → pos_sales (сугалаа/QR ХАДГАЛАХГҮЙ)
буцаалт ──▶ БҮТЭН: DELETE /rest/receipt · ХЭСЭГЧИЛСЭН: POST + inactiveId=сүүлийн ДДТД (гинж)
өдөр бүр 23:30 УБ ──▶ GET /rest/sendData; scheduler: /rest/info → сугалаа/хоцролт/хүрэлцээ
```

- **Борлуулалт ХЭЗЭЭ Ч илгээлтээс болж зогсохгүй** — enqueue нь commit-ийн
  ДАРАА, async; амжилтгүй бол backoff (15с→1мин→5мин→30мин→2ц, max 20),
  3 дараалсан алдаанд `ebarimt_failed` аудит → `pos.ebarimt_failed` мэдэгдэл
- **Код ЗОХИОХГҮЙ** (ханшийн дүрэмтэй ижил зарчим): барааны ангилалын код
  (7 орон, `inventoryItems.ebarimtClassificationCode`, хоосон бол
  `inventoryCategories`-аас өвлөнө), НӨАТ-гүй/0%-ийн татварын бүтээгдэхүүний
  код (3 орон), төлбөрийн хэлбэрийн `ebarimtCode` — аль нэг дутвал
  `[EBARIMT_UNMAPPED_ITEM]` / `[EBARIMT_TAX_PRODUCT_CODE]` /
  `[EBARIMT_UNMAPPED_PAYMENT]` гэж ШИДЭЖ, submission `failed` болж шалтгаан
  UI-д ил гарна
- **Сугалаа (lottery) ба QR (qrData) ХЭЗЭЭ Ч ХАДГАЛАГДАХГҮЙ** — албан заавар §5
  хориглодог. Зөвхөн илгээлтийн хариуны мөчид (`EbarimtSaleResult`, action
  result / browser fetch) баримт дээр НЭГ удаа хэвлэгдэнэ; дахин хэвлэхэд ДДТД.
  `pos_ebarimt_submissions.response` `stripReceiptSecrets`-ээр; хуучин мөрийг
  preDeploy цэвэрлэнэ; `pos_sales.ebarimt_lottery/qr_data` REMOVED_COLUMNS-д
- **Хэсэгчилсэн буцаалт = `inactiveId` гинж** (§5 «Баримтын засвар»): сүүлийн
  ДДТД-г өгч ШИНЭ бичилт, сугалаа дахин олгогдохгүй, `pos_sales.ebarimtId`
  шинэ ДДТД болно. DELETE зөвхөн БҮТЭН буцаалт. `prepareSubmission` шийднэ —
  `request` ба `cancel` зэрэг ХЭЗЭЭ Ч байхгүй
- **PosAPI-ийн байдал** (`/rest/info`, `posapi-info.ts` ЦЭВЭР): үлдсэн сугалаа
  < 200, ТЕГ рүү ≥48ц илгээгдээгүй (72ц хуулийн хязгаар), хүрэхгүй → `attention.ts`
  (`pos.ebarimt_lottery_low` / `send_stale` / `posapi_down`, өдөрт нэг); статуст
  «Мерчант бүртгэл» = операторын хүсэлтийг харилцагч батласан эсэх
- **Идемпотент:** `pos_ebarimt_submissions` дээр (saleId, kind) partial unique
  (`pending`/`claimed`); аль хэдийн `sent` борлуулалт PosAPI-г дахин дуудахгүй;
  worker `pending → claimed` атомик шилжилтээр нэг мөрийг хоёр instance зэрэг
  илгээхээс сэргийлнэ (10 мин гацвал чөлөөлөгдөнө)
- **Wire-формат албан спекээр** (2026-09-25, #128): `totalVAT` түлхүүр, `billIdSuffix`
  (`billIdSuffixOf` — дахин илгээлтэд ИЖИЛ, засвар бүрд ӨӨР), `/rest/receipt` timeout
  `POSAPI_RECEIPT_TIMEOUT_MS` 90 сек (`EBARIMT_POSAPI_TIMEOUT` — давхар ДДТД-ийн эрсдэл ил) —
  `docs/integrations/01-ebarimt-posapi-verification.md` §2
- **Төлбөрийн код ба лавлах (P1, 2026-09-25):** `payments[].code`-ийн АЛБАН жагсаалт
  `EBARIMT_PAYMENT_CODES` (CASH · PAYMENT_CARD · BANK_TRANSFER · BANK_TRANSFER_QPAY) —
  readiness жагсаалтад байхгүй кодыг `warnings`-аар АНХААРУУЛНА (блоклохгүй, ТЕГ код нэмж
  болно); `credit`-д санал байхгүй (`INVOICE` албан биш). ТЕГ-ийн нийтийн лавлах
  `api.ebarimt.mn` ЗӨВХӨН Монголын IP — env `EBARIMT_PUBLIC_API_BASE` (`publicApiBase()`);
  иргэний РД-аар `getTinInfo` ХОРИОТОЙ (ХХМХ 4.1.11, ТЕГ 2026-05-11), регистрээр лавлах
  2026-06-15-аас хязгаарлагдана → кассын B2B-д **ТТД шууд** үндсэн зам (нэр `getInfo`-оос,
  `lookupTaxpayerByTin`; лавлах унасан ч төлбөр хаагдахгүй). ТТД 11–14 орон (хувь хүн 12–14),
  татварын бүтээгдэхүүний код 3–5 орон (`getProductTaxCode` 5 оронтой ч буцаадаг); `getInfo`-ийн
  `cityPayer`/`freeProject` → мерчантын статус + кассын анхааруулга (НХАТ, VAT_FREE/304 автомат
  БИШ); PosAPI хувилбар сүүлийн хариуны `version`-оос, <3.0.12 улаан (`isPosApiVersionOutdated`)
- **Мерчантын ТТД регистрээс** (2026-09-25): хэрэглэгч 11 оронтой ТТД-гээ
  мэддэггүй тул тохиргооны талбар 7 оронтой байгууллагын РЕГИСТР хүлээж авна —
  «ТЕГ-ээс татах» (хоосон бол `company_settings.registerNo`) эсвэл хадгалахад
  `updatePosSettings` `lookupTinByRegNo`-оор ТТД болгоно; унавал ШИДНЭ (ТТД
  ЗОХИОХГҮЙ). Салбар / кассын дугаар хоосон бол форм «001»-ийг ИЛ санал болгоно
- **ТЕГ-ийн лавлах БРАУЗЕРААС ЭХЛЭЭД** (2026-09-26, `lib/ebarimt/browser-lookup.ts`,
  тесттэй): кассын ААН (регистр → нэр + ТТД), мерчантын «ТЕГ-ээс татах», харилцагчийн
  картын лавлах — хэрэглэгчийн браузер Монголд тул `api.ebarimt.mn`-ийг ШУУД дуудна;
  сүлжээ/CORS/timeout бол серверийн action (прокси) руу буцна, ТЕГ «олдсонгүй»
  гэж хариулсан бол серверээр дахин асуухгүй. ТТД ЗОХИОХГҮЙ хэвээр (`lookup.ts`).
  PosAPI-ийн `/rest/info` регистр буцаадаггүй тул мерчантын ТТД ↔ регистрийн
  эх нь операторын консол (operator.ebarimt.mn → Мерчантын жагсаалт)
- **ТЕГ-ийн лавлах БРАУЗЕРААС ЭХЛЭЭД** (2026-09-26, `lib/ebarimt/browser-lookup.ts`,
  тесттэй): кассын ААН (регистр → нэр + ТТД), мерчантын «ТЕГ-ээс татах», харилцагчийн
  картын лавлах — хэрэглэгчийн браузер Монголд тул `api.ebarimt.mn`-ийг ШУУД дуудна;
  сүлжээ/CORS/timeout бол серверийн action (прокси) руу буцна, ТЕГ «олдсонгүй»
  гэж хариулсан бол серверээр дахин асуухгүй. ТТД ЗОХИОХГҮЙ хэвээр (`lookup.ts`).
  PosAPI-ийн `/rest/info` регистр буцаадаггүй тул мерчантын ТТД ↔ регистрийн
  эх нь операторын консол (operator.ebarimt.mn → Мерчантын жагсаалт)
- **Операторын PosAPI нийтэд ХААЛТТАЙ** (2026-09-25, `docs/deployment/ebarimt.md`
  §4a): Cloudflare WAF нууц header шаардана; Entry сервер PosAPI + лавлахын прокси
  (`EBARIMT_PUBLIC_API_BASE`) руу `EBARIMT_GATEWAY_KEY`-г нэмнэ — ЗӨВХӨН
  `EBARIMT_GATEWAY_HOSTS`-ийн хост руу (харилцагчийн дурын `ebarimtPosApiUrl` руу
  нууц АЛДАГДАХГҮЙ, албан `api.ebarimt.mn` руу хэзээ ч). ЦЭВЭР
  `lib/ebarimt/gateway-auth.ts` (тесттэй); `/api/health.ebarimt.gatewayAuth` зөвхөн boolean
- **Гар ДДТД (`manual`)** автомат илгээлтэд ОРОХГҮЙ; `sent` баримтын ДДТД-г
  гараар засах ХОРИОТОЙ (давхар баримт)
- **Борлуулалт бүрд eBarimt-гүй (`skipped`)**: төлбөрийн диалогийн «eBarimt
  баримт илгээх» switch (default асаалттай) → `skipEbarimt` → статус `skipped`,
  дараалалд орохгүй, аудитын хураангуйд ил; панелиас [eBarimt илгээх]
  (`resendEbarimt`) дараа нь илгээнэ. Анхны статусын дүрэм ЦЭВЭР
  `initialSaleEbarimtStatus` (receipt.ts, тесттэй) — гар ДДТД > унтраалттай/
  НӨАТ бус (null) > skipped > pending; action дотор давтахгүй
- **Кассын «НӨАТ» мөр** (`components/pos/checkout/vat-receipt-bar.tsx`, НӨАТ төлөгчид
  л): ☑ НӨАТ (анхдагч, борлуулалт бүрийн дараа буцна) → «Хувь хүн» (eBarimt
  дугаар, сонголтоор) | «ААН» (7 оронтой РЕГИСТР бичмэгц ТЕГ-ээс НЭР + ТТД —
  `getTinInfo` нь ЗӨВХӨН ТТД-г тоогоор буцаадаг, нэр `getInfo?tin=`-ээс;
  олдоогүй бол ТӨЛБӨР хаагдана). Худалдан авагчийн ЦЭВЭР дүрэм
  `lib/pos/ebarimt-buyer.ts` (тесттэй); төлбөрийн диалогт зөвхөн хураангуй
- **НӨАТ-гүй борлуулалт** (☐ НӨАТ — нөхөж оруулах, залруулга; `lib/pos/non-vat.ts`
  ЦЭВЭР, тесттэй): НӨАТ задлахгүй, eBarimt ОГТ үүсэхгүй (`resendEbarimt` /
  гар ДДТД татгалзана), GL-д `pos_settings.nonVatRevenue/ReceivableAccountNumber`
  (default `51100002` / `13110002` — бусад рольтой ижил, дансны модонд байхгүй
  бол `ensurePosSettings` стандарт нэрээр нээнэ; хуучин null-ийг preDeploy нөхнө), шалтгаан ЗААВАЛ
  (`pos_sales.nonVatReason`), эрх `pos:post` (approvalReasons), аудитад ил;
  жагсаалтын «НӨАТ баримт» багана + «НӨАТ-гүй» шүүлт, панель. Буцаалт эх АР
  мөрийн орлогын данс руу. AI `create_pos_sale` `nonVat` + `nonVatReason`
- **Зээлээр (`credit`) = НЭХЭМЖЛЭХ:** зээлийн хэсэгтэй борлуулалт `B2C/B2B_INVOICE`
  төрлөөр, тэр хэсэг `payments[].status = PAY` (бусад PAID), сугалаагүй —
  `receiptTypeOf` (receipt.ts, тесттэй); `EBARIMT_INVOICE_PAYMENT_KINDS` нь ЦОРЫН ГАНЦ эх
- **taxType бүлэглэл:** НӨАТ төлөгч бус → бүх мөр `NOT_VAT`; төлөгч бол
  барааны `vatMode` → `VAT_ABLE|VAT_FREE|VAT_ZERO`, мөрүүд дэд баримт
  (`receipts[]`) болж бүлэглэгдэнэ. Хэсэгчилсэн буцаалтын дараа үлдсэн мөрөөр
  л илгээгдэж, төлбөрүүд хувь тэнцүүлэн хуваарилагдана (Σ = баримтын дүн)
- **Мерчантын тохиргоо харилцагчийн апп-д** (`pos_settings.ebarimt*`), Console-д
  БИШ; `/api/health`-ийн `ebarimt` блокт зөвхөн ТООЛУУР (ТТД, нууц байхгүй)
- **АСААХААС ӨМНӨ бэлэн байдал шалгагдана** (`readiness.ts` ЦЭВЭР, тесттэй):
  ангилалын кодгүй идэвхтэй бараа (бүлгээс өвлөх нь тооцогдоно), татварын
  бүтээгдэхүүний кодгүй НӨАТ-гүй/0% бараа, eBarimt кодгүй идэвхтэй төлбөрийн
  хэлбэр — тоо + эхний нэрсээр. Үлдсэн бол switch идэвхгүй бөгөөд
  `updatePosSettings` ШИДНЭ. Эдгээр алдаа урьд нь зөвхөн борлуулалтын ДАРАА
  async гарч ирдэг байв

```
lib/ebarimt/
├── constants.ts   PosAPI-ийн литерал (төрөл, taxType, статус, алдааны код,
│                  backoff) + EBARIMT_PAYMENT_CODE_SUGGESTIONS — CLIENT-SAFE
├── types.ts       PosAPI JSON + Entry-ийн ЦЭВЭР оролт (EbarimtSaleInput)
├── receipt.ts     buildEbarimtReceipt / allocatePayments / taxTypeOf /
│                  ebarimtSettingsProblems — ЦЭВЭР (tests/ebarimt-receipt.test.ts)
├── readiness.ts   ebarimtReadiness — ЦЭВЭР (tests/ebarimt-readiness.test.ts):
│                  идэвхжүүлэхийн ӨМНӨХ кодын дутуу; DB давхарга нь
│                  queue.ts `loadEbarimtReadiness`
├── posapi-info.ts parsePosApiInfo / isMerchantRegistered / hoursSince — ЦЭВЭР
│                  (tests/ebarimt-posapi-info.test.ts); client.ts fetchPosApiHealth
├── tax-product-codes.ts  НӨАТ-гүй (305–446) / 0% (501–507) кодын АЛБАН лавлах —
│                  барааны картын сонгогч; хориглолт биш (ТЕГ код нэмж болно)
├── classification-search.ts  7 оронтой АНГИЛЛЫН код (ҮСХ «Бүтээгдэхүүн, үйлчилгээний
│                  нэгдсэн ангилал» = CPC 2.1 + 2 оронтой үндэсний задаргаа) хайлт —
│                  ЦЭВЭР (tests/ebarimt-classification-search.test.ts)
├── classification-codes.json/.ts  АЛБАН жагсаалт (3499 код) — SERVER-т л ачаална
│                  (client bundle-д оруулахгүй). ЭХ = ҮСХ БҮНА PDF (мерчантын багц
│                  Angilal/, х.4–91): `python3 scripts/extract-buna-pdf.py <pdf> x.csv`
│                  → `node scripts/build-ebarimt-classifications.mjs x.csv`. Багцын
│                  gs1_gs1.xlsx-ийг ХЭРЭГЛЭХГҮЙ (тэргүүлэх 0 алдагдсан, нэр тасарсан).
│                  Эх баримтын давхардсан код (2441030) — дэд ангийн угтвартай таарсан
│                  нь үлдэнэ. Хайлт: бүтэн үг > үгийн эхлэл > дэд мөр. Жагсаалтад
│                  байхгүй 7 оронтой кодыг гараар оруулж болно — ЗОХИОХГҮЙ.
│                  Хайлт: lib/actions/ebarimt-classification.ts; UI сонгогч
│                  components/inventory/ebarimt-code-pickers.tsx (7 ба 3 оронтой)
├── client.ts      PosAPI REST: putReceipt / deleteReceipt / info / sendData
│                  (DB-гүй — browser горимд кассын дэлгэц ч дуудна)
├── gateway-auth.ts WAF-ын нууц header — allowlist-ийн хост руу л (ЦЭВЭР, тесттэй)
├── lookup.ts      ТЕГ-ийн нийтийн getTinInfo (РД → ТТД) + getInfo (ТТД → нэр) /
│                  getBranchInfo (24ц кэш; parse нь ЦЭВЭР, tests/ebarimt-lookup.test.ts)
├── queue.ts       DB давхарга: enqueue / prepare / markSent / markFailed /
│                  claimDueSubmissions / ebarimtStatusSummary
├── worker.ts      claim → PosAPI → бичих; sendSubmissionNow (шууд, timeout-тэй,
│                  түр үр дүн); sendData; гацсан claim чөлөөлөх
└── ticker.ts      In-process worker (20 сек) — EBARIMT_WORKER=off унтраана
lib/actions/ebarimt.ts   Тохиргоо/холболт шалгах/дахин илгээх/лавлах/outbox
app/api/cron/ebarimt     Гадаад cron (Bearer CRON_SECRET)
tests/ebarimt-receipt.test.ts
```

**QPay Quick QR (Фаз 3b, Фаз 1–2 ХЭРЭГЖСЭН).** Баримт:
`docs/pos/04-qpay-integration-plan.md` (D1–D8 БАТЛАГДСАН 2026-09-20, §3.6 нэг
товчны холболт), гэрээ `docs/pos/01-implementation-contract.md` §10,
нэвтрүүлэлт `docs/deployment/qpay.md`. **Entry = ХСН — QPay-тэй ШУУД
харьцахгүй**, `Tuguldur0107/qpay-dashboard` REST v1 (x-api-key) хаалгаар.

```
Холбох: [QPay холбох] → state (AES-GCM, 15 мин) → {dashboard}/connect (бүртгэл/онбординг/consent)
   → callback?state&code → Entry сервер POST /api/connect/exchange → key+secret (НЭГ удаа) → шифртэй хадгална
   → «QPay» хэлбэр + «QPay түр данс» (GL 11000099) seed → readiness → асна   (гар зам: key хуулах хэвээр)
АВТОМАТ (QPAY_PARTNER_KEY): Компанийн мэдээлэл (регистр, MCC, хот/дүүрэг, хаяг, утас, данс ★) → [QPay-д бүртгүүлэх]
   → Entry сервер POST {dashboard}/api/partner/merchants (Bearer, external_id = org id, ИДЕМПОТЕНТ)
   → мерчант + dashboard хэрэглэгч (эзний и-мэйл, нууц үг тохируулах линк) + данс → key+secret → ижил зам
   → qpay_provisioned_at; компанийн данс хадгалах → PUT …/bank-accounts (Entry эх сурвалж)
QPay мөр → [QR үүсгэх] → pos_qpay_intents (open, cartSnapshot) → dashboard POST /api/v1/invoices
   → QR + deeplink; диалог ENTRY DB-ээс 2 сек тутам (QPay polling ҮГҮЙ — ККТТ гэрээ хориглодог)
   ← webhook POST /api/pos/qpay/webhook?intent= (HMAC-SHA256 x-webhook-signature) ЭСВЭЛ [Шалгах] 10 сек-д нэг
→ paid → «Төлбөр авах» → createPosSale({ qpayIntentId }) → транзакц дотор finalizeIntentInTx
```

- **Intent машин ЦЭВЭР** (`lib/qpay/intent.ts`, тесттэй): open → paid | cancelled |
  expired | failed; paid → finalized | failed. `markIntentPaid` ИДЕМПОТЕНТ (webhook ба
  гар шалгалт хоёулаа нэг зам), дүн зөрвөл `failed` + шалтгаан — төлбөр ЗОХИОХГҮЙ
- **Борлуулалт intent-ээс салахгүй:** QPay мөртэй `createPosSale` нь intent `paid`,
  `saleId IS NULL`, дүн таарсан (|Δ|<1₮), QPay мөр НЭГ — эс бөгөөс
  `[QPAY_INTENT_REQUIRED]` / `[QPAY_INTENT_NOT_PAID]` / `[QPAY_AMOUNT_MISMATCH]`.
  Төлөгдсөн ч борлуулалт унавал (D3) intent `paid` хэвээр → борлуулалтын
  жагсаалтын баннер [Борлуулалт болгох] `finalizeQpayIntent` (snapshot-оос ижил
  оролтоор) — мөнгө орсон ч бараа хасагдаагүй ХЭЗЭЭ Ч чимээгүй үлдэхгүй; 10 мин
  хэтэрвэл `pos.qpay_paid_unfinalized` мэдэгдэл (`attention.ts`, өдөрт нэг)
- **GL ӨӨРЧЛӨЛТГҮЙ:** `ewallet` хэлбэрийн түр данс (банкны хуулгаар тэгшитгэнэ,
  ККТТ 1% шимтгэл settlement-д гарна); QPay буцаалт БАЙХГҮЙ (Quick QR refund-гүй) —
  бэлэн / дэлгүүрийн кредитээр
- **Settlement автомат** (`lib/cash/ewallet-settlement.ts` ЦЭВЭР, тесттэй; DB
  `ewallet-settlement-data.ts`): провайдер шимтгэлээ суутгаад банкинд шилжүүлсэн
  хуулгын мөрийг түр дансны ТУЛГАГДААГҮЙ орлогуудтай FIFO-оор тулгана (үлдэгдэлд
  суурилсан — баримт тэмдэглэх баганагүй; хэлбэрийн `feePercent` мөр бүрд, 1₮ +
  0.5₮/орлого хүлцэл; текст = провайдерийн alias / хэлбэрийн нэр → «Хүчтэй»,
  зөвхөн дүн → «Дунд», зөвхөн бүх үлдэгдэл таарсан үед). «Ашиглах» / MCP
  `ewalletSettlement: true` → хадгалахад мөр нь ОРЛОГО биш **түр данс → банк
  ШИЛЖҮҮЛЭГ** (цэвэр) + **шимтгэлийн зарлага** (түр данснаас,
  `pos_settings.ewalletFeeAccountNumber`, default 73100008) — касс модуль ба GL
  хоёул тулна. Нийт нь тулгагдаагүй үлдэгдлээс хэтрэхгүй; шимтгэлийг ЗОХИОХГҮЙ
  (нийт − цэвэр = хуулгын бодит дүн). `get_pos_status` тулгагдаагүй дүнг заана
- **Key-ийн АВТОМАТ сэргээлт** (2026-09-26, пилот: dashboard-ын UI-аас «API key
  солих» Entry-ийн key-г хүчингүй болгож QR зогссон): dashboard интеграц бүрд
  ТУСДАА key олгоно (`qpay-dashboard` `lib/client-keys.ts` — consent
  `entry@<хост>`, partner `entry@<хост>#<org id>`; UI-ийн «солих» зөвхөн мерчантын
  гар key-д). Entry 401 авбал `withQpayKeyRecovery` (`lib/qpay/partner.ts`) →
  `POST …/partner/merchants/{id}/credentials` (partner key, `external_id` + `client_host`)
  → шинэ key + одоогийн secret шифртэй → НЭГ удаа давтана; webhook-ийн гарын үсэг
  таарахгүй (open intent) бол мөн сэргээж дахин шалгана. Cooldown байгууллагад
  минутад нэг (`lib/qpay/recovery.ts` ЦЭВЭР, тесттэй); аудит `credentials_recovered`
  / `credentials_recover_failed` (угтвар л). QPAY_PARTNER_KEY-гүй (dedicated) бол
  [QPay дахин холбох] — алдааны мессеж замыг нэрлэнэ
- **Нууц:** API key (`qpd_live_…`/`qpd_test_…`) ба webhook secret `encryptSecret`-ээр
  (`pos_settings.qpayApiKeyEnc/qpayWebhookSecretEnc`), зөвхөн `lib/qpay/store.ts`
  задална; `getQpayStatus` → `*Set: boolean`; аудит, лог, `/api/health.qpay`-д УТГА
  ХЭЗЭЭ Ч гарахгүй. Console мерчантын нууц хадгалахгүй
- **Идэвхжүүлэхээс ӨМНӨ readiness** (`lib/qpay/readiness.ts` ЦЭВЭР, тесттэй): API URL,
  key, webhook secret, `NEXT_PUBLIC_APP_URL` (нийтийн webhook URL) — дутуу бол
  switch идэвхгүй, `saveQpaySettings` ШИДНЭ; localhost → анхааруулга
- **Асаахад хэлбэр + данс АВТОМАТ** (`lib/qpay/seed.ts` ЦЭВЭР төлөвлөгч, тесттэй;
  `ensureQpayPaymentMethod` DB) — ratified-seed: «QPay» (ewallet, provider qpay) +
  «QPay түр данс» (банк, GL 11000099) дутуу бол л үүснэ, байгааг хөндөхгүй;
  readiness `seedOnEnable` (default) хэлбэр/данс дутууг warning гэж үзнэ, seed-ийн
  ДАРАА `seedOnEnable:false` хатуу шалгана. eBarimt код `BANK_TRANSFER_QPAY`
  (PosAPI 3.0 албан жагсаалт, 2026-09-25 — урьд null); кодгүй байгаа QPay хэлбэрт нөхнө, хэрэглэгчийн оноосныг хөндөхгүй
- **Автомат бүртгэл — Partner API** (`docs/deployment/qpay.md` §2b, plan §3.7;
  dashboard `docs/API.md` «Partner»): `lib/qpay/provision.ts` ЦЭВЭР (тесттэй —
  `buildQpayProvisionPlan`: регистрээс company/person, дутууг МОНГОЛООР нэрлэнэ,
  `mapQpayBankAccounts` банкны код нэрээс таагдвал л, default нэг);
  `lib/qpay/reference.ts` CLIENT-SAFE лавлах (MCC 85, банкны код, хот, УБ дүүрэг —
  ЭХ dashboard `src/lib/*`; аймгийн сум `getQpayDistricts` action); `lib/qpay/partner.ts`
  SERVER (`provisionQpayMerchantForOrg` — нууц connect callback-тай ИЖИЛ замаар
  шифртэй, `syncQpayBankAccountsForOrg` best effort — `{ warning }` буцаана,
  хадгалалт унахгүй). Partner key `qpayPartnerKey()` store.ts-д (partner ↔ store
  импортын тойрог үүсгэхгүй). `company_settings.mcc_code/city_code/district_code`,
  `pos_settings.qpay_provisioned_at` (null = consent/гар зам → данс sync ҮГҮЙ).
  Код ЗОХИОХГҮЙ — dashboard 400/502-ийн шалтгаан `[QPAY_PROVISION_REJECTED]`-ээр
  хэрэглэгчид ил
- **QPay данс = КАССЫН МОДУЛИЙН банкны данс, салбар = агуулах** (2026-09-25;
  `company_settings.bank_accounts` ЗӨВХӨН нэхэмжлэхийн толгойд — тэнд QPay sync
  ҮГҮЙ, `isDefault` хуучин мөрд л): `cash_accounts.bank_code` (жагсаалтаас —
  `qpayBankName`), `iban`, `account_holder` (хоосон бол компанийн нэр),
  `qpay_payout` («QPay төлбөр хүлээн авах» — MNT банкны данс, дугаартай),
  `qpay_default` (нэг л — `afterQpayAccountChange` бусдаас авна, үндсэнгүй бол
  эхний тэмдэглэсэн). ЦЭВЭР `payoutAccountsFromCashAccounts` (тесттэй), DB
  `loadQpayPayoutAccounts`; create/update/toggle/delete бүр QPay-д хамаатай
  өөрчлөлтөд sync (toast анхааруулга). `warehouses.qpay_cash_account_id` (FK set
  null; тэмдэглэсэн идэвхтэй банкны данс л — `resolveWarehouseQpayAccount`) →
  `createQpayIntent` ээлжийн агуулахаас `resolveWarehousePayoutAccount` →
  `createDashboardInvoice({ payoutAccountNumber })` → dashboard `payout_account_number`
  (sync-лэсэн данс л, тэр нэхэмжлэхэд default; бүртгэлгүй → 400). Сонгоогүй
  агуулах = үндсэн данс; сонгосон данс тэмдэг/идэвхгүй болсон бол QR үүсгэхэд
  ИЛ алдаа (fallback ҮГҮЙ). GL/settlement өөрчлөлтгүй (нэг түр данс). preDeploy
  нэг удаа: provisioned байгууллагын company_settings данстай дугаараар таарах
  кассын дансыг тэмдэглэнэ. AI `create_cash_account` `bankCode/accountHolder/
  iban/qpayPayout/qpayDefault`
- **Нэг товчны холболт** (`lib/qpay/connect.ts` SERVER, тесттэй; `startQpayConnect`;
  `app/api/pos/qpay/connect/callback`): state нь authenticated шифр (org, user,
  apiUrl, 15 мин) — өөр байгууллагын нэрээр зохиох боломжгүй; code нэг удаагийн
  (5 мин), солилцоо СЕРВЕР-СЕРВЕР — нууц URL/browser/лог/аудитад ХЭЗЭЭ Ч орохгүй.
  Дахин холбоход dashboard-ын key СОЛИГДОНО (UI анхааруулна). Нийтийн URL-гүй
  бол товч идэвхгүй, гар зам хэвээр. Dashboard тал: `src/app/connect`,
  `src/app/api/connect/{approve,exchange}`, `src/lib/connect-grants.ts`
- **Raw `sql` template-д Date объект ШУУД параметр болохгүй** — postgres драйвер
  string/Buffer шаардана (`${date.toISOString()}::timestamptz` эсвэл drizzle
  operator). 2026-09-20: `/api/health.qpay` null, QPay таб production-д
  уншигдахгүй байв; `tests/sql-date-params.test.ts` статикаар барина
- **Client/server хил:** `intent.ts` `crypto`-гүй (кассын диалог import хийдэг);
  HMAC нь `webhook-signature.ts` (зөвхөн route). Webhook нэвтрэлтгүй — org нь
  intent-ээс, эрх нь гарын үсгээс (401/422/409 кодоор татгалзана, аудит
  `pos_qpay_intent`)
- Хэлбэрийн `provider` зөвхөн `ewallet` kind-д, зөвхөн `"qpay"`
  (`resolvePaymentProvider`); нэг борлуулалтад QPay мөр НЭГ

```
lib/qpay/
├── constants.ts        QPAY_PROVIDER/статус/TTL (60–900, default 180)/шалгалтын
│                       интервал/алдааны код — CLIENT-SAFE
├── types.ts            Dashboard JSON + QpayIntentView / QpayStatusSummary
├── intent.ts           canTransition, clampInvoiceTtl, isExpired, checkAllowed,
│                       amountMatches, parseWebhookPayload, secondsLeft — ЦЭВЭР (тесттэй)
├── readiness.ts        qpayReadiness (seedOnEnable) — ЦЭВЭР (тесттэй)
├── seed.ts             planQpaySeed — асаахад хэлбэр + түр данс (ЦЭВЭР, тесттэй)
├── connect.ts          buildConnectState / parseConnectState / connectUrl / exchangeConnectCode — SERVER (тесттэй)
├── webhook-signature.ts verifyWebhookSignature (node:crypto, timing-safe) — SERVER
├── client.ts           Dashboard REST: create/cancel/check/list (8 сек timeout, QpayError)
└── store.ts            DB давхарга: config (decrypt), intent CRUD, markIntentPaid,
                        finalizeIntentInTx, expireStaleIntents, summary, countPaidUnfinalized
lib/actions/qpay.ts     getQpayStatus / saveQpaySettings (seed) / testQpayConnection /
                        startQpayConnect / createQpayIntent / getQpayIntent / checkQpayIntent /
                        cancelQpayIntent / listPendingQpayIntents / finalizeQpayIntent
app/api/pos/qpay/webhook/route.ts            payment.paid webhook
app/api/pos/qpay/connect/callback/route.ts   нэг товчны холболтын буцах зам (exchange → хадгалах → асаах)
components/pos/checkout/qpay-dialog.tsx  QR диалог; components/ui/qr-code.tsx SVG QR
lib/ai/tools.ts get_qpay_status (унших — getQpayStatus-тай НЭГ loader)
tests/qpay-{intent,readiness,seed,connect}.test.ts, tests/sql-date-params.test.ts
```

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
