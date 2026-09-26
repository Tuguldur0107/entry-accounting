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
- **AG Grid Community v35** — бүх хүснэгтийн UI, `DataGrid` wrapper-ээр ([Хүснэгтийн стандарт](#хүснэгтийн-стандарт-ag-grid-community))
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
- **Billing / entitlement** (`docs/billing/00-proposal.md` — ЗААВАЛ уншина;
  `lib/billing/`): багц кодод (`plans.ts`: trial/standard/platform/enterprise/
  dedicated — боломж, хязгаар, үнэ), байгууллагын ялгаа
  `organization_subscriptions` (planId, status, seats, trialEndsAt,
  currentPeriodEnd, overrides JSON, pricePerSeatMnt). ЦЭВЭР шийдвэр `entitlements.ts`
  (`resolveEntitlements`, тесттэй), DB `load.ts`, **шалгах цэг ЗӨВХӨН
  `guards.ts`**: `assertWritesAllowed` (requireModuleAction write/post-д НЭГ
  цэгээс — read-only багцад `[SUBSCRIPTION_READ_ONLY]`), `requireFeature`
  (REST `api.rest` → 402, MCP `mcp` → -32003, eBarimt enqueue
  алгасна), `assertSeatAvailable` (урилга), `assertCompanyCreatable`
  (multi_company + компанийн тоо), `assertModuleEntitlements` (requireModuleAction —
  `accounting` боломж + бичих эрх, entitlement-ийг НЭГ удаа уншина).
  Код даяар `if plan === …` ХОРИОТОЙ.
  **Нягтлан бодох ажлыг дунд нь блоклохгүй**: унших, тайлан, экспорт, сар
  хаах (`requireRole`) үргэлж. Мөргүй SaaS байгууллага = trial 14 хоног;
  past_due grace 14 хоног; хүснэгт АНХ үүсэхэд preDeploy бүх байгууллагыг
  standard/active нөхнө. dedicated горимд бүх боломж, хязгааргүй (DB
  хөндөхгүй). UI: `/settings/billing` (гишүүн бүр ХАРНА, засахгүй), топбарын
  баннер, `attention.ts` дохио (`subscription.trial_ending` / `read_only`),
  AI/MCP/REST `get_billing_overview` (унших — ижил loader).
  **ҮНЭ — ОГНООТОЙ, ГУРВАН давхарга** (`pricing.ts` ЦЭВЭР, тесттэй; доошоо
  дардаг): `plans.ts`-ийн default → `platform_plan_prices` ҮЕҮҮД (Console-оос,
  платформ даяар нэг) → `organization_subscriptions.pricePerSeatMnt`
  (харилцагчийн тусгай үнэ). Үе бүр `effectiveFrom … effectiveTo`
  (ХАМРУУЛСАН; null = хугацаагүй) мужтай тул анхны үнэ түүхэндээ үлдэж,
  ирээдүйн үнийг урьдчилан оруулна; `priceAtDate` нь тухайн өдрийг хамрах үеийг
  олно, БАЙХГҮЙ бол default руу шилжинэ (цоорхойг ЗОХИОЖ нөхөхгүй). Давхцлыг
  `planPriceChange` УРЬДЧИЛЖ барина: хугацаагүй өмнөх үе дээр шинэ үе хожуу
  эхэлбэл өмнөхийг автоматаар өмнөх өдрөөр хааж ИЛ мэдэгдэнэ, бусад давхцлыг
  ТАТГАЛЗАНА.
  `null` = ТОГТООГООГҮЙ (хэлэлцээрээр), 0₮ БИШ; хадгалагдсан null нь ИЛ
  цэвэрлэлт тул default руу БУЦАХГҮЙ. `/settings/billing`, `get_billing_overview`,
  Console гурвуул `resolveSeatPrice`-ээр НЭГ утга хардаг; сарын дүн =
  суудал × үнэ (`monthlyAmountMnt`, тодорхойгүй бол null — таамаглахгүй).
  **Багц ба ҮНЭ ЗАСАХ нь апп дотор БАЙХГҮЙ** — Entry Console `GET/PUT
  /api/platform/subscriptions` ба `/api/platform/plan-prices` (Bearer
  `ENTRY_PLATFORM_API_KEY`, timing-safe, зөвхөн saas; хаалга
  `lib/api/platform-auth.ts`, цөм `lib/billing/platform.ts` ба
  `lib/billing/pricing-store.ts`); SaaS харилцагч ба dedicated
  харилцагчийн удирдлага хоёулаа Console-д, апп дотор platform admin эрх
  ҮҮСГЭХГҮЙ (хольж хутгахгүй).
  Өөрчлөлт бүр аудитын мөрд (`subscription`).
  **QPay-ээр ӨӨРӨӨ төлөх** (`docs/billing/00-proposal.md` §6a — ЗААВАЛ уншина):
  `/settings/billing` эзэн/админ → skills/standard/platform, 1/3/6/12 сар
  (хөнгөлөлтгүй) → Entry-ийн ӨӨРИЙН QPay мерчант (`ENTRY_BILLING_QPAY_*` env,
  харилцагчийн POS QPay-тэй ХОЛБООГҮЙ) → webhook `/api/billing/qpay/webhook`
  эсвэл [Шалгах] → `markBillingPaymentPaid` НЭГ транзакцаар subscription
  `active` + `currentPeriodEnd` сунгана. ЦЭВЭР `lib/billing/self-pay.ts`
  (тесттэй), DB `payment-store.ts`. `active` + өнгөрсөн `currentPeriodEnd` =
  `past_due` (grace `graceDaysFor`: skills 3, бусад 14). Идэвхтэй хугацаанд
  багц/суудал солихгүй (пропорц зохиохгүй); read-only үед ч төлнө
  (`requireRole`, assertWritesAllowed-гүй); мөнгө хэзээ ч алдагдахгүй
  (хугацаа дууссан нэхэмжлэхэд ирсэн webhook ч `paid`). Console: `GET
  /api/platform/billing-payments` (бүх төлбөр, QR/нууцгүй — `platform-payments.ts`)
  **Туршилтын funnel** (Console): `GET /api/platform/trial-funnel[?from&to&product=
  accounting|skills]` — [from,to] мужид үүссэн байгууллагын когорт (default 90 хоног,
  ≤366): бүртгүүлсэн → AI холбосон (анхны OAuth/token) → мастер дата (анхны
  харилцагч/бараа/ажилтан; POS «Бэлэн худалдан авагч», цалингийн «Ажилчид» seed ХАСАГДАНА)
  → анхны журнал → төлсөн (анхны `paid` төлбөр, эсвэл Console-оос идэвхжүүлсэн).
  ДАРААЛСАН тоо + дараалал алгассан (`reachedAnyOrder`), хувь, медиан цаг, байгууллага
  бүрийн мөр; демо ба эзний НЭМЭЛТ компани когортод орохгүй; skills нь богино funnel.
  ЦЭВЭР `lib/platform/trial-funnel.ts` (тесттэй), DB `trial-funnel-store.ts` (НЭГ асуулга)
- **Дэмжлэгийн хандалт** (`docs/deployment/support-access.md` — ЗААВАЛ уншина;
  `lib/platform/support.ts` ЦЭВЭР + `support-store.ts` DB): платформын оператор
  харилцагчийн байгууллагад ТҮР орох цорын ганц зам. Эрх нь ХЭРЭГЛЭГЧИД биш
  **СЕССЭД** уягдана — апп дотор супер админ РОЛЬ, платформын хуудас БАЙХГҮЙ
  (дээрх дүрэм хэвээр). Линкийг ЗӨВХӨН Console олгоно (`POST /api/platform/
  support-sessions`, Bearer + saas-only), НЭГ хэрэглэгчид и-мэйлээр уягдана
  (данс ЗОХИОХГҮЙ), DB-д зөвхөн sha256 hash. Хоёр хугацаа: ашиглагдаагүй линк
  15 мин, идэвхжсэн сесс 1 цаг (дахин орох СУНГАХГҮЙ). Түвшин `viewer` (default,
  зөвхөн унших) | `admin`; **`owner` ХЭЗЭЭ Ч олгогдохгүй** тул байгууллага
  устгах / эзэмшил шилжүүлэх нь харилцагчийнхаа мэдэлд үлдэнэ; багцын
  read-only давамгайлна. `getActiveOrg` нь cookie (`ea-support`) хүчинтэй үед
  scope-оо ТЭР байгууллага болгоно; `getMyOrgs` ганц мөр (өөрийн байгууллага
  руу санамсаргүй бичихээс); MCP/REST token-ий зам ХЭРЭГЛЭХГҮЙ. Орох/гарах
  бүр `audit_events` (`support_session`) + эзэн/админд `security.support_access`
  instant мэдэгдэл — **дэмжлэгийн хандалт ХЭЗЭЭ Ч чимээгүй болохгүй**; топбарт
  ил баннер. Console-ийн байгууллагын дэлгэрэнгүй `GET /api/platform/
  organizations?id=` (`lib/platform/org-detail.ts`) — ЗӨВХӨН унших, нууц үг /
  token / лого / бизнесийн бичилт буцаахгүй. Тест `tests/support-session.test.ts`
- **Нууц үг сэргээх, и-мэйл баталгаажуулалт** (`lib/actions/account-recovery.ts`,
  `lib/account/`): token нь DB-д sha256 hash, нэг удаагийн, хугацаатай
  (сэргээх 1 цаг, баталгаажуулах 24 цаг — `AUTH_TOKEN_TTL_MS`); хуучин
  token дахин олгоход хүчингүй. **Баталгаажуулалт нэвтрэлтийг ХЭЗЭЭ Ч
  хаахгүй** — зөвхөн баннер + «Дахин илгээх»; багана нэмэгдэхээс өмнөх
  хэрэглэгч preDeploy-д нөхөгдсөн, урилгаар ирсэн / и-мэйл тохируулаагүй
  deploy-д бүртгүүлсэн хүн шууд баталгаажсан. Сэргээх хүсэлт хаяг
  байгаа эсэхийг задлахгүй (enumeration); rate limit 3/15 мин. Хуудас
  `/reset-password`, `/verify-email` нэвтрэлтгүй (proxy.ts
  `isPublicAccountPage`); системийн и-мэйл `lib/email/transactional.ts`
  (Resend тохируулаагүй бол `unconfigured`, шидэхгүй)
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

### 2a. Журналын бичилтийн дугаар — ХЭРЭГЖСЭН

Журнал нь БҮХ модулиас үүсдэг тул дугаар нь эх модулиа ил хэлнэ:

```
<МОДУЛЬ>-<YY>-<NNNNNN>     GL-26-000001 · CM-26-000042 · FX-26-000003
```

- **Жил бүр 1-ээс** эхэлнэ (сангийн жилийн дотор тасралтгүй); `NNNNNN` нь 6
  оронгоор 0-дуулсан, байгууллага дотор давхардахгүй (partial unique index —
  дугааргүй мөр хэдэн ч байж болно)
- **Модулийн кодууд** (`JOURNAL_MODULE_CODES`, ӨӨРЧЛӨХИЙГ ХОРИГЛОНО — бичигдсэн
  дугаар нь баримтын мөнхийн танигдахуун): GL · CM · FX · AR · AP · INV ·
  COST · FA · PROC · PAY · VAT
- **БУЦААЛТ эх журналынхаа модулийг ӨВЛӨНӨ** (`moduleOfVoucherNo`) — кассын
  баримтын буцаалт "CM-", элэгдлийн буцаалт "FA-" болж хос нь нэг модульд үлдэнэ
- **Тоолуур АТОМИК**: `document_counters` мөрийг
  `on conflict do update set value = value + n returning value`-ээр нэмэгдүүлнэ.
  `select max(...) + 1` ХОРИОТОЙ — зэрэгцээ транзакц ижил дугаар авна.
  Дугаарлалт нь журналаа бичиж буй ТРАНЗАКЦ ДОТОР явагддаг тул бичилт унавал
  тоолуур ч буцаж, цоорхой үүсэхгүй
- **Олон журналыг нэг дор** бичихэд (банкны хуулга) `nextVoucherNos` — scope
  бүрд НЭГ л хүсэлтээр блок нөөцөлнө (500 мөрт 500 биш)
- **Багана нэмэгдэхээс ӨМНӨХ бичилтүүд НӨХӨЖ дугаарлагдсан** —
  `scripts/backfill-voucher-numbers.mjs` (идемпотент, preDeploy дууддаг).
  Эх модулийг ТАЙЛБАРЫН ТЕКСТЭЭР ТААХГҮЙ: дэд дэвтрийн холбоосоор
  (`cash_documents.voucher_id`, `ar_ap_documents.voucher_id`,
  `fa_depreciation_entries.voucher_id`, `cost_entries`, `goods_receipts`,
  `purchase_orders.close_voucher_id`, `payroll_runs`, `bank_statement_lines`,
  `fixed_assets.disposal_voucher_id` …) → журналын мөрийн дэд дэвтрийн түлхүүр
  → externalRef угтвар → буцаалтын эх журнал → үлдсэн нь "gl".
  Дугаар нь ОГНООНЫ дарааллаар, аль хэдийн олгогдсоныг ХӨНДӨХГҮЙ
  (scope бүрийн max-аас үргэлжилнэ). Шийдвэрийн цэвэр логик:
  `scripts/lib/voucher-number-plan.mjs` (`tests/voucher-backfill.test.ts`)
- AI/MCP-ийн журналын tools дугаараар ЧУ олдоно (`resolveVoucherRef`:
  эхлээд documentNo, дараа нь ID угтвар)

```
lib/gl/voucher-no.ts   ЦЭВЭР (тесттэй): voucherNoScope, formatVoucherNo,
                       parseVoucherNo, moduleOfVoucherNo + DB давхарга
                       nextVoucherNo / nextVoucherNos
tests/voucher-no.test.ts  Жилийн хил, модуль тус бүрийн тоолуур, багц нөөцлөлт
```

**Шинэ бичилтийн зам нэмэхэд** `journalVouchers`-д insert хийх бүрд
`documentNo: await nextVoucherNo(tx, orgId, "<модуль>", <огноо>)` ЗААВАЛ өгнө.

### 2b. Журналын ВАЛЮТ (IAS 21) — ХЭРЭГЖСЭН

Баримтад **НЭГ валют, НЭГ ханш** (касс, АР/АП-тай ИЖИЛ загвар —
`journal_vouchers.currency` / `exchangeRate` / `rateSource` / `rateDate`).

```
Хэрэглэгч ВАЛЮТААР бичнэ  →  MNT нь ханшаар БОДОГДОНО  →  GL-д хоёулаа хадгалагдана
  journal_lines.debitFc/creditFc          journal_lines.debit/credit (ДЭВТРИЙН валют)
```

- **MNT-г гараар бичихийг зөвшөөрөхгүй** — валютын журналд MNT багана нь
  зөвхөн ХАРАХ (дүн ба ханш хэзээ ч зөрөхгүй). Баланс, тайлан, хаалт бүгд
  `debit`/`credit` (MNT)-ээр л бодогдоно — өөрчлөгдөөгүй
- **Сервер дахин бодно** (`resolveVoucherCurrency`, lib/actions/gl.ts):
  client-ийн MNT дүнд НАЙДАХГҮЙ — trust boundary
- **Тэнцэл ВАЛЮТААР** шалгагдана (`fcBalance`); мөр бүр тусдаа
  бөөрөнхийлөгддөг тул MNT нийлбэр 1–2₮ зөрж болно → **батлах МӨЧИД**
  зөрүүг ХАМГИЙН ТОМ мөрөнд ил шингээнэ (`convertLinesToBase`, НӨАТ
  inclusive-ийн largest-line absorb-тай ИЖИЛ дүрэм). Ноорогт шингээхгүй
- **Ханш огноогоор АВТОМАТ**: валют эсвэл огноо солигдоход тухайн өдрийн
  Монголбанкны албан ханш татагдана (§5b store-first, `fetchOfficialRate`).
  Олдохгүй бол ЗОХИОХГҮЙ — хэрэглэгч гараар оруулна; гараар өгсөн ханш
  `rateSource: "manual"` гэж ИЛ тэмдэглэгдэнэ
- **Журналын жагсаалт**: журнал ӨӨРӨӨ валюттай бол мөрд хадгалагдсан
  ЖИНХЭНЭ валютын дүнг үзүүлнэ (`fcFromLines`); хуучин бичилтэд эх баримтын
  ханшаар бодсон MNT ÷ ханш гэсэн ЛАВЛАГАА хэвээр

```
lib/gl/currency.ts        ЦЭВЭР (тесттэй): normalizeCurrency, assertRate,
                          convertLinesToBase (бөөрөнхийллийн шингээлт), fcBalance
lib/actions/gl.ts         resolveVoucherCurrency — create/update/post бүх зам
components/gl/journal-entry-form.tsx  Валют + ханшийн талбар, автомат таталт
components/journal/journal-lines-grid.tsx  Валютын Дт/Кт багана (MNT нь readonly)
tests/gl-currency.test.ts Хөрвүүлэлт, шингээлт, тэнцэл, гажиг оролт
```

### 2c. Хяналтын данс, батлагдсан журнал (SIM2) — ХЭРЭГЖСЭН

- **Батлагдсан журнал УСТГАГДАХГҮЙ** — `[USE_REVERSAL]`; засвар нь буцаалтаар
  (SIM2-046). Устгах нь зөвхөн ноорогт
- **Хяналтын дансанд гар журнал** (АР/АП/касс/бараа/ҮХ — `lib/gl/control-accounts.ts`)
  нь дэд дэвтэрээс зөрүү үүсгэдэг: `company_settings.control_account_guard`
  `warn` (default — `warning` буцааж toast) | `block`. AI/MCP сулруулж
  ЧАДАХГҮЙ (`[HUMAN_REQUIRED]`); `reconcile_modules` ийм журналуудыг жагсаана
- **Нээлтийн журнал** (`isOpeningBalanceVoucher`: externalRef `opening-*` /
  `[ОНБ`) кассын толин баримт, барааны «(бараагүй) × 0» ноорог ҮҮСГЭХГҮЙ —
  нээлт дэд дэвтэрт тусдаа бүртгэгддэг (SIM2-011/009)
- Sim harness: `tests/sim/README.md` — засварын дараа `compare.py` 0 зөрүү

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

### 3a. Сегментийн утгын стандарт жагсаалт + компанийн автомат сегмент

Тохиргоо → Ерөнхий журнал (`/settings/gl`) → "Сегментийн утгуудын жагсаалт".

- **Стандарт утга татах** (S2, S4, S5, S7, S8, S9, S10): жишиг лавлахыг
  `lib/constants/segment-defaults.ts`-ээс ачаална (S3 дансны "Стандарт данс
  нэмэх"-тэй ИЖИЛ хэв маяг) — байгаа КОДЫГ ХӨНДӨХГҮЙ, зөвхөн дутууг нэмнэ.
  Сегментийн тохиргооны табд "Бүх сегментийн стандарт утга татах" нэг товч
- **S1 (Компани) ба S6 (Группын дотоод) нь АВТОМАТ** — `organizations`
  бүртгэлээс бүрдэнэ, хоёулаа ЯГ ИЖИЛ код, ИЖИЛ нэртэй:
  - "Группын компаниуд" = тухайн байгууллагын эзэмшигч (owner) нь бусад
    ямар байгууллагыг ЭЗЭМШИЖ байна — үүссэн дарааллаар
  - Код нэг компанид НЭГ удаа хуваарилагдаж (101, 102…) ХЭЗЭЭ Ч
    өөрчлөгдөхгүй — журналд бичигдсэн posting код хоцрохгүй. Нэр солигдвол
    утгын НЭР дагаж шинэчлэгдэнэ (`segment_values.linkedOrganizationId` холбоос)
  - Хэрэглэгч гараар бичсэн ижил нэртэй утга байвал ӨВЛӨГДӨНӨ (давхардахгүй);
    бүртгэлээс гарсан компанийн утга УСТГАГДАХГҮЙ (түүхэн бичилт)
  - Ажиллах цэгүүд: `/settings/gl` хуудас нээх бүрд (идемпотент, өөрчлөлтгүй
    бол DB-д бичихгүй), компани үүсгэх/нэр солих, компанийн мэдээлэл хадгалах
- **S6 posting-ийн автомат default болохгүй** (`canAutoDefaultSegment`,
  `lib/gl/posting-code.ts`): жагсаалт нь S1-тэй ижил тул ганц утгатай үед
  өөрийгөө эсрэг тал болгон бичих эрсдэлтэй — segment-strategy §7.6.6 (s6 ≠ s1)

```
lib/constants/segment-defaults.ts  Стандарт утгын лавлах (ЦЭВЭР) — S2/S4/S5/
                                   S7/S8 (IAS 7)/S9 (модулийн тэмдэг)/S10
lib/gl/company-segments.ts         planCompanySegmentValues — ЦЭВЭР (тесттэй):
                                   код хуваарилалт, өвлөлт, нэрийн шинэчлэл
lib/gl/segment-sync.ts             DB давхарга ("use server" БИШ): компанийн
                                   sync + стандарт утга нэмэх
lib/actions/gl.ts                  syncSegmentDefaults / syncAllSegmentDefaults
tests/company-segments.test.ts     Идемпотент, нэр солих, давхардал, кодын урт
```

### 4. Period систем — ХЭРЭГЖСЭН

Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/02-period-close.md`
Код: `lib/periods/period.ts` (цэвэр логик), `lib/periods/guard.ts`
(`assertPeriodOpen`), `lib/actions/periods.ts`, `app/(dashboard)/settings/periods`

- Период = хуанлийн сар, код нь `YYYY-MM`; `open` → `closed`
- **Бүртгэгдээгүй сар = НЭЭЛТТЭЙ.** Период мөр нь ХААЛТ хийхэд л үүсдэг тул
  хаалт хийж эхлээгүй систем саадгүй ажиллана
- Хаагдсан периодод бичилт хийх хориотой. Хамгаалалт орсон замууд: GL
  create/post/unpost/update, cash post/reverse, FX тэгшитгэл post/reverse,
  AR/AP create/post, АР↔АП суутган тооцоо (offset + буцаалт), банкны
  хуулга импорт, FA элэгдэл post/reverse, өртөг post/reverse, зардлын
  хуваарилалт
- **Close/post race хамгаалалт:** post замууд транзакц дотроо
  `assertPeriodOpenInTx` (shared advisory lock, түлхүүр 5) дууддаг;
  `closePeriod` exclusive lock авч БҮХ дэд дэвтрийн ноорог (GL, өртөг,
  касс, АР/АП, бараа, элэгдэл) тухайн сард үлдсэн эсэхийг шалгаад хаадаг
- **Буцаалт нь ЭХ огноогоор** шинэ журнал бичдэг тул тэр периодыг шалгана
- Ноорог бичилт үлдсэн сарыг хаахгүй (ноорог хожим батлагдаж гацна)
- Шинэ бичилтийн зам нэмэхэд `assertPeriodOpen(userId, date)`-ыг ЗААВАЛ дайруулна
- **Огнооны нэгдсэн дүрэм** (`lib/periods/document-date.ts` ЦЭВЭР, тесттэй —
  SIM ENT-027/028/041/012/067):
  - `assertPeriodOpen*` нь **хуанлид байхгүй огноог** (2025-02-30) татгалзана
    (`assertCalendarDate`) — бичилтийн бүх зам нэг цэгээс хамгаалагдана
  - **Ирээдүйн САРЫН огноо батлагдахгүй** (`assertNotFuturePeriod` — GL
    create(posted)/post, касс, АР/АП, бараа батлах): ноорог хэвээр үлдэнэ;
    AI/MCP post горимд ч ноорог + тайлбар (`futurePeriodDraftNote`)
  - **Шинэ баримтын анхдагч огноо = topbar-ийн сонгосон сар**
    (`currentDocumentDate()`: одоогийн сар → өнөөдөр, өнгөрсөн → сарын сүүлийн
    өдөр, ирээдүй → 1-ний өдөр). Форм/диалог/панелийн анхны утгад л —
    SSR-д рендерлэгддэг input-д БИШ (hydration). `new Date().toISOString()`-оор
    баримтын огноо ӨГӨХИЙГ ХОРИГЛОНО
  - **Кассын нээлт** `cash_accounts.opening_date` (эхний үлдэгдэлтэй бол
    ЗААВАЛ) + `opening_rate` (валютын дансанд, хоосон бол албан ханш);
    нээлтийн журнал ТЭР огноогоор, валютын данс FC × ханшаар (`lib/cash/opening.ts`)

**Системийн хэмжээний периодын шүүлтүүр (topbar):**

- `components/periods/period-filter.tsx` — сарын сонгогч (топбарт монгол нэр
  «2026 · 9-р сар» — `fmtPeriodLabelMn`; дотоод код "JAN-26" `fmtPeriodCode`
  хэвээр) + муж (**Сар / Улирлын эхнээс / Оны эхнээс** = PTD / QTD / YTD —
  `PERIOD_SCOPE_NAMES_MN`) нь сонгогч цонхон ДОТОР. Layout-д НЭГ л удаа суусан.
  Дуу, горим, гарах нь профайл цэсэнд (`components/layout/user-menu.tsx`) —
  топбарын удирдлага ≤ 7 (UI гайдын карт 8)
- Сонголт cookie-д (`ea-period`) хадгалагдаж бүх хуудсанд дагаж явна;
  server хуудас `getPeriodSelection()`-оор уншина (`lib/periods/selection.ts`)
- Мужийн тооцоо: `lib/periods/scope.ts` `scopeRange(code, scope, today)` —
  PTD = зангуу сар, QTD = улирлынх нь эхнээс, YTD = оны эхнээс; дуусах огноо
  нь одоогийн сард ӨНӨӨДРӨӨР таслагдана ("to date")
- **Дүрэм:** URL-ийн ил параметр (`start`/`end`, `from`/`to`, `period`,
  `asOf`) сонголтыг ДАРНА — deep link хэвээр ажиллана. Cookie зөвхөн
  default өгнө
- Шинэ огноо-шүүлттэй хуудас нэмэхдээ: URL параметр → байхгүй бол
  `getPeriodSelection()`-ийн from/to — энэ хэв маягийг дагана
- **Monthly close** гол алхмууд:
  1. Элэгдэл бодох (FA)
  2. FX дахин үнэлгээ (валют)
  3. Accrual бичилт
  4. Period хаах → snapshot үүсгэх
- **Snapshot + delta (урт хугацааны хэмжээ):** хаалт бүрд GL
  (`account_period_balances`, П28) ба КАСС (`cash_account_period_balances`,
  дансны ВАЛЮТААР) хоёуланд хаалтын үлдэгдэл бичигдэж, дахин нээхэд устдаг.
  Уншигчид (`lib/reports/period-balances.ts` `loadBalanceRowsFast` /
  `loadMainBalancesFast`, `lib/cash/period-balances.ts` `loadCashBalancesFast`)
  = сүүлийн хаагдсан үеийн snapshot + түүнээс хойшхи SQL нийлбэр — баримт/
  ваучерыг JS-д ачаалахгүй. Snapshot байхгүй бол бүх түүхийг нийлж ЗӨВ (зөвхөн
  удаан); хаагдсан үе immutable тул хуучирдаггүй. Кассын хуудсууд зөвхөн
  snapshot-оос ХОЙШХИ баримтыг ачаална; задаргаанд «хаагдсан үеийн үлдэгдэл»
  нэг мөр. БАРАА (`inventory_period_balances`, бараа×агуулахын тоо хэмжээ):
  `lib/inventory/period-balances.ts` `loadQtyBalancesFast` / `loadQtyLedgerFast`
  — үлдэгдэл, тооллого, хасах үлдэгдлийн шалгалт (`findNegativeStock(…, initial)`)
  бүгд snapshot-оос replay хийнэ. ӨРТӨГ: `runPeriodicCosting` хаагдсан үеийн
  `cost_period_results`-ыг зангуу болгон (`lib/costing/period-anchor.ts` —
  хаалтын ДАРАА тооцоологдсон, тасралтгүй хаагдсан урьдал) зөвхөн түүнээс
  хойшхи периодыг дахин бичнэ. Хуучин хаагдсан үеүдэд
  `scripts/backfill-period-snapshots.ts` (идемпотент) нөхөж бичнэ — шинэ
  хувилбар deploy хийсний дараа ажиллуулна
- **Дараалсан хаалт/нээлт (snapshot-ын урьдчилсан нөхцөл):** өмнөх сар
  нээлттэй (бүртгэлгүй ч) бөгөөд түүнээс өмнө бичилт байвал хаагдахгүй
  (`previous-open`); зөвхөн хамгийн сүүлийн хаалттай үеийг дахин нээнэ
  (`later-closed`). Бараа хөдөлгөөн батлах/цуцлах/устгах, тооллого мөн
  `assertPeriodOpen`-оор хамгаалагдсан — хаагдсан үеийн snapshot хуучирдаггүй
- **Year-end closing entries:**
  - `Dr 51100000 Орлого → Cr 44000099 Орлогын дүн`
  - `Dr 44000099 → Cr 6/7/8XXXXXXX Зардал`
  - `Dr 44000099 net → Cr 44000001 Хуримтлагдсан ашиг`
- Татварын хуваарь: НӨАТ дараа сарын 10, НДШ дараа сарын 5, ААНОАТ улирлын дараа сарын 20

### 5. Өртгийн бүртгэл (Costing) — ХЭРЭГЖСЭН

**Баримт бичиг: `docs/cost/` — өртгийн логик хөндөхийн ӨМНӨ заавал уншина.**
`README.md` (change-control хүснэгт = батлагдсан шийдвэрүүд) →
`01-functional-specification.md` → `02-journal-posting-rules.md` →
`03-report-specifications.md` → `04-implementation-status.md` → `CLAUDE.md`.

Батлагдсан шийдвэрүүд (README change-control 0.2–0.3):

| Асуудал | Шийдэл |
|---------|--------|
| Өртгийн арга | **Зөвхөн** хугацааны жигнэсэн дундаж (Periodic Weighted Average). FIFO/LIFO/perpetual moving average/standard cost хориотой |
| Хамрах хүрээ (OD-001) | Бараа × агуулах × компани |
| Период (OD-002) | GL-ийн `accounting_periods` — хуанлийн сар |
| Нарийвчлал (OD-003) | Дундаж, дүнг `numeric(28,10)`-аар бүтнээр; бөөрөнхийлөлт зөвхөн харуулах/GL-д бичихэд |
| Зардлын хуваарь (OD-017) | 3 суурь, баримт бүрд сонгоно: үнийн дүнгээр / тоо хэмжээгээр / гараар |
| Өртөг бодох цаг (OD-019) | Худалдан авалт — батлагдмагц шууд. Зарлага/тохируулга/буцаалт — **сар хаахад** сарын дундажаар |
| Үнэгүй орлого | Тооллогын илүүдэл, буцаж ирсэн бараа нь сарын дунджаар үнэлэгдэнэ. Дундаж нь эхний үлдэгдэл + ӨРТӨГТЭЙ орлогоос л бодогдоно |
| Шилжүүлэг (OD-014, 0.9) | Эх агуулахын сарын дунджаар гарч, хүлээн авагчид ТЭР өртгөөр «өртөгтэй» орлого болно; хөдөлгөгч сар бүр хүрээнүүдийг хамаарлын дарааллаар бодно; нэг сард бие биерүүгээ шилжүүлсэн тойрог → ил шалтгаантай блок; GL бичилтгүй (данс нь барааных) |
| Блоклогдсон хүрээ (ENT-043) | ЗӨВХӨН өөрийн хөдөлгөөнийг зогсооно — бусад бараа-агуулах үнэлэгдэнэ; сар хаалт `unvalued-movements`-ээр хориглосон хэвээр |
| PO-гүй АП орлого (ENT-018) | Батлахад нэхэмжлэхийн мөрийн дүн × ханшаар `receipt_capitalize` НООРОГ (`ap_line`); гар үнэ ялна |
| Нээлтийн бараа (ENT-003 / SIM2-007, 1.0) | `create_opening_stock` / Excel «Нээлтийн үлдэгдэл»: баталгаажсан орлого (`sourceType "opening"`) + `receipt_capitalize` (`valuationSource "opening"`, данс ХАДГАЛАГДСАН: Dr нөөц / Cr 44000098 эсвэл ил өгсөн данс). D-OS-1: GL-д бичнэ — нээлтийн журнал барааг ДАВХАРДУУЛАХГҮЙ; D-OS-2: огноо нь нээлтийн бус анхны барааны гүйлгээнээс хожуу бол `[OPENING_AFTER_ACTIVITY]`; 0 өртөг хориотой. Батлах горимд багцад НЭГ журнал, эс бөгөөс ноорог бичилт (`postCostEntryCore` хадгалсан дансыг хүндэтгэнэ). Цэвэр `lib/inventory/opening-stock.ts` |

Хатуу дүрмүүд:

- **Дансны дугаар кодод хатуу бичихийг хориглоно** — `costing_account_settings`
  (клиринг, тооллогын илүүдэл/дутагдал, NRV) ба `costing_item_settings`
  (барааны нөөц/COGS данс)-аас уншина
- **Зарлагын төрөл** (`inventory_issue_types`) дебет чиглэлийг шийднэ; посting
  profile нь `fixed` (тогтмол данс) эсвэл `item_cogs` (барааны COGS данс)
- **Өртгийн бүрэлдэхүүн** (`cost_components`) нь хэрэглэгчийн лавлах — код
  дотор хаалттай жагсаалт байхыг хориглоно
- **Үнэ ХЭЗЭЭ Ч зохиохгүй.** Өртөггүй орлого, 0 боломжит үлдэгдэл, сөрөг
  үлдэгдэл → тухайн бараа-агуулах-сар ЗОГСОЖ, шалтгаан нь UI-д харагдана
- **Нэг л үнэлгээний суурь:** нөөцийн үнэлгээ, NRV-ийн харьцуулалт, өртгийн
  хяналтын тайлан гурвуулаа `cost_period_results`-ээс уншина
  (`lib/costing/valuation.ts`). GL-ээс өртөг бодохыг хориглоно
- **Нээлттэй шийдвэрийг кодод, migration-д, enum default-д, fallback данс
  эсвэл UI default-д НУУХГҮЙ** — product owner-оос асууна

**UI бүтэц (5 нав цэс):** Хяналтын самбар · Өртгийн бичилт · **Зардлын
хуваарилалт** (`/costing/allocations` — 2 таб: PO-ийн зардлын worklist /
чөлөөт хуваарилалт — `components/costing/costing-section-tabs.tsx` layout-д) ·
**Тайлан** (`/costing/reports` — 4 тайлан: Өртгийн хяналт / Үнэлгээ·NRV /
Гүйлгээний дэлгэрэнгүй+GL тулгалт / Бүрэлдэхүүн) · Тохиргоо. Тайлан бүр ӨӨРИЙН
route (өгөгдөл нь зөвхөн тэр хуудсанд ачаалагдана), хооронд нь ЗӨВХӨН топбарын
тайлан сонгогчоор шилжинэ — хуудас доторх таб БАЙХГҮЙ, сар нь топбарын периодоос
(«Тайлангийн стандарт»).
Хуучин `/costing/{control,detail,components,unallocated}` redirect хийнэ.
GL тулгалт ЗӨВХӨН "Гүйлгээний дэлгэрэнгүй" табд (үнэлгээний хуудсан дээрх
хоёр дахь хэрэгжилт давхардал байсан тул хасагдсан).

Гол файлууд:

```
lib/costing/
├── periodic.ts          Цэвэр PWA хөдөлгөгч (тесттэй) — C1/Орлого/Зарлага/C2
├── period-run.ts        Хөдөлгөөн → хөдөлгөгч → cost_period_results
├── period-close.ts      Сарын өртөг тооцох (зарлагыг дундажаар үнэлнэ)
├── allocation.ts        Нэмэлт зардлын хуваарь (3 суурь, тесттэй)
├── valuation.ts         C2-оос нөөцийн үнэлгээ / NRV суурь
├── master-data.ts       Зарлагын төрөл, бүрэлдэхүүн, дансны рольууд
├── transaction-detail.ts Гүйлгээний дэлгэрэнгүй + GL тулгалт
├── reconciliation-math.ts  ЦЭВЭР (тесттэй): дэд дэвтэр ↔ GL мөрийн бүтээгч.
│                        PO ХААЛТЫН журнал нь өртгийн бичилт БИШ ч гараар
│                        бичсэн мөр БИШ — тусдаа `poCloseAmount` баганаар ил
│                        гарч зөрүүнээс хасагдана (difference = дэд дэвтэр +
│                        PO хаалт − GL, docs/cost §5.7). Үгүй бол хаагдсан PO
│                        бүр капиталжсан дүнгээрээ ХУДАЛ зөрүү заана
├── clearing-objects.ts  ЦЭВЭР (тесттэй): GL-ийн клирингийн мөрийг бизнес
│                        объектод оноох дүрэм — ачаалагч хайлтын Map-ууд
│                        өгнө. БУЦААЛТ нь эх журналынхаа (reversalOfVoucherId)
│                        объектыг өвлөнө; АП-ийн мөрөөс үүссэн хөдөлгөөн
│                        (movement.sourceType="arap_line") тэр БАРИМТЫН
│                        объектод буудаг; хөдөлгөөнгүй үлдсэн өртгийн бичилт
│                        барааны нэрээр объект болно. Эдгээргүйгээр тэгширсэн
│                        хос хоёр объект болж "нээлттэй" гэж худал заадаг байв
├── clearing-reconciliation.ts  Клирингийн тулгалт — объект бүрийн
│                        Opening+Increase−Cleared=Ending; дансны нэгтгэл нь
│                        ТЭГШИРСЭН объектыг ч тооцно (данс 0.00 гэдгийг ил
│                        харуулна); unknownGross = Σ|үлдэгдэл| (цэвэр 0 байхад
│                        "асуудалгүй" мэт уншигдахаас сэргийлнэ)
├── component-analysis.ts Бүрэлдэхүүний задаргаа
└── costing.ts           Орлогын капитализаци + "үнэ хүлээж байгаа" жагсаалт
```

### 5a. Хангамж (Procurement — PO + landed cost) — ХЭРЭГЖСЭН

**Баримт бичиг: `docs/procurement/` — хангамжийн код хөндөхийн ӨМНӨ заавал
уншина.** `00-proposal.md` (дизайн §3–§5, БАТЛАГДСАН 2026-09-11) →
`01-implementation-contract.md` (функцийн нэр/параметр — зөрөхийг хориглоно).
Батлагдсан шийдвэрүүд `docs/cost/README.md` change-control **0.6**, норматив
шаардлага `docs/cost/01-functional-specification.md` §11
**FR-PROC-006 … FR-PROC-012**.

Худалдан авалтыг НЭГ объект (PO) болгож, хоёр түр дансаар хаалтыг хянана.
Өртгийн PWA хөдөлгөгч (`periodic.ts`, `period-run.ts`, `period-close.ts`)
ӨӨРЧЛӨГДӨӨГҮЙ — хангамж нь зөвхөн Inbound-ыг бүрдүүлнэ.

**Урсгал** (бичилт бүрийн Business Object = PO):

```
① PO үүсгэх (ноорог) → Батлах (open)        GL бичилт ҮГҮЙ (захиалга нь гүйлгээ биш)
② Хүлээн авалт (GR) — PO панелиас; нэхэмжлэхээс ӨМНӨ ч ДАРАА ч, хэсэгчилсэн
   Батлах → po_receipt орлого (confirmed) + АВТОМАТ receipt_capitalize
   дүн = тоо × PO нэгж үнэ × ХҮЛЭЭН АВСАН ӨДРИЙН Монголбанкны ханш
③ Нийлүүлэгчийн нэхэмжлэх (PO-той) — нэхэмжлэхийн өдрийн МБ ханш
   хөдөлгөөн ҮҮСГЭХГҮЙ (орлого ②-оос); хаагдсан PO → [PO_CLOSED]
④ Нэмэлт зардал (гааль, тээвэр, брокер…) — мөр бүрд бүрэлдэхүүн
   гаалийн татвар КАПИТАЛЖИНА; импортын НӨАТ капиталжихгүй → НӨАТ авлага
⑤ Хуваарилалт — "Хуваарилагдаагүй зардал" worklist; суурь 3, default СОНГОГДОХГҮЙ
   (PO-ГҮЙ зардлыг Өртөг → Зардлын хуваарилалт → Чөлөөт табаас хуваарилна:
    эх нэхэмжлэхийн мөрийг СОНГОЛТООР холбоно — холбовол клирингийн тулгалтад
    Dr/Cr нэг объектод тэгширч, Σ нь мөрийн үлдэгдлээс хэтрэхгүй)
⑥ PO хаах — нөхцөл биелсэн үед түр дансуудыг тэгшитгэнэ, зөрүү → ханшийн олз/гарз
⑦ Төлбөр — арилжааны банкны ханш (одоогийн касс логик, өөрчлөлтгүй)
⑧ Сар хаалт — тэр сард хүлээн авалттай НЭЭЛТТЭЙ PO байвал ХОРИГЛОНО
```

**PO-гүй жижиг худалдан авалт** — одоогийн зам хэвээр: АП бараатай мөр →
орлого → нэхэмжлэхийн дүнгээр капитализаци (нэг түр дансаар).

**GL бичилт** (дугаар кодод байхгүй — тохиргооны РОЛЬ):

```
② Хүлээн авалт батлах   Dr Барааны нөөц  (costing_item_settings)
                        Cr Бараа мат. түр данс (clearingAccountNumber)
③④ PO-той нэхэмжлэх     Dr Өглөгийн түр данс (apClearingAccountNumber)
                        Cr Өглөг (АР/АП-ийн одоогийн логик)
   импортын НӨАТ        Dr НӨАТ авлага (бүрэлдэхүүнгүй мөр, данс ИЛ)
⑤ Хуваарилалт          Dr Барааны нөөц / Cr Бараа мат. түр данс  (landed_cost)
⑥ PO хаалт             Dr Бараа мат. түр данс / Cr Өглөгийн түр данс
                        зөрүү → Dr Ханшийн гарз ЭСВЭЛ Cr Ханшийн олз
                        (fxLoss/fxGainAccountNumber) → хоёр түр данс PO-гоор 0
```

Гол файлууд:

```
lib/procurement/
├── constants.ts      PO_BUSINESS_OBJECT / PO_SOURCE_TYPE / PROCUREMENT_MODULE_KEY
│                     — литералын ЦОРЫН ГАНЦ эх сурвалж
├── close-lines.ts    buildPoCloseLines — ЦЭВЭР (тесттэй) хаалтын мөрүүд,
│                     ханшийн олз/гарз; чиглэл буруу бол ШИДНЭ (нөхөж бичихгүй)
├── po-math.ts        remainingToReceive / remainingToInvoice / poCloseBlockers
│                     — хаалтын нөхцөл, шалтгаан нь МОНГОЛ текстээр
├── types.ts          PurchaseOrderView / …Detail / GoodsReceiptView г.м. (plain)
└── load-data.ts      loadPurchaseOrders / …Detail / loadGoodsReceipts /
                      loadUnallocatedCostLines / loadProcurementDashboard

lib/actions/procurement.ts   PO CRUD + approve/cancel/close/reopen, GR
                             create/update/confirm/reverse/delete,
                             createApInvoiceFromPo, панелийн getter-ууд,
                             fetchOfficialRate, getLandedCostSummary
lib/cash/exchange-rates.ts   pickOfficialRate (цэвэр) + getOfficialRateForDate
                             — Монголбанкны албан ханш огноогоор (СУУРЬ ханш)
lib/costing/posting-helpers.ts  costing.ts-ээс ЗӨӨСӨН нийтлэг туслахууд
                                (itemAccountsFor, costingPostingCodeBuilder…)
```

Хатуу дүрмүүд:

- **Дансны дугаар кодод хатуу бичихийг хориглоно** — `clearingAccountNumber`
  (бараа мат. түр данс), `apClearingAccountNumber` (өглөгийн түр данс, default
  31000099), `fxGain/fxLossAccountNumber`, барааны нөөц/COGS нь
  `costing_item_settings`-ээс (JPR-006)
- **Бараа ХҮЛЭЭН АВСАН ӨДРИЙН албан ханшаар үнэлэгдэнэ** — нэхэмжлэх өөр
  ханштай байсан ч өмнөх капитализаци хөндөгдөхгүй; зөрүү нь PO хаалтад
  ханшийн олз/гарз болж ГАРНА (өртөгт шингэхгүй)
- **Ханш ХЭЗЭЭ Ч зохиогдохгүй** — `getOfficialRateForDate` олдохгүй бол
  ШИДНЭ, хэрэглэгч гараар оруулна
- **`po_receipt` хөдөлгөөнийг бараа материалын модулиас засах/устгах/цуцлах
  ХОРИОТОЙ** — зөвхөн Хангамж → Хүлээн авалт дээрээс буцаана. `/costing`-ийн
  гар үнэ оруулах жагсаалтад ч, `runCosting`-ийн receiptCosts-д ч ОРОХГҮЙ
  (аль хэдийн үнэлэгдсэн)
- **Бүх бичилт `businessObjectType: "purchase_order"` + `businessObjectId`-тай**
  байна (бичих мөчид, lineage-аас гаргаж авахгүй) — хоёр түр данс PO
  объектоороо тэгширнэ (FR-PROC-004)
- **Хуваарилалтын "үнийн дүнгээр" суурийн жин = PO мөрийн нийт үнэ** (D6 = (а)):
  өмнө хуваарилсан `landed_cost` жинд ОРОХГҮЙ → дарааллаас хамаарахгүй.
  Суурь урьдчилан СОНГОГДОХГҮЙ (OD-017), `manual`-д Σ таарахгүй бол хадгалахгүй
- **PO хаалтын нөхцөл** (`poCloseBlockers`): Σ хүлээн авсан = захиалсан, Σ
  нэхэмжилсэн тоо = захиалсан, Σ нэхэмжилсэн дүн (PO валют) = мөрийн дүн, бүх
  нэмэлт зардал хуваарилагдсан. Зөрүүг АВТОМАТААР нөхөхийг хориглоно — UI-д
  улаанаар харагдана
- **Дутуу хаалт** (ENT-064, `poShortClosePlan`, docs/cost 1.1): бараа бүрэн
  ирэхгүй бол `closePurchaseOrder({shortClose:{reason, writeOffAccount}})` /
  AI `close_purchase_order {shortClose}` / панелийн «Дутуу хаах» — `proc:post`,
  шалтгаан ЗААВАЛ (аудит, `short_close_reason`); хүлээн аваагүй үлдэгдэл
  `cancelled_quantity`; хүлээн авснаас илүү нэхэмжлэл → хэрэглэгчийн ИЛ
  сонгосон 6/7/8 зардлын данс (`poWriteOffAccountProblem`, кодод данс БАЙХГҮЙ),
  ханшийн зөрүү үүнийг хассан өглөгийн түр данснаас. Хүлээн авсан ч
  нэхэмжлээгүй бараа → ХОРИГЛОНО. Нэхэмжлэхийн тааз захиалсан тоо хэвээр,
  хүлээн авснаас илүүд анхааруулга (D-SC-2). Дахин нээхэд цуцлалт сэргэнэ
- **Нээлттэй PO-той сар хаалт** `costing_account_settings.open_po_close_mode`:
  `block` (default) | `warn` — хэсэгчлэн хүлээн авсан PO-той сарыг анхааруулгатай
  хаана (SIM2-023). Ноорог GR-ийг `delete_goods_receipt`; PO цуцлахад ноорог GR устна
- **Сар хаалт:** хүлээн авалттай нээлттэй PO байвал `closePeriod` код
  `open-purchase-orders`-оор татгалзана; ноорог хүлээн авалт бусад ноорогтой
  адил хаалтыг хориглоно (OD-011)
- Бичилтийн зам бүрд `assertPeriodOpen(orgId, date)` + транзакц дотор
  `assertPeriodOpenInTx` ПЕРВЫЙ; эрх `requireModuleAction("proc", …)`; статус
  шилжилт бүрд `logAuditEvent`
- **Хавсралт** нь нийтлэг `document_attachments` (entityType `purchase_order`,
  дараа бусад модульд ч); унших/татах зам ЗААВАЛ org шалгалттай (ID нь эрх
  олгохгүй); хаагдсан PO-д нэмж болно, устгахгүй
- **UI:** модулийн түлхүүр `proc` (`lib/constants/app-modules.ts`), нав бүлэг
  `procurement` (`components/layout/modules.ts` — самбар / Захиалга / Хүлээн
  авалт / Тайлан; "Хуваарилагдаагүй зардал" нь Өртөг модулийн Зардлын
  хуваарилалт табд `/costing/allocations` — хуучин `/procurement/costs` ба
  `/costing/unallocated` redirect хийнэ), панель `purchase-order` ба
  `goods-receipt`
  (`panel-registry.tsx`). Хүснэгт `DataGridDynamic`, статус `StatusBadge`,
  шүүлтүүр `FilterChips` / `PageTabs`, хоосон `EmptyState`, icon `Icon` /
  `IconAction`, батлах диалог `useConfirm` — шинэ component/icon бичихийг
  ХОРИГЛОНО; жагсаалт дээр давхар даралт → панель

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
- **Дүүргийн код = АЛБАН ЛАВЛАХААС СОНГОНО** (2026-09-26, `lib/ebarimt/district-codes.ts`
  ЦЭВЭР, client-safe, тесттэй): код = аймаг/дүүрэг (2) + сум/хороо (2) — Баянзүрх 3-р хороо
  **2403**, Чингэлтэй 5-р хороо 3505 (гараар андуурагдсан жишээ). Өгөгдөл
  `district-codes.json` (506) — мерчантын багцын `DISTRICT CODE.txt` (ТЕГ `getBranchInfo`
  хариу) → `node scripts/build-ebarimt-districts.mjs <файл>`. Серверээс `getBranchInfo`
  ДУУДАХГҮЙ (гео-хязгаар; хуучин parser хороо алгасаж 2 оронтой код гаргадаг байсан —
  хасагдсан). Жагсаалтад байхгүй 4 оронтой кодыг гараар оруулна — «шалгаагүй» гэж ил,
  ЗОХИОХГҮЙ; `get_ebarimt_status` кодын нэрийг хэлнэ
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
├── lookup.ts      ТЕГ-ийн нийтийн getTinInfo (РД → ТТД) + getInfo (ТТД → нэр)
│                  (24ц кэш; parse нь ЦЭВЭР, tests/ebarimt-lookup.test.ts)
├── district-codes.ts/.json  Дүүрэг/хорооны АЛБАН лавлах (506, client-safe) — тохиргооны сонгогч
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

Хэрэглэгч **эхний үлдэгдэл, өмнөх хугацааны бичилт** оруулахад ӨМНӨХ ҮЕИЙН
ханш хэрэгтэй болдог тул Монголбанкны ханш нь "өнөөдрийн татагдац" биш —
`exchange_rates` хүснэгтэд **ӨДРӨӨР** хадгалагдаж, дурын хуучин огноогоор
уншигдана. Хүснэгт нь **НИЙТИЙН лавлах**: `organizationId` БАЙХГҮЙ (ханш нь
нийтийн баримт), давхардлыг **unique INDEX** `(source, currency, date)`
хамгаална (`uniqueIndex`, constraint БИШ — drizzle-kit 0.31.x-ийн #5955 алдаа:
`unique()` constraint-ыг push дараагийн удаа танихгүй, бөглөөтэй хүснэгтэд
truncate асуулт тавьж preDeploy унагадаг).

**Монголбанкны албан ханш = системийн СУУРЬ ханш** — хүлээн авалт, нэхэмжлэх,
PO хаалт, FX тэгшитгэл бүгд албан ханшаар үнэлэгдэнэ (§5a, docs/procurement
§3.5). Арилжааны банкны ханш ЗӨВХӨН төлбөрт.

**Унших дараалал — STORE-FIRST** (`getOfficialRateForDate(currency, date)`):

```
(а) ЯГ тэр өдрийн хадгалагдсан ханш → шууд буцаана (сүлжээ хөндөхгүй)
(б) байхгүй бол Монголбанкнаас татна → ХАДГАЛНА → буцаана
(в) эх сурвалж унасан бол ≤10 хоногийн дотоод хадгалсан ханшаар нөхнө
(г) бас олдохгүй бол ШИДНЭ — ханш ЗОХИОХГҮЙ, хэрэглэгч гараар оруулна
```

- (а) нь **ЯГ таарсан огноо** шаарддаг: агуулах тэр огноог хүртэл дүүрээгүй
  байхад "≤ огнооны сүүлийнх" нь МБ-ийн бодит ханшнаас ЗӨРӨХ боломжтой
  (МБ амралтын өдөр ч мөр нийтэлдэг)
- **Амралтын / баярын өдөр:** `loadStoredRate` (ба цэвэр
  `pickLatestOnOrBefore`) нь огноо **≤ asOf** мөрүүдийн ХАМГИЙН СҮҮЛИЙНХ-ийг
  авна = өмнөх ажлын өдрийн ханш. Хүссэн огноо бүх мөрөөс өмнө бол `null`
- `MNT` → ханш 1 (сүлжээ хөндөхгүй); валютын код гажиг бол ШИДНЭ

**Түүх татах:** `POST mongolbank.mn/mn/currency-rates/data?startDate=&endDate=`
нь мужийн **ӨДӨР ТУТМЫН** мөрүүдийг буцаана (нэг жил ≈ 365 мөр × ~50 валют;
амралтын өдөр өмнөх ханшаар давтагдана). `fetchMongolbankHistory(from, to,
currencies?)` нь мужийг **365 хоногоор хуваан ДАРААЛАН** татна (МБ-ыг зэрэг
хүсэлтээр цохихгүй), огноо буруу / муж урвуу бол ШИДНЭ. Цэвэр
`parseMongolbankHistory` нь мөр бүрийн бүх хүчинтэй валютыг quote болгоно;
огноогүй / гажиг мөрийг чимээгүй алгасна — ханш ЗОХИОХГҮЙ.

Гол файлууд:

```
lib/cash/exchange-rates.ts   Татагч + parser (цэвэр, тесттэй) +
                             getOfficialRateForDate (СУУРЬ ханш, store-first).
                             `@/lib/db`-г import ХИЙХИЙГ ХОРИГЛОНО — client
                             component ч эндээс төрөл / rateForBasis уншдаг тул
                             postgres драйвер browser bundle-д орно
lib/cash/rate-store.ts       ТҮҮХИЙН давхарга (ЭНГИЙН модуль, "use server" БИШ —
                             action, cron, script гурвуул шууд дуудна):
                             saveExchangeRates (upsert), loadStoredRate (огноогоор),
                             loadStoredRates (муж), storedRateCoverage (хамрах
                             хүрээ), pickLatestOnOrBefore (ЦЭВЭР, тесттэй).
                             Import хийгдэх мөчдөө registerExchangeRateStore-оор
                             ӨӨРИЙГӨӨ бүртгэнэ (globalThis) — server талын дурын
                             модуль үүнийг import хийсэн даруйд ханшийн хайлт
                             ХАДГАЛСАНААС эхэлдэг болно
lib/actions/exchange-rates.ts  Ханшийн Server Actions: муж + валютаар татаж
                             хадгалах, хадгалагдсан түүх / хамрах хүрээ унших
                             (Core + ActionResult wrapper, эрх нь cash модуль)
app/(dashboard)/cash/rates   "Валютын ханш" хуудас: муж/валют сонгож татах,
                             хамрах хүрээ, хадгалагдсан мөрүүд (DataGridDynamic)
app/api/cash/exchange-rates/route.ts  ШУУД (live) 3 эх сурвалжийн (МБ / ХХБ /
                             Голомт) тухайн өдрийн ханш — тулгалтын
                             workspace-ийн quote хүснэгтэд; түүх БИЧИХГҮЙ
tests/rate-store.test.ts     Амралтын өдөр, гажиг огноо, сар/жилийн хил
tests/exchange-rates.test.ts parseMongolbank{Rates,History}, pickOfficialRate
```

Хатуу дүрмүүд:

- **ХАНШ ХЭЗЭЭ Ч ЗОХИОГДОХГҮЙ** — олдохгүй бол ШИДНЭ, хэрэглэгч гараар
  оруулна. Интерполяци, дундажлах, "сүүлд мэдэгдэж байсан ханшаар" чимээгүй
  нөхөх ХОРИОТОЙ; (в) нөхөлт нь 10 хоногоор хязгаарлагдсан ба `stored: true`
  гэж ИЛ тэмдэглэгдэнэ
- **Ханшийн уншилт бүр `getOfficialRateForDate`-аар** — модуль дотроо МБ-ыг
  `fetch`-ээр дуудахыг хориглоно (тэгвэл хадгалалт ба амралтын өдрийн дүрэм
  алдагдана)
- **upsert нь ХООСОН БИШ утгаар л дардаг** (`coalesce(excluded.…, одоогийн)`) —
  албан ханш татсан нь арилжааны банкны buy/sell баганыг УСТГАХГҮЙ
- **Нэг INSERT дотор ижил (source, currency, date) давхардвал урьдчилж
  нэгтгэнэ** (Postgres "cannot affect row a second time"); 500 мөрөөр chunk
- **`date` нь ханшийн ӨӨРИЙН огноо** (эх сурвалжийн `RATE_DATE`) — татсан
  хугацаа нь `fetchedAt`. Хоёуланг андуурахгүй
- Хүснэгт нийтийн лавлах тул **rate-store дотор эрхийн шалгалт БАЙХГҮЙ** —
  дуудагч server action `requireModuleAction` дайруулна
- Хадгалалт унасан ч ханшийн уншилт ЗОГСОХГҮЙ (агуулах нь кэш, эх сурвалж биш)

**FX тэгшитгэл — хэрэглэгчийн сонгосон огнооны ханшаар:**

- Хэрэглэгч тулгалтын workspace-д
  (`components/cash/cash-reconciliation-workspace.tsx`) **огноогоо ГАРААР**
  сонгоно → тэр огнооны quote-ууд гарч ирнэ → сонгосон quote нь мөрийн
  хаалтын ханш + ханшийн баримт болно; ханш сонгоогүй мөр батлагдахгүй
  ("хаалтын ханш оруулна"), гараар өгсөн ханшид шалтгаан ЗААВАЛ
- `postCashFxRevaluation` (lib/actions/cash.ts) нь `valuationDate`,
  `closingRate` дээр ханшийн баримтыг (`rateSource`, `rateBasis`, `sourceDate`,
  `sourceUrl`, `fetchedAt`, `manualOverrideReason`) хамт хадгална —
  тэгшитгэл бүр ямар огнооны ямар ханшаар бодогдсоныг дараа нь баталгаажуулна
- Ирээдүйн огноонд тэгшитгэл хийхгүй (Улаанбаатарын өнөөдрөөр); огноо
  `assertPeriodOpen` дайрна; журнал нь ТЭР огноогоор бичигдэнэ
- Тооцоо цэвэр: `calculateFxRevaluation(foreignBalance, closingRate,
  carryingAmount)` (lib/cash/reconciliation.ts) — зөрүү нь ханшийн олз/гарз
- **Carrying (GL ₮) = `fxCarryingAmount`** (ENT-023): GL данс НЭГ кассын
  дансанд л холбогдсон бол тэр GL дансны БҮХ мөр (тэмдэггүй гар нээлтийн
  журнал ч), олон кассын данс хуваалцвал зөвхөн тэмдэгтэй мөр — тэмдэггүй мөр
  байвал `[UNTAGGED_CASH_LINES]` гэж ЗОГСООНО (хаана хамаарахыг таахгүй)
- **reconcile_modules** валютын дансны нээлтийг (валютаар) ₮-тэй НЭМЭХГҮЙ:
  нээлтийн журналын ₮ → нээлтийн ханш → «ТОДОРХОЙГҮЙ» (`cashOpeningMnt`);
  ханшгүй бичигдсэн хуучин нээлтийн журналыг илрүүлнэ (ENT-020)
- **AI-ийн валютын баримт** (ENT-037/038/071): ханш өгөөгүй бол баримтын
  өдрийн албан ханш (ИЛ тэмдэглэнэ; олдохгүй бол `[RATE_REQUIRED]`); PO-гийн
  НЭМЭЛТ ЗАРДЛЫН нэхэмжлэх PO-гийн валютыг өвлөхгүй (харилцагчийн анхдагч)
- AI `run_fx_revaluation` нь гар ханш өгөөгүй үед тэгшитгэлийн огнооны албан
  ханшийг татна; олдохгүй бол `rate` параметр шаардана (зохиохгүй)

### 5d. Кредит нэхэмжлэл / дебит нэхэмжлэх (ENT-029) — ХЭРЭГЖСЭН

Шийдвэр: `docs/product/2026-09-audit-followup-proposal.md` §3 (D-CN-1…4 —
зөвлөмжөөр батлагдсан 2026-09-24). Нэхэмжлэхийн БУЦААЛТ нь тусдаа баримт:
`ar_credit_note` «Кредит нэхэмжлэл» (CN-), `ap_debit_note` «Дебит нэхэмжлэх»
(DN-) — дүн ЭЕРЭГ, эх нэхэмжлэхтэй (`source_document_id`), мөр бүр эх мөртэй
(`source_line_id`, хоёулаа SET NULL). Сөрөг мөртэй нэхэмжлэх ХЭРЭГЛЭХГҮЙ.

- **Төрлөөс хамаарах бүх шийдвэр `lib/arap/document-kind.ts`-д** (ЦЭВЭР):
  `arapLedger` (эрх, журналын модуль AR/AP), `controlSide` (хяналтын данс Дт/Кт),
  `settlementCashType` (үлдэгдлийг хаах мөнгө орох/гарах — касс, ханшийн
  олз/гарз, хуулгын импорт), `ledgerSign` (үлдэгдэл, KPI, тулгалт),
  `lineMovementType` (return_in / return_out), `offsetPair`. `=== "ar_invoice"
  ? … : …` гэсэн хоёр салаат шалгалт шинэ төрлийг АП руу чимээгүй унагадаг —
  ШИНЭ КОДОД ХОРИОТОЙ
- **GL:** кредит нэхэмжлэл Dr 51900001 «Борлуулалтын хөнгөлөлт» (АР-ын 5-бүлгийн
  мөр, сегмент нь эх мөрийнх; бусад мөр эх данс руугаа) + Dr НӨАТ өглөг / Cr
  авлага; дебит нэхэмжлэх Dr өглөг / Cr эх данс (клиринг/зардал) + Cr оролтын
  НӨАТ. НӨАТ-ын мөрийг хэрэглэгч сонгохгүй — буцаасан цэвэр дүнгийн хувиар
  (бүтэн буцаалтад үлдэгдэл бүтнээрээ); `computeVatReturn` өөрчлөгдөөгүй
- **Хязгаар:** буцаах тоо/дүн эх мөрийн ҮЛДЭГДЛЭЭС (батлагдсан бусад кредитийн
  дараа) хэтрэхгүй — үүсгэхэд `planCreditNote`, батлахад эх нэхэмжлэхийг
  `for update` түгжээд `creditOverrunError` ДАХИН шалгана. Кредит нь эх
  нэхэмжлэхийн ВАЛЮТ, ХАНШААР (ханшийн зөрүү үүсэхгүй); огноо ≥ эх огноо
- **Тооцоо (D-CN-3):** батлахад эх нэхэмжлэхийн нээлттэй үлдэгдэлд АВТОМАТААР
  (settlement хос, voucherId = кредитийн ӨӨРИЙН журнал, нэмэлт GL үгүй);
  илүүдэл = харилцагчийн кредит → кассаар буцаан олгох (зарлага) эсвэл
  `settleArApOffset`-оор дараагийн нэхэмжлэхтэй суутгах (Дт ↔ Кт хос).
  Энэ тооцоог `reverseArApOffset` БУЦААХГҮЙ — баримтыг буцаана
- **Бараа:** бараатай мөр батлагдмагц НООРОГ return_in (АР) / return_out (АП)
  хөдөлгөөн — сар хаалтад дунджаар үнэлэгдэнэ. «Тоо 0 + дүн» = бараа буцахгүй
  үнийн хөнгөлөлт
- **Хамгаалалт:** идэвхтэй кредиттэй эх нэхэмжлэхийг буцаах/устгахгүй
  (`[HAS_CREDIT_NOTES]`); батлагдсан кредитийг устгахгүй — буцаалтаар (тооцоо
  хамт сэргэнэ); кредитийн мөр/хяналтын данс засагдахгүй (`[CREDIT_LINES_LOCKED]`).
  POS-ийн нэхэмжлэх → `return_pos_sale`; PO-той нэхэмжлэх — ENT-064-тэй хамт.
  eBarimt-ийн засвар (D-CN-4) — дараагийн фаз

```
lib/arap/document-kind.ts        ЦЭВЭР: төрөл, дэвтэр, тал, чиглэл, хөдөлгөөн, суутгалын хос
lib/arap/credit-note.ts          ЦЭВЭР: planCreditNote, creditOverrunError, creditApplicationAmount
lib/arap/credit-note-db.ts       DB: эх ачаалах, буцаагдсан дүн, тооцоо хийх/буцаах (tx)
lib/actions/arap-credit-note.ts  getCreditNoteSource / createCreditNote (+ postNow)
lib/actions/arap.ts              батлах/буцаах/устгах/суутгал — төрлөөс үл хамаарах
components/arap/credit-note-dialog.tsx  панелийн «Кредит нэхэмжлэл» диалог
lib/ai/tools.ts                  create_credit_note (preview, lineNo)
tests/arap-credit-note.test.ts, tests/credit-note-flow.test.ts (DB)
```

### 5e. Авлагын ECL нөөц, найдваргүй авлага (ENT-065, IFRS 9) — ХЭРЭГЖСЭН

Шийдвэр: `docs/product/2026-09-audit-followup-proposal.md` §4 (D-ECL-1…4,
product owner 2026-09-25), `docs/cost/README.md` **1.2**. Хуудас Авлага → ECL
нөөц (`/receivables/ecl`, огноо = топбарын периодын төгсгөл).

- **Дансууд РОЛЬ** (`arap_ecl_settings`, ratified-seed): нөөц `12000099`
  (contra), зардал/сэргэлт `87000002`, DTA `26000001`, хойшлогдсон татварын
  зардал `70000004` — кодод хатуу бичихгүй
- **Хялбаршуулсан арга** — хугацаа хэтэрсэн хоногийн matrix (default 1/5/10/25/
  50/100%, хугацаа болоогүй нь эхний бүлэгт), байгууллага засна (admin + `ar:post`,
  аудит). Суурь = asOf-ийн байдлаарх батлагдсан АР нэхэмжлэлийн үлдэгдэл
  (тэр өдрөөс хойшхи тооцоо тоологдохгүй). Сарын журнал = шаардлагатай −
  GL-ийн нөөцийн үлдэгдэл, ЗААВАЛ НООРОГ (§9); дахин ажиллуулахад ноорог солигдоно
- **Хойшлогдсон татвар** (D-ECL-3): DTA = нөөц × байгууллагын ОРУУЛСАН ААНОАТ-ын
  хувь; хувь хоосон бол бодогдохгүй (ИЛ хэлнэ) — ХУВЬ ЗОХИОХГҮЙ. DTA данс бусад
  түр зөрүүтэй хуваалцдаг тул ECL-ийн мөр `businessObjectType "ecl_deferred_tax"`
- **Хасалт** (`writeOffArApDocument`, `ar:post`, шалтгаан заавал, зөвхөн `ar_invoice`):
  Dr нөөц (Кт үлдэгдлээр хязгаарлагдана — нөөц ХЭЗЭЭ Ч Дт болохгүй) + үлдэгдэл
  Dr зардал / Cr хяналтын данс; үлдэгдэл settlement-ээр хаагдана (`arap_write_offs`).
  Суутган тооцооны буцаалт хасалтыг буцаахгүй (`[USE_WRITE_OFF_REVERSE]`)
- **Сэргэлт** (D-ECL-4): Dr авлага / Cr ECL зардал → үлдэгдэл дахин нээгдэж
  ердийн кассын орлогоор хаагдана (`arap_write_off_recoveries`). Сэргэлттэй
  хасалт буцаагдахгүй (`[HAS_RECOVERY]`); сэргэлтгүйг эх огноогоор буцаана
- **Сар хаалтын checklist-ийн 5-р алхам** (`/close`, `get_month_end_checklist`):
  сарын эцсийн өдрийн шаардлагатай нөөц (+ DTA) GL-тэй тэнцсэн эсэх —
  `eclChecklistStatus` (ЦЭВЭР, тесттэй): ноорог батлагдаагүй → анхаарах, delta
  байгаа → хийгдээгүй, тэнцүү → бэлэн. Хаалтын ХОРИГ БИШ (ноорог нь drafts-аар
  хориглоно); төлөвлөгөөг `loadEclPlan` (ecl-db.ts) — ECL хуудастай НЭГ loader

```
lib/arap/ecl.ts            ЦЭВЭР (tests/arap-ecl.test.ts): matrix, planEclProvision,
                           eclJournalLines, splitWriteOff, recoveryProblem, view төрлүүд
lib/arap/ecl-db.ts         DB: loadEclSettings (seed), creditBalanceOf, loadEclOpenInvoices
lib/actions/arap-ecl.ts    getEclOverview / runEclProvision / saveEclSettings /
                           writeOffArApDocument / recoverArApWriteOff / reverseArApWriteOff /
                           listArapWriteOffs
components/arap/ecl-view.tsx, components/arap/write-off-section.tsx (АР панель)
tests/arap-ecl-flow.test.ts (DB)
```

### 6. НӨАТ (VAT) — 10% — ХЭРЭГЖСЭН

Knowledge: `entry-knowledge/01-онол-хууль-стандарт/tax/vat.md`, `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/vat-return.md`

```
Exclusive: Авлага = Нийт, Орлого = Нийт/1.1, НӨАТ өглөг = Нийт × 10/110
Тооцоо: payableVat = outputVat − inputVat
```

GL posting:
```
Борлуулалт: Dr 13110000 Авлага / Cr 51100000 Орлого + Cr 31410000 НӨАТ өглөг
Худалдан авалт: Dr Зардал + Dr 13620000 НӨАТ авсан / Cr 31000001 AP
Тооцоо: Dr 31410000 / Cr 13620000 / Cr 11000001 Банк (зөрүү)
```

Дараа сарын **10-нд** тайлан + төлбөр. Хоцорвол 0.1%/хоног.

Хэрэгжилт:

```
lib/vat/return.ts        Цэвэр логик (тесттэй): splitVat, applyInclusiveVatToLines,
                         computeVatReturn (сарын эргэлт: гаралт Cr−Dr, оролт Dr−Cr)
lib/vat/settings.ts      vat_settings loader (ratified-seed: 31410000/13620000, 10%)
lib/actions/vat.ts       getVatReturnData, createVatSettlementDraft (НООРОГ,
                         externalRef `vat-settlement:YYYY-MM` — сард нэг л удаа),
                         getVatLineDefaults (панелийн товчинд)
app/(dashboard)/vat/     Сарын тайлангийн хуудас (URL `period` парам cookie-г дарна)
```

- **Дансууд `vat_settings`-ээс** — кодод хатуу дугаар байхгүй; тохиргоо
  байхгүй бол default-аар мөр үүсдэг (ил, засварлагдахуйц)
- **АР/АП интеграци:** панелийн "НӨАТ 10% нэмэх" товч (exclusive, НӨАТ мөр
  нэмнэ/шинэчилнэ); AI `create_arap_invoice`-ийн `vatMode`
  (`exclusive`/`inclusive` — inclusive нь мөрүүдийг /1.1 болгож largest-line
  absorb бөөрөнхийллөөр НӨАТ ялгана). АР → 31410000 Cr, АП → 13620000 Dr
- **Тооцооны журнал** ЗААВАЛ ноорог (§9); буцаан авах үед оролтын үлдэгдэл
  дараа сард шилжинэ (гаралтын дүнгээр л offset хийнэ). Огноо = ТАЙЛАНТ ҮЕИЙН
  СҮҮЛИЙН ӨДӨР (ENT-035; хаагдсан бол татгалзана)
- **Тайлангийн эргэлт** (ENT-024/052/051): ГАРАЛТЫН НӨАТ-ын дансыг хөндсөн,
  бусад мөр нь зөвхөн оролтын НӨАТ + мөнгөн данс болох журнал (тооцоо, төлбөр —
  `isVatSettlementVoucher`) эргэлтэд ОРОХГҮЙ; гаралтыг хөндөөгүй «оролт + мөнгө»
  (гаалид бэлнээр төлсөн импортын НӨАТ, буцаан авалт) эргэлт ХЭВЭЭР; өмнөх саруудын илүү оролт = үеийн эхэн дэх max(0, оролтын Дт −
  гаралтын Кт) «шилжсэн кредит» (`carriedInputVat`) төлөх дүнгээс хасагдана;
  `/tax/vat` хуулга зөвхөн сонгосон сарын мөр

### 7. Цалин (Payroll) — Gross → Net — ХЭРЭГЖСЭН

Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/`

Хэрэгжилт:

```
lib/payroll/calc.ts      Цэвэр тооцоолол (тесттэй, worked-example.md-тэй тулгасан):
                         НДШ cap (доод цалин × үржүүлэгч), ХАОАТ effective date-ээр
                         (2025 flat 10% / 2026 шатлал 10-15-20% + хөнгөлөлт),
                         buildPayrollJournalLines (Dr=Cr тэнцвэртэй)
lib/payroll/additions.ts Нэмэгдэл/олговрын ЦЭВЭР тооцоолол (тесттэй): илүү цаг
                         1.5× / амралтын өдөр 1.5× / баярын өдөр 2.0× / шөнө
                         +20% (ХЗ 103·106·107·108), өмнөх N сарын дундаж
                         (previousPeriodCodes, averageMonthlyEarnings),
                         ээлжийн амралт (ХЗ 109), ХЧТА тэтгэмж
lib/payroll/settings.ts  payroll_settings loader (данс, доод цалин, cap, татваргүй
                         босго, коэффициент, сарын ажлын өдөр, дундажийн сар)
lib/payroll/settings-input.ts  Тохиргооны ЦЭВЭР шалгалт (тесттэй): хуваагч 0
                         болохгүй, коэффициент ХУУЛИЙН доод хэмжээнээс доошгүй
lib/payroll/payslip.ts   Ажилтны цалингийн хуудсын ЦЭВЭР бүтэц (тесттэй) —
                         олголт/суутгал/татваргүй хэсэг, илүү цагийн задаргаа;
                         Σолголт − Σсуутгал + ХЧТА ≠ гарт олгох бол ШИДНЭ
lib/actions/payroll.ts   Ажилтан CRUD, calculatePayrollRun (мөр бүр дахин бодогдоно,
                         засвар хадгалагдана), createPayrollVoucher (НООРОГ,
                         externalRef `payroll:YYYY-MM` — сард нэг),
                         loadPayrollSettingsView / savePayrollCalculationSettings /
                         savePayrollAccountSettings, getSalaryPaymentReport /
                         getPayslipReport
app/(dashboard)/payroll/ Цалин бодолт + Ажилтнууд + Тайлан + Тохиргоо
```

- **Дансууд `payroll_settings`-ээс** (default: доорх §7 схем) — кодод хатуу
  дугаар байхгүй; доод цалин/cap/татваргүй босго мөн тохиргооноос
- **Тохиргооны хуудас `/payroll/settings`** (Цалин → Тохиргоо, 2 таб):
  «Тооцоолол» — доод цалин, НДШ cap үржүүлэгч, татваргүй босго, сарын
  стандарт цаг, ажлын өдрийн норм, дундажийн сарын тоо, нэмэгдлийн 4
  коэффициент; «GL данс» — §7-ийн 7 роль + ХЧТА-ийн данс (сонголтоор).
  Шалгалт нь ЦЭВЭР (`validatePayrollSettings`): цагийн хөлс / өдрийн
  дунджийн ХУВААГЧ 0 болох, коэффициент хуулийн доод хэмжээнээс ДООШ орохыг
  ХОРИГЛОНО (дээгүүр тогтоож болно). Өөрчлөлт нь ДАРААГИЙН бодолтоос
  эхэлж үйлчилнэ — бодогдсон сарууд хадгалагдсан дүнгээрээ үлдэнэ
- **2026 татваргүй босго (800,000₮)** — `monthlyTaxFree` тохиргоо, default 0
  (хуулийн баталгаажуулалтын дараа хэрэглэгч идэвхжүүлнэ — 2026-updates.md)
- **GL журнал ЗААВАЛ ноорог** (§9: payroll post нягтланчийн баталгаажуулалт
  шаарддаг) — сарын эцсийн огноогоор, бусад суутгалтай бол 6 мөр
- **Тайлан `/payroll/reports`** — 2 харагдац (`view` параметр, таб солигдоход
  ЗӨВХӨН тухайн харагдацын өгөгдөл уншигдана): «Банкны олголт» (урьдчилгаа /
  сүүл, Excel) ба «Цалингийн хуудас» (ажилтны сарын задаргаа, A4 хэвлэлт —
  сонгосон нэг эсвэл бүгд; POS-ийн баримттай ИЖИЛ portal + body класс хэв маяг).
  Хуудсын дүн бүр бодолтын ХАДГАЛАГДСАН мөрөөс гарна (`buildPayslip` дахин
  бодохгүй) тул GL журнал, банкны олголттой үргэлж таарна; тэнцээгүй мөр
  хуудас болохгүй — тэр ажилтан алгасагдаж шалтгаан нь UI-д улаанаар гарна
- **Цалингийн хуудсыг И-МЭЙЛЭЭР** (2026-09-26): «Цалингийн хуудас» дээр
  «Бүгдэд / сонгосон ажилтанд и-мэйлээр илгээх» → `sendPayslipEmails`
  (`lib/actions/payroll-payslip-email.ts`) — ажилтан бүрд PDF хавсралт
  (`lib/pdf/payslip-pdf.tsx`, дэлгэцтэй НЭГ loader `lib/payroll/payslip-report.ts`).
  Дүрэм ЦЭВЭР `lib/payroll/payslip-email.ts` (тесттэй): эрх `payroll:post`;
  ЗӨВХӨН сарын цалингийн GL журнал БАТЛАГДСАН үед (`payslipEmailBlocker`);
  мэйлийн гарчиг/биед ДҮН БИЧИХГҮЙ (зөвхөн PDF-д); и-мэйлгүй / буруу хаягтай
  ажилтан ИЛ алгасагдана; илгээлт бүр (дахин илгээлт ч) аудит
  `payslip` / `email` (entityId `YYYY-MM:<ажилтан>`, дүнгүй) — «Илгээсэн»
  багана эндээс. Илгээгч нэхэмжлэхтэй ИЖИЛ (`resolveInvoiceSender`), Resend-ийн
  хурдны хязгаарт 600мс завсартай; нэг ажилтны алдаа бусдыг зогсоохгүй

**Нэмэгдэл, олговрууд — АВТОМАТ бодолт + гар засвар (нэг дүрэм):**

Хэрэглэгч ЦАГ / ХОНОГ-оо л оруулна, дүн нь `lib/payroll/additions.ts`-ээр
АВТОМАТААР бодогдоно. Дүнг гараар дарж бичвэл тухайн мөрд «гар» тэмдэг
(`*Manual` багана) асаж, ДАРААГИЙН бодолт тэр дүнг **ХЭЗЭЭ Ч дарж бичихгүй**
(хэрэглэгчийн засвар давамгайлна). Тэмдгийг арилгах хоёр зам: (а) харгалзах
цаг/хоногийг өөрчлөх, (б) мөрийн ⟲ «Дахин автомат бодуулах» товч.

| Нэмэгдэл | Орц | Томьёо (default) |
|----------|-----|------------------|
| Илүү цаг | `overtimeHours` | цагийн хөлс × **1.5** × цаг (ХЗ 103) |
| Амралтын өдөр | `restDayHours` | цагийн хөлс × **1.5** × цаг (ХЗ 107) |
| Баярын өдөр | `holidayHours` | цагийн хөлс × **2.0** × цаг (ХЗ 108) |
| Шөнийн ажил | `nightHours` | цагийн хөлс × **0.2** × цаг — зөвхөн НЭМЭГДЭЛ (ХЗ 106) |
| Ээлжийн амралт | `vacationDays` | өдрийн дундаж × хоног (ХЗ 109) |
| ХЧТА тэтгэмж | `sickDays` | өдрийн дундаж × хоног × ажилтны тэтгэмжийн % |

- **Дундаж цалин** = өмнөх `averageEarningsMonths` (default 12) сарын БОДИТ
  олголтын дундаж; өдрийн дундаж = сарын дундаж / `monthlyWorkDays`
  (default 22). Түүхгүй ажилтанд үндсэн цалин суурь болж, `averageMonthsUsed`
  = 0 гэж ИЛ тэмдэглэгдэнэ — дүн зохиогдохгүй
- **Коэффициент бүр `payroll_settings`-ээс** (`overtimeMultiplier`,
  `restDayMultiplier`, `holidayMultiplier`, `nightBonusRate`) — байгууллага
  хуулиас ДЭЭГҮҮР тогтоож болно, кодод хатуу тоо байхгүй
- **ХЧТА-ийн хувь ЗОХИОГДОХГҮЙ:** `employees.sickBenefitPercent` хоосон бол
  тэтгэмж автоматаар бодогдохгүй (`computeSickBenefit` → null) — хэрэглэгч
  хувийг ажилтны картад оруулах эсвэл дүнг гараар бичнэ
- **ХЧТА тэтгэмж нь НДШ, ХАОАТ-ын сууринд ОРОХГҮЙ** (ХАОАТ хууль 24) — нийт
  олголтод нэмэгдэхгүй, зөвхөн ГАРТ ОЛГОХ дүнд нэмэгдэж GL-д тусдаа дебет
  мөр болно (`sickBenefitAccountNumber`, тохируулаагүй бол цалингийн зардал)

**НДШ хувь:**

| | Ажилтан | Ажил олгогч |
|--|---------|-------------|
| Тэтгэвэр | 8.5% | 8.5% |
| Тэтгэмж | 0.8% | 1.0% |
| Ажилгүйдэл | 0.2% | 0.2% |
| ЭМД | 2.0% | 2.0% |
| ҮОМШӨ | — | 0.8–3.0% |
| **Нийт** | **11.5% (тогтмол)** | **12.5–14.7%** |

Ажил олгогчийн хувь нь ажилтан бүрд **АО-НДШ % нэг нэгдсэн тоо**
(`employees.employerSiPercent`, суурь 11.7 + ҮОМШӨ) — кодод ҮОМШӨ тусдаа
задардаггүй. Салбарын жишиг: оффис 12.5 (default), барилга 13.2, уул уурхай
14.2–14.7.

**НДШ дээд хязгаар:** Доод цалин × 10 (2025: 792,000 × 10 = 7,920,000₮)

```js
siCap = minimumWage × 10
cappedBase = Math.min(totalEarnings, siCap)
employeeSI = cappedBase × 11.5%
employerSI = cappedBase × employerSiPercent   // АО-НДШ % (ҮОМШӨ багтсан)
taxableIncome = totalEarnings − employeeSI
netSalary = totalEarnings − employeeSI − pit − otherDeductions + sickBenefit
```

Нийт олголт (`totalEarnings`) = үндсэн олголт (цалин × ажилласан/ажиллавал
зохих цаг) + ээлжийн амралт + илүү цагийн нэмэгдэл + бусад нэмэгдэл.
ХЧТА тэтгэмж энд ОРОХГҮЙ (татвар, шимтгэлгүй).

**GL posting (7 мөр):**
```
Dr 72100000 Цалингийн зардал       — нийт олголт
Dr 72100002 НДШ зардал (ажил олгогч)
  Cr 31420000 НДШ өглөг            — ажилтан + ажил олгогч НДШ
  Cr 31430000 ХАОАТ өглөг
  Cr 31500001 Цалингийн өглөг      — гарт олгох цалин
```

Тайлагнал: НДШ дараа сарын **5-нд**, ХАОАТ дараа сарын **10-нд**.

**Урьдчилгаа / сүүл цалин — сарын гарт олгохыг ХОЁР төлбөр болгоно:**

```
Урьдчилгаа  ажилласан цагаар, СУУТГАЛГҮЙ олгоно (сар дундуур)
Сүүл цалин  бүх нэмэгдэл/суутгал бодогдоод, НДШ ба ХАОАТ суутгагдсаны
            ДАРАА урьдчилгаа хасагдана
Тэнцэл:     урьдчилгаа + сүүл цалин = сарын нийт гарт олгох
```

- Нийт олголт нь ЦАГААС бодогдоно: үндсэн олголт (`цалин × ажилласан /
  ажиллавал зохих цаг`, ХАРЬЦААГААР — бөөрөнхийлсөн цагийн хөлсөөр
  үржүүлбэл хазайна) + ээлжийн амралт + бусад нэмэгдэл
- **Бусад суутгал нь татварын сууринд ОРОХГҮЙ** — НДШ, ХАОАТ бодогдсоны
  ДАРАА гарт олгохоос хасагдана (баганын дараалал үүнийг харуулна)
- Төрөл тус бүр НЭГТГЭСЭН өглөгийн нэхэмжлэх (ноорог `ap_bill`) болно —
  харилцагч нь авто-үүсэх «Ажилчид»; `externalRef` `payroll-{kind}:YYYY-MM`
  тул сард нэг л удаа. **КЛИРИНГ:** §7-ийн журнал Cr Цалингийн өглөг,
  нэхэмжлэх Dr Цалингийн өглөг / Cr Ажилтны өглөг, кассаас Dr Ажилтны
  өглөг / Cr Банк — зардал НЭГ л удаа бичигдэнэ
- Цалин олгох тайлан (`/payroll/reports`): сар + төрлөөр ажилтан тус бүрийн
  банк, данс, IBAN, олгох дүн + Excel (банкны багц шилжүүлэг)
- Тохиргоо (`/payroll/settings`): доод цалин, НДШ cap, **сарын татваргүй
  босго** (2026: 800,000₮ — хуулийн баталгаажуулалт хүртэл 0), стандарт
  ажлын цаг, нэмэгдлийн коэффициент, GL дансууд

### 7a. Үндсэн хөрөнгийн элэгдэл — САНХҮҮ + ТАТВАР зэрэг

Код: `lib/fa/depreciation.ts` (цэвэр, тесттэй), `lib/fa/settings.ts`,
`lib/actions/fa.ts`, `app/(dashboard)/fa/depreciation`.

**Хоёр элэгдэл ЗЭРЭГ бодогдоно** (`cit.md` §Татварын элэгдэл vs Нягтлан
бодохын):

| | Хугацаа | GL |
|--|---------|-----|
| Санхүүгийн (IAS 16) | `usefulLifeMonths` | **бичигдэнэ** |
| Татварын (ААНОАТ) | `taxUsefulLifeMonths` | **БИЧИГДЭХГҮЙ** — мэмо |

Татварын хувь хэмжээ хуулиас: барилга 5%/жил (240 сар), тоног төхөөрөмж
ба тээвэр 10% (120), компьютер 20% (60), биет бус 10% (120) — **кодод
зохиохгүй**, `scripts/backfill-fa-tax-life.ts` нь нэрээр ангилж чадаагүй
картыг 0 хэвээр үлдээж анхааруулна. Хуримтлагдсан элэгдэл нь хоёр талдаа
ТУСДАА хөтлөгдөнө; зөрүү нь IAS 12 хойшлогдсон татварын суурь болж
дэлгэцэд ил гарна.

**Элэгдлийн суурь** (`fa_settings.depreciationBasis`, БҮХ хөрөнгөд):

- `monthly` — сарын тогтмол дүн (default)
- `daily` — ашиглалтын НИЙТ өдрөөр хуваарилна: сар дундуур ашиглалтад
  орсон хөрөнгө тэр сард хувь тэнцүүлэн, 28/30/31 хоногийн сарууд өөр
  дүнтэй элэгдэнэ. Карт бүрийн `depreciationStartDate` (YYYY-MM-DD) нь
  хуваарилалтын эхлэл; хоосон бол эхлэх сарын 1-ний өдөр

**Нээлтийн хуримтлагдсан элэгдэл** (`lib/fa/opening.ts` ЦЭВЭР, тесттэй — SIM
ENT-002/049/066/046/001): карт `openingAccumulatedDepreciation` (+ татварын
`openingTaxAccumulated`) ба `openingAsOf` (cut-off, дүнтэй бол ЗААВАЛ)
хадгална — GL-д нээлтийн журналаар (Кт 20000002) орсон, карт GL бичихгүй.
Элэгдэл нээлтээс эхэлж cut-off сар хүртэл БОДОГДОХГҮЙ; данснаас хасалт
(`computeFaDisposal`), бүртгэлийн тайлан, самбарын тулгалт бүгд нээлт +
системийн батлагдсаныг тооцно. **Ашиглалтын хугацаа дуусмагц элэгдэл
ЗОГСОНО** (IAS 16.55, сарын индекс > хугацаа → 0; сүүлийн сар бөөрөнхийллийн
үлдэгдлийг хаана). Нээлтийн журнал (`opening-*` / `[ОНБ…]`) ҮХ-ийн ноорог
карт ҮҮСГЭХГҮЙ. Биет ҮХ-ийн анхдагч хос **20000001 / 20000002**
(`accumDepAccountFor`: биет бус 21000001 → 21000099); хуучин карт хэвээр.

**НЭГ товчоор GL:** сарын бүх элэгдэл НЭГ журнал болно (дансны хосоор
нэгтгэсэн мөрүүд) — хөрөнгө тус бүрд журнал үүсгэхгүй. Дахин бодоход
өмнөх журнал АВТОМАТААР буцаагдаж (буцаалтын журнал үлдэж аудитын мөр
бүрэн) шинэ ноорог үүснэ — давхар бичилт үүсэхгүй. AI
`post_fa_depreciation` мөн ижил замаар.

Жагсаалт нь ЗӨВХӨН тайлант үеийнхийг харуулна (topbar-ийн периодын
шүүлтүүр; URL-ийн `period` параметр дарна); багана: Dr/Cr данс, анхны
үнэлгээ, хуримтлагдсан, үлдэх өртөг, сарын элэгдэл, татварын элэгдэл,
элэгдсэн хоног, бодуулсан хэрэглэгч.

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

### 9a. AI tool давхарга — MCP + REST (апп доторх чат ХАСАГДСАН)

**2026-09-25: апп доторх AI чат (BYO API түлхүүр, Anthropic/OpenAI adapter,
`ai_messages`) хасагдсан.** Хэрэглэгч ӨӨРИЙН ChatGPT / Claude-оос MCP-ээр
(§9b) ижил tool давхаргаар ажиллана — Entry AI-ийн API зардал төлөхгүй,
хэрэглэгч түлхүүр хуулахгүй. Вэбийн `/ai` = «AI холболт» НЭГ хуудас
(`components/ai/ai-connect-view.tsx`): ① холбох заавар (`components/skills/
connect-guide` — AI нягтлантай НЭГ), ② бичилтийн горим (`lib/ai/write-mode.ts`
ЦЭВЭР, `write-mode-store.ts` DB, `actions/ai-write-mode.ts` — ноорог / шууд
бичих, `ai_settings.write_mode`, MCP ба REST-д НЭГ, аудитад бичигдэнэ),
③ token (Claude Code / Codex); мөн «Эхлээд ингэж асуу» бэлэн асуултууд
(`#starter-prompts`). `/ai/settings` → `/ai` redirect. Модулийн
түлхүүр `ai` ХЭВЭЭР (эрхийн бүртгэл хөндөгдөхгүй), нэр «AI холболт»; багцын
`ai` боломж ХАСАГДСАН (`mcp` + `knowledge` л). Топбарын AI товч, хөвөгч чат
панель, `actionMarker` байхгүй; `AiAction` төрөл (`action-markers.ts`) tool
үр дүн + AI бүртгэлд үлдсэн. АР/АП-ийн «eBarimt импорт» (PDF/зураг → сервер
Anthropic vision → ноорог, П24) мөн хасагдсан — хэрэглэгч баримтын зургаа
ChatGPT / Claude-даа өгөхөд `create_arap_invoice`-оор ижил ноорог үүснэ.
**Entry-ийн сервер AI-ийн API дуудахгүй, `ANTHROPIC_API_KEY` env байхгүй,
`@anthropic-ai/sdk` хамаарал үгүй.** Чат / серверийн AI буцааж нэмэхийг
ХОРИГЛОНО — MCP л.

**Анхны туршилт = AI-тай НЭВТРҮҮЛЭЛТ** (`lib/onboarding/first-run.ts` ЦЭВЭР,
тесттэй; DB `first-run-db.ts`; `components/dashboard/welcome-card.tsx`): нүүрний
ДЭЭД карт «Өөрийн компаниа 15 минутад Entry-д» — ① ChatGPT / Claude-даа холбох
(өөрийн компанид; OAuth идэвхтэй байгууллагад уягддагийг ил хэлнэ) → ② хуучин
датагаа өгөх (экспорт / Excel → данс, харилцагч, бараа, ажилтан) → ③ нээлтийн
үлдэгдэл + тэнцлийн шалгалт. Алхам бүр ӨГӨГДЛӨӨС ✓ (OAuth/token мөр —
хэрэглэгчийн түвшинд; харилцагч/бараа/ажилтан; журнал). **Демо компани картад
БАЙХГҮЙ** — зохиомол дата үнэ цэнийг хойшлуулж, холболтыг дахин хийлгэдэг; карт
харагдаж байхад `SetupChecklist`-ийн П20 демо мөр ч нуугдана (`showDemo={!welcome}`),
`tests/first-run.test.ts` статикаар барина. **Хөдөлгөөн** (CSS л, `globals.css`,
reduced-motion-д унтарна): баганууд ээлжлэн гарна (`ea-stagger`), ОДОО хийх алхам
(`activeStepKey` — эхний хийгдээгүй) өргөн + хүрээ пульс, дараагийнх бүдэг, ✓ болоход
нэг удаа «поп» (`StepBadge`, харсныг localStorage-д санана), хуулах товч 1.5 сек ✓
(`lib/hooks/use-copy-flash.ts`). Харагдах нөхцөл `shouldShowWelcome`: хаагаагүй
(`users.welcome_dismissed_at`, `dismissWelcome`), демо компани биш, 3 алхам
дуусаагүй, мөн туршилт эсвэл журналгүй байгууллага — идэвхтэй харилцагчид ХЭЗЭЭ
Ч гарахгүй. Демогийн нэр `DEMO_ORG_NAME` НЭГ эх. **Бэлэн асуултууд
`STARTER_PROMPTS`** (эхний 3 = нэвтрүүлэлт) нь нүүрний карт, `/ai`, «AI нягтлан»
нүүр, MCP `prompts/list` · `prompts/get` (ChatGPT / Claude-ийн «+» / «/» цэс) ба
`instructions`-ийн жишээ — нэг эхээс, багцаар (`accounting` / `knowledge`)
шүүгдэнэ; `id` = MCP нэр, ӨӨРЧЛӨХГҮЙ. Асуулт нэмэхэд зөвхөн энэ жагсаалтад.

MCP, REST API хоёулаа НЭГ tool давхаргаар (lib/ai/tools.ts, 149 core tool + custom/)
системийн бүх модульд ажиллана. Бүлгүүд:

| Бүлэг | Tools | Горим |
|-------|-------|-------|
| Үүсгэх | create_journal_voucher, create_arap_invoice, create_credit_note (нэхэмжлэхийн буцаалт — §5d), create_cash_transaction (applyTo-гоор нэхэмжлэхэд холбоно), create_inventory_movement, create_fixed_asset, pay_arap_document | ноорог (post горимд ≤10M шууд) |
| Засах/устгах | update_{journal_voucher,inventory_movement}, delete_{journal_voucher,cash_document,arap_document,inventory_movement,fixed_asset}, delete_counterparty (баримтгүй үед л), delete_inventory_item (хөдөлгөөн/АР-АП мөр/PO мөр/өртгийн бичилтгүй үед л), delete_cost_entry (ноорог — хожмын бичилт байвал татгалзана), activate_fixed_asset, record_inventory_count | засах зөвхөн ноорог; устгах — ноорог аль ч горимд, батлагдсан зөвхөн post горим + ≤10M |
| Батлах/буцаах | post_{journal_voucher,cash_document,arap_document,fa_depreciation,cost_entries}, confirm_inventory_movement, reverse_{journal_voucher,cash_document,fa_depreciation,cost_entry}, settle_arap_offset (АР↔АП суутган тооцоо — MNT, нэг харилцагч), close_period, reopen_period | ЗӨВХӨН post горим + ≤10M (assertPostMode/assertPostLimit) |
| Мастер дата | create_{gl_account,counterparty,inventory_item,warehouse,cash_account}, update_{counterparty,inventory_item} | аль ч горимд |
| ECL / найдваргүй авлага | get_ecl_provision (унших), run_ecl_provision (сарын ECL журнал НООРОГ), write_off_arap_document (reason заавал), recover_arap_write_off (§5e) | get/run аль ч горимд; хасалт, сэргэлт ЗӨВХӨН post горим + батлах хязгаар |
| Нээлтийн бараа | create_opening_stock (бараа × агуулах × тоо × нэгж өртөг, ≤1000 мөр, externalRef-ээр идемпотент — §5 ENT-003) | ноорог өртгийн бичилт; post горимд батлах хязгаар дотор бол батлагдаж НЭГ журнал |
| Тохиргоо | get_company_settings, update_company_settings (`aiPostLimitMnt` — §9-ийн батлах хязгаар: бууруулах чөлөөтэй, өсгөлт 1 тэрбум ₮ хүртэл, дээш нь зөвхөн вэбээс хүн (`[HUMAN_REQUIRED]`); `largeAmountAlertMnt` — D2 босго) | аль ч горимд (эрх: admin+) |
| Багц, төлбөр | get_billing_overview (багц, статус, бичих эрх + шалтгаан, суудал, боломж, trial/grace хугацаа — `/settings/billing`-тэй НЭГ loader `getBillingOverview`; ЗӨВХӨН унших, засах нь Console-д) | аль ч горимд (гишүүн бүр) |
| Сар хаалтын тооцоо | run_fa_depreciation, run_monthly_costing | ноорог үүсгэдэг тул аль ч горимд |
| Унших | list_* (10 — list_cost_entries: өртгийн бичилтийн ID-г эндээс), get_journal_voucher, get_trial_balance, get_stock_balances, get_counterparty_balance (aging-тэй) | — |
| Тайлан | get_income_statement, get_balance_sheet, get_cash_flow, get_ebalance_statements (Сангийн яамны e-Balance маягт СТ-1…СТ-4 — `lib/reports/ebalance.ts`), get_account_ledger — вэбийн тайлантай НЭГ цэвэр функц (lib/reports/) ашиглана; create_year_end_closing (жилийн хаалтын 3 ноорог, нэг жилд нэг л удаа) | тайлан унших аль ч горимд; хаалт ноорог үүсгэнэ |
| Batch | create_{counterparties,arap_invoices,cash_transactions,journal_vouchers}_batch, master data: create_{gl_accounts,inventory_items,employees,fixed_assets}_batch (max 100, partial success — Cowork анхны импорт), post_{arap_documents,cash_documents,journal_vouchers}_batch | create нь аль ч горимд, post нь post горимд |
| Тулгалт+урсгал | reconcile_modules (касс/АРАП/бараа/клиринг vs GL, шалтгаан+засвар зөвлөнө), get_workflow_guide (7 урсгалын зөв дараалал), import_bank_statement (мөрд `settleInvoice` — нэхэмжлэхийн төлбөр; `ewalletSettlement: true` — QPay settlement: түр данс → банк шилжүүлэг + шимтгэл, §5c) | импорт post горимд |
| Нэвтрүүлэлт | get_onboarding_guide (section: overview/checklist/rules/phases/status) — `docs/deployment/onboarding.md`-ийн §2/§3/§4-ийг үгчлэн + байгууллагын шат (0–5) ба дараагийн алхам (`lib/onboarding/`); MCP `instructions` анх холбогдоход үүнийг заана | унших, аль ч горимд |
| НӨАТ | get_vat_return (сарын тайлан), create_vat_settlement (тооцооны ноорог, сард 1) | тайлан аль ч горимд; тооцоо ноорог үүсгэнэ |
| Сар хаалт | get_month_end_checklist (10 алхмын статус, ECL нөөц орно — вэб: Системийн хяналт → Сар хаалт `/close`) | аль ч горимд |
| Цалин | create_employee, run_payroll (бодолт+нэгтгэл), get_payroll_summary, create_payroll_voucher (GL ноорог, сард 1) | бүгд ноорог үүсгэдэг тул аль ч горимд |
| Хангамж | create/update/list/get_purchase_order, create_goods_receipt, create_ap_invoice_from_po, create_cost_allocation, get_landed_cost_summary — мөн `create_arap_invoice`-ийн `purchaseOrder` / мөрийн `purchaseOrderLineId`, `unitPrice`, `costComponentCode` өргөтгөл | үүсгэх/унших аль ч горимд; approve/close/cancel_purchase_order, confirm/reverse_goods_receipt, reverse_cost_allocation нь ЗӨВХӨН post горим + ≤10M |
| Мэдэгдэл | list_notifications (inbox — уншаагүй/бүгд), mark_notifications_read (ids угтвар эсвэл all) — §9d; system prompt-ийн dynamic context-д уншаагүй тоо + хамгийн ойрын татварын хугацаа | аль ч горимд (журнал үүсгэхгүй) |
| Ханш | sync_exchange_rates (муж + валютаар Монголбанкны ТҮҮХ татаж `exchange_rates`-д хадгална), get_exchange_rate (тухайн огнооны албан ханш — хадгалсан → татна → ШИДНЭ) | аль ч горимд (нийтийн лавлах, журнал үүсгэхгүй) |
| POS | get_pos_status (+ э-хэтэвчийн түр дансны тулгагдаагүй дүн), update_pos_settings (үйл ажиллагааны тохиргоо — `allowNegativeStock` унтраах, хөнгөлөлтийн хязгаар, бөөрөнхийлөл, дансны рольууд, `ewalletFeeAccount`; eBarimt/QPay энд БАЙХГҮЙ), open_pos_shift, list_pos_sales, get_pos_sale, get_pos_sales_report (бараа/өдөр/кассчин/хэлбэр/харилцагч/дүрмээр, ахиуц), save_pos_payment_method / delete_pos_payment_method (төлбөрийн хэлбэрийн ЛАВЛАХ — eBarimt код оноох, буруу/давхардсан мөр цэвэрлэх; ашиглагдсан хэлбэр устахгүй, идэвхгүй болно) | аль ч горимд; create_pos_sale (нэг транзакц — АР+касс+зарлага+урьдчилсан COGS; `consumerNo`/`customerTin`/`customerRegNo`-оор eBarimt худалдан авагч), return_pos_sale, close_pos_shift нь ЗӨВХӨН post горим + ≤10M (ноорог байхгүй — бодит мөнгөн үйлдэл) |
| eBarimt | get_ebarimt_status (асаалттай эсэх, тохиргооны дутуу, хүлээгдэж байгаа/алдаатай тоо), resend_ebarimt (зассаны дараа дахин илгээх / ДДТД цуцлах), lookup_tin (РД → ТТД, B2B баримтад) | аль ч горимд (журнал үүсгэхгүй; илгээлт нь async) |
| QPay | get_qpay_status (асаалттай/тохируулсан эсэх, бэлэн байдлын дутуу, мерчант id, нээлттэй QR, төлөгдсөн ч борлуулалт болоогүй — нууц буцахгүй); холбох нь ЗӨВХӨН вэбээс [QPay холбох] | аль ч горимд (унших) |
| Мэдлэгийн сан | list_knowledge_topics (сэдвийн индекс — гарчиг + хэсгийн нэрс, ангиллаар), read_knowledge_section (НЭГ хэсэг, ≤3000 тэмдэгт, ишлэлтэй) — §9e; `surfaces: ["mcp"]` тул REST-д ГАРАХГҮЙ; `requireFeature("knowledge")` (Console-оос байгууллага бүрд), 24ц/200 квот `[KNOWLEDGE_LIMIT]` | аль ч горимд (унших; журнал үүсгэхгүй) |

ID-тэй tools бүгд бүтэн эсвэл 6+ тэмдэгтийн угтвар ID хүлээнэ;
нэхэмжлэх documentNo болон externalRef-ээр ч олдоно. Lookup нь сүүлийн
500–1000 баримтын цонхонд хайдаг — хуучин баримтыг бүтэн ID-гаар өгнө.

**Idempotency (externalRef):** create_{journal_voucher,arap_invoice,
cash_transaction} нь externalRef (eBarimt ДДТД, банкны гүйлгээний ID) авдаг —
ижил ref-тэй хоёр дахь дуудлага ШИНЭ баримт үүсгэхгүй, байгааг нь буцаана
(`dedup`, batch-д "алгассан"). DB талд (user_id, external_ref) partial unique
index гурван хүснэгтэд бий. Давхардлыг create_counterparty нэр
(case-insensitive) + ТТД-гээр мөн шалгаж [CONFLICT] буцаана.

**Алдааны кодууд:** tool-ийн алдаа `[CODE] текст` форматтай —
COUNTERPARTY_NOT_FOUND (ойролцоо нэрс санал болгоно), COUNTERPARTY_AMBIGUOUS,
ACCOUNT_NOT_FOUND, CONFLICT, AMOUNT_LIMIT_EXCEEDED, DIRECT_MODE_REQUIRED г.м.

```
lib/ai/
├── write-mode.ts      AiWriteMode (draft | post) — ЦЭВЭР; write-mode-store.ts DB
├── tools.ts           Tool JSON schema + executor-ууд — одоо байгаа server
│                      action-уудыг дуудна (шалгалт нэг газар)
├── action-markers.ts  AiAction төрөл (tool үр дүнгийн объект — AI бүртгэлд)
├── post-limit.ts      §9 батлах хязгаар (AsyncLocalStorage)
├── rate-limit.ts      MCP/REST-ийн tool дуудлагын хязгаар
└── crypto.ts          Нууц AES-256-GCM шифр (QPay түлхүүр г.м. — нэр түүхэн)

lib/actions/ai-write-mode.ts   saveAiWriteMode — /ai хуудасны горимын switch
components/ai/ai-connect-view.tsx  «AI холболт»: заавар · горим · token
```

Хатуу дүрмүүд:

- Tool executor алдаа ШИДЭХГҮЙ — модельд монгол текстээр буцаана
- Данс normalize нь paste/Excel-тэй ИЖИЛ (`normalizePastedAccount`)
- Харилцагч/бараа/данс НЭРЭЭР олдохгүй эсвэл олон таарвал алдаа + жагсаалт
  буцаана — модель таамаглахгүй, лавлах tool эсвэл хэрэглэгчээс асуана
- Үүссэн объект `[[EA_ACTION:{json}]]` маркераар контентод хадгалагдана —
  түүхээс дахин ачаалахад ч картууд харагдана
- Модель/горимын сонголт `ai_settings`-д хадгалагдана; provider нь
  сонгосон моделиос тодорхойлогдоно; OpenAI-д PDF хавсралт дэмжигдэхгүй

### 9b. MCP server — гадны Claude клиентэд нээх

Цөм: `lib/mcp/server.ts` (streamable HTTP, stateless JSON-RPC POST) —
хоёр route хуваалцана:

```
/api/mcp           Bearer header (Claude Code CLI):
                   claude mcp add --transport http --scope user \
                     entry-accounting https://<domain>/api/mcp \
                     --header "Authorization: Bearer <token>"
/api/mcp/<token>   Token нь URL-д (fallback зам)
```

**OAuth 2.1 (custom connector-ийн үндсэн зам):** claude.ai / Cowork-ийн
"Connect" товч стандарт урсгалаар холбогдоно — цөм нь `lib/oauth/server.ts`:

```
/.well-known/oauth-authorization-server   RFC 8414 metadata (path-aware)
/.well-known/oauth-protected-resource     RFC 9728 (401-ийн WWW-Authenticate заадаг)
/api/oauth/register                       RFC 7591 DCR (public client, нууцгүй)
/oauth/authorize                          Consent хуудас (standalone, login redirect
                                          callbackUrl-тэй), PKCE S256 ЗААВАЛ
/api/oauth/token                          code + refresh grant (rotation)
```

- Бүх нууц (code/access/refresh) sha256 hash-аар `oauth_*` хүснэгтүүдэд;
  code нэг удаагийн, access 7 хоног, refresh rotation-тэй
- MCP-ийн `resolveApiToken` `eak_` (PAT) болон `eoat_` (OAuth) хоёуланг танина
- proxy matcher `.well-known`-ийг алгасдаг; login redirect callbackUrl дамжуулдаг

- **Нэвтрэлт:** Personal Access Token (`eak_...`, AI холболт `/ai` → Token). DB-д зөвхөн sha256 hash (`api_tokens`); үүсгэхэд НЭГ л
  удаа бүтнээрээ харагдана; хэрэглэгч бүр дээд тал нь 5 token
- **Tools = REST-тэй ИЖИЛ давхарга** (`lib/ai/tools.ts`) — тусдаа
  логик ХОРИОТОЙ; шинэ tool нэмбэл хоёр замд зэрэг очно
- **Impersonation:** `runAsUser(userId, fn)` (lib/auth.ts, AsyncLocalStorage)
  — server action доторх `auth()` token-ий эзний session мэт хариулна.
  Cookie-той ердийн замд огт нөлөөгүй
- Бичилтийн горим `/ai` хуудасны switch — REST-тэй НЭГ тохиргоо (`ai_settings.write_mode`)
- proxy.ts-ийн matcher `/api`-г алгасдаг тул энэ зам login redirect-д орохгүй

### 9c. Fork нэвтрүүлэлт, custom/ өргөтгөл, REST API

Баримт: `docs/deployment/README.md` (playbook), `docs/deployment/api-integration.md`,
`custom/README.md`, `custom/CLAUDE.md`.

- **Харилцагч = GitHub fork.** Core шинэчлэлт `upstream-sync.yml` PR-аар
  (`vX.Y.Z` tag → `release.yml` GitHub Release). Хувилбарын эх сурвалж
  `package.json` → `lib/version.ts`; `/api/health` → `{version, sha}`;
  `/settings/system` хуудас; MCP `serverInfo.version`; REST `X-Entry-Version`
- **custom/ гэрээ:** харилцагч ЗӨВХӨН `custom/`-д бичнэ, core `custom/`-д
  ХЭЗЭЭ Ч бичихгүй. Entrypoint `custom/index.ts` → `mergeCustomizations(...)`;
  interface `lib/custom/types.ts`; loader `lib/custom/loader.ts` (шалгалт
  `lib/custom/validate.ts`, тесттэй). Core нь custom/-ийн тодорхой багцын
  нэр/зам hardcode хийхгүй
- **Tool нийлбэр:** `AI_TOOLS` = core; `allAiTools()` = core + custom — MCP,
  REST хоёулаа `allAiTools()` (замаар шүүх бол `aiToolsForSurface`) ашиглана. `executeAiTool`
  default → custom tool. Шинэ consumer нэмбэл `allAiTools()`
- **Мэдэгдлийн суваг** (фаз 2): `EntryCustomization.notificationChannels[]` —
  `NotificationChannel { key, label, deliver(ctx) }` (§9d); core Telegram-тай
  нэг sweep-ээр хүргэгдэнэ, тохиргооны матрицад автоматаар багана болно
- **Hook цэгүүд** (guardrail-ийн ДАРАА, транзакц дотор): `postVoucherCore` /
  `createVoucherCore(posted)` → `beforeJournalPost` (шидвэл rollback),
  commit + subledger sync дараа `afterJournalPost` (алдаа залгина);
  `closePeriod` → `beforePeriodClose` (`hook-rejected` код + reason). Hook
  байгаа хоригийг сулруулж ЧАДАХГҮЙ
- **Fork-ийн predeploy DDL:** `custom/predeploy.mjs` — `db:predeploy` нь
  `apply-pending-ddl`-ийн ДАРАА, `drizzle-kit push`-ийн ӨМНӨ
  `scripts/run-custom-predeploy.mjs`-ээр ажиллуулна (байхгүй бол алгасна,
  алдаа → deploy зогсоно). Fork `package.json`-д ГАР ХҮРЭХГҮЙ — 2026-09-25
  smartgps-ийн sync conflict-д `db:predeploy` мөр устаж build унасан.
  `tests/fork-sync-contract.test.ts` дараалал + conflict тэмдэг үлдэгдлийг барина
- **Theme:** `app/globals.css` нь `ui-kit/tokens.css`-ийн ДАРАА
  `custom/theme.css` import хийнэ
- **REST API v1:** `lib/api/v1.ts` — `GET /api/v1/tools`, `POST
  /api/v1/tools/<name>`; MCP-тэй ижил `resolveApiToken` + `writeModeOf` +
  `runAsOrg` + rate limit; `[CODE]` алдаа → 422 `{ok:false, code, error}`.
  Тусдаа логик ХОРИОТОЙ — tool давхаргаар л
- **Deployment-ийн лиценз:** production нэвтрэлт `ENTRY_LICENSE` (Console-оос
  олгосон гарын үсэгтэй, appUrl-даа уягдсан token) шаардана — offline шалгалт
  `lib/licensing/license.ts`, олгогч `scripts/issue-license.mjs` (нууц түлхүүр
  repo-д байхгүй); `next dev`-д шалгалтгүй. Дэлгэрэнгүй docs/deployment/README.md
- **Харилцагчийн repo үүсгэх:** `.github/workflows/provision-customer.yml`
  (workflow_dispatch; Entry Console — тусдаа `entry-console` repo — үүнийг
  dispatch хийнэ). Харилцагч = topic `entry-customer`-тэй `entry-<slug>` repo;
  тохиргоо repo variables (`ENTRY_DISPLAY_NAME`, `ENTRY_APP_URL`). Template
  repo ХОРИОТОЙ (түүхгүй → sync merge хийгдэхгүй)
- **Cowork master data импорт:** `.claude/skills/master-data-import/SKILL.md`
  (repo-д tracked — `.gitignore` `.claude/*` + `!.claude/skills/`), загвар
  `docs/deployment/master-data/*.csv`. Дараалал: данс → харилцагч → бараа/
  агуулах → касс → ажилтан → ҮХ → АР/АП нээлт → бараа нээлт → нээлтийн журнал
  (НЭГ ноорог, `externalRef: opening-balance:<огноо>`) → тулгалт

### 9d. Мэдэгдлийн систем (Notifications) — фаз 0–2 ХЭРЭГЖСЭН

Баримт: `docs/notifications/00-proposal.md` (D1–D7 батлагдсан 2026-09-19).
Шинэ модуль биш — байгаа дохиог (аудит, нүүрний «Анхаарах», татварын
хуанли, лиценз/token) хэрэглэгчид ХҮРГЭДЭГ давхарга.

```
lib/notifications/
├── catalog.ts        Төрөл → категори, severity, шошго, default суваг (ЦЭВЭР)
├── types.ts          NotificationDraft, NotificationAudience (client-safe)
├── rules.ts          АУДИТ → мэдэгдлийн гүүрийн дүрэм (ЦЭВЭР, тесттэй)
├── attention.ts      «Анхаарах» дохионууд — НҮҮР + SCHEDULER НЭГ ЭХ (ЦЭВЭР, тесттэй)
├── recipients.ts     Гишүүд × audience → userId[] (эрхээр, actor хасна; тесттэй)
├── preferences.ts    channels JSON тайлбар (ЦЭВЭР, тесттэй)
├── emit.ts           Бичих цэг — dedupe upsert, mutedUntil/in-app шүүлт; ШИДЭХГҮЙ
├── bridge.ts         notifyFromAudit — logAuditEvent-ийн хажууд, entity-owner шийднэ
├── load-attention.ts Scheduler-ийн оролт (SQL count/min — П28)
├── scheduler.ts      runDailyNotifications — org × өдөр нэг удаа (notification_runs)
├── ticker.ts         In-process default scheduler (instrumentation.ts, 15 мин):
│                     өдрийн дүрмүүд (08:00 УБ-аас) + tick бүрд и-мэйлийн хүргэлт
├── email-plan.ts     И-мэйлийн хүргэлтийн ЦЭВЭР төлөвлөгч: instant / digest (цаг,
│                     өдөрт нэг) / off (тесттэй)
├── email-delivery.ts Resend-ээр хүргэнэ — emailedAt, digest булаалт
│                     (notification_runs job="digest", periodKey="<өдөр>:<userId>");
│                     илгээгч = нэхэмжлэхийн илгээгчтэй ИЖИЛ эрэмбэ (resolveInvoiceSender)
├── channel-delivery.ts Нэмэлт сувгууд (Telegram + custom/) — notification_deliveries
│                     (мэдэгдэл × суваг нэг мөр: deliveredAt / error / "skipped:…")
├── channels/telegram.ts Core Telegram суваг (TELEGRAM_BOT_TOKEN; webhook ШААРДАХГҮЙ —
│                     холболт getUpdates-аар: /start <код> → «Холболт шалгах»)
└── open-entity.ts    CLIENT: entityType → панель / href dispatcher

lib/custom/types.ts NotificationChannel { key, label, defaultEnabled?, deliver(ctx) →
                    "sent"|"skipped" } — EntryCustomization.notificationChannels[]
                    (validate: key ^[a-z][a-z0-9_]{1,31}$, core in_app/email/telegram-тэй
                    давхцахгүй; loader customNotificationChannels)
lib/actions/telegram-link.ts        start / verify / unlink (өөрийн тохиргоо)
lib/email/notification-template.ts  ЦЭВЭР загвар (тесттэй): subject-д ДҮН БАЙХГҮЙ
                                    (stripAmounts хамгаалалт), text + HTML
lib/actions/notifications.ts        list / unread count / markRead / markAllRead
lib/actions/notification-preferences.ts  get / save (upsert user×org)
app/api/cron/notifications/route.ts Bearer CRON_SECRET; ?job=daily|email|all; ?date=
scripts/run-notifications.ts        Гараар ажиллуулах (дүрэм + и-мэйл)
components/layout/notification-bell.tsx   Топбарын хонх (60 сек polling)
app/(dashboard)/notifications             Inbox (DataGridDynamic, FilterChips)
app/(dashboard)/settings/notifications    Тохиргоо: категори × (хонх Switch, и-мэйл
                                          select off/instant/digest), digest цаг, түр дуугүй
tests/notification-{rules,attention,recipients,email}.test.ts
```

Хатуу дүрмүүд:

- **Call site-д `emit` ГАР дуудахгүй.** Шинэ бичилтийн зам `logAuditEvent`
  дуудаж байвал мэдэгдэл автоматаар гүүрээр гарна — мэдэгдэл болгох эсэхийг
  ЗӨВХӨН `rules.ts`-д (entityType × action → төрөл, audience) нэмнэ
- **Анхаарлын/хугацааны дүрэм ЗӨВХӨН `attention.ts`-д** — нүүрний «Анхаарах»
  блок (`dashboardAlerts`) ба өдөр тутмын scheduler (`dailyNotificationDrafts`)
  хоёул нэг `attentionSignals`-аас; «хугацаа хэтэрсэн», «хуучирсан ноорог»
  (7 хоног), татварын шат (7/3/1/0), лиценз (30/7/1/0)-ийн тодорхойлолтыг
  хоёр газар давтахыг хориглоно
- **Мэдэгдэл ХЭЗЭЭ Ч шидэхгүй** (`emit`, `bridge`) — бичилт унахаас мэдэгдэл
  алдагдах нь дээр; tx дотор дуудагдвал ижил executor-оор бичигдэж хамт
  commit/rollback болно
- **dedupeKey ЗААВАЛ** — дүрмийн «байгалийн үе» (`tax:vat:2026-09:3`,
  `overdue:ar:2026-W41`, `close-due:2026-09`); unique INDEX
  `(organizationId, userId, dedupeKey)` — constraint биш (#5955)
- **Actor өөртөө мэдэгдэхгүй**; хүлээн авагч нь модульд ≥ түвшний эрхтэй
  гишүүд л (`selectRecipients` ↔ `lib/permissions.ts`); `doc.posted` зөвхөн
  ноорог үүсгэсэн хүнд (D4); `period.closed/reopened` бүх гишүүнд (D5)
- **Scheduler request scope-гүй:** `cookies()`, `revalidatePath()`,
  `getActiveOrg()` дуудахгүй — org параметрээр; «өнөөдөр» Улаанбаатараар.
  Идемпотент булаалт `notification_runs` (job, periodKey, org) unique —
  cron route, ticker, script гурвуул зэрэг дуудсан ч НЭГ л ажиллана
- **Хадгалалт:** уншсан 90, уншаагүй 180 хоног (D6) — өдрийн ажил цэвэрлэнэ
- **И-мэйл (D1):** default — хугацаа/аюулгүй байдал/хаалт instant, бусад
  digest (каталогийн `email`); хэрэглэгч категори бүрд off/instant/digest
  сонгоно. `emailedAt IS NULL` мөрүүд (3 хоногийн цонх) tick бүрд шалгагдана;
  instant ≤15 мин, digest хэрэглэгчийн `digestHour`-т өдөрт нэг. Гарчигт дүн
  бичихгүй; RESEND_API_KEY байхгүй бол суваг чимээгүй идэвхгүй (in-app хэвээр)
- **Фаз 2 дүрмүүд:** `doc.large_amount` (D2 — босго
  `company_settings.largeAmountAlertMnt`, default 10M₮; post/create_posted-д
  гүүр дүнг tx executor-оор уншина — commit-оос өмнөх мөр харагдана; эзэн/админд),
  `ai.drafts_created` (`executeAiTool` → `notifyAiDraft`: AI/MCP/REST-ээс ноорог
  үүсвэл модулийн ≥post гишүүдэд, actor хасна), `invoice.viewed` (нэхэмжлэхийн
  нээлттэй хуудас — аудитын үйл явдал биш тул шууд emit, үл хамаарах №1),
  `settings.ai_limit_changed` (§9-ийн батлах хязгаар өөрчлөгдөх —
  `updateCompanySettings`-ээс шууд emit, эзэн/админд; **actor-ыг ХАСАХГҮЙ** нь
  үл хамаарах №2: аюулгүй байдлын хяналт тул AI/MCP-ээр өөрчлөгдсөн үед
  token-ий эзэн өөрөө тэр даруй харах ёстой),
  `pos.qpay_paid_unfinalized` (QPay төлөгдсөн ч борлуулалт болоогүй ≥10 мин, pos write),
  `bank.unmatched` (импортоос 3 хоног), `fx.reval_due` (сарын сүүлийн 3 хоног),
  `fx.rate_missing` (ажлын өдөр, МБ ханш алга), `stock.negative` (долоо хоног тутам)
- **Нэмэлт суваг:** tick бүрд `deliverPendingChannels` — суваг × мэдэгдэл нэг л удаа;
  тохиргоо категори бүрд `channels: { telegram: bool, <custom>: bool }`
  (`isChannelEnabled`, default = сувгийн `defaultEnabled`); Telegram холбоогүй
  хэрэглэгчид "skipped"
- Env: `CRON_SECRET` (cron route нээнэ, байхгүй бол 503; `?job=daily|email|channels|all`),
  `NOTIFICATIONS_TICKER=off` (in-process ticker унтраана), `RESEND_API_KEY` +
  `RESEND_FROM_EMAIL` (и-мэйл суваг), `TELEGRAM_BOT_TOKEN` (Telegram суваг)
- Фаз 3 (SSE realtime, web push/PWA, approval workflow) — саналын §8

### 9e. Мэдлэгийн сан — хэрэглэгчид хүргэх (Фаз 1–2 ХЭРЭГЖСЭН)

Баримт: `docs/knowledge/00-proposal.md` (D1–D7 БАТЛАГДСАН 2026-09-23) — ЗААВАЛ уншина.
Агуулга (`01-онол-хууль-стандарт`, `02-нягтлан-бодох-мэргэжлийн`,
`04-ai-agent/skills`) нь **ХУВИЙН repo `Tuguldur0107/entry-knowledge`**-д
(фаз 2, 2026-09-25) — core repo-д, fork харилцагчид ОЧИХГҮЙ; «AI нягтлан»
бүтээгдэхүүний гол агуулга. Production-д **Railway service `knowledge-sync`**
(эх нь `entry-knowledge` repo, Railway-ийн GitHub холболтоор — token-гүй, хугацаа
дуусахгүй) `main`-д push бүрд `sync/seed.mjs`-ээр `knowledge_articles`-д
ачаалаад гарна (`DATABASE_URL=${{entry-accounting.DATABASE_URL}}`; алдаанд exit 1 →
Crashed → Railway мэдэгдэл); хэрэглэгчийн MCP-д (ChatGPT / Claude)
**хэсгээр** уншигдана. Хэрэглэгчид файл хэзээ ч очихгүй. Core-ийн `knowledge/`
хавтсанд зөвхөн `03-стандарт` (хөгжүүлэлтийн лавлагаа) үлдсэн.

```
scripts/lib/knowledge-parse.mjs  ЦЭВЭР parser (тесттэй): frontmatter, `## ` = хэсэг,
                                 slug (`ifrs/ias-16`), ангилал замаас, хамрах хүрээ
scripts/seed-knowledge.mjs       preDeploy сүүлийн алхам: эх сурвалж KNOWLEDGE_REPO
                                 (tarball) → KNOWLEDGE_DIR/./knowledge → алгасна (fork);
                                 upsert (slug, section), sha256 алгасалт; устгалт ЗӨВХӨН
                                 эх сурвалж БҮРЭН үед (санг хэзээ ч хоослохгүй)
scripts/lib/knowledge-source.mjs ЦЭВЭР (тесттэй): extractTarFiles (pax/кирилл зам),
                                 isCompleteKnowledgeSource, normalizeKnowledgeRepo
lib/knowledge/catalog.ts         ЦЭВЭР (тесттэй): тогтмол, clampSection, formatTopicIndex /
                                 formatSection, normalizeTopicSlug (path traversal татгалзана)
lib/knowledge/store.ts           DB: list/read/countReadsToday/recordRead/stats — эрхийн
                                 шалгалт БАЙХГҮЙ (нийтийн лавлах), дуудагч шалгана
lib/ai/tools.ts                  list_knowledge_topics / read_knowledge_section
```

Хатуу дүрмүүд:

- **Хандалт ЗӨВХӨН багцын `knowledge` боломжоор** (`plans.ts`, D2′ 2026-09-24):
  SaaS-ийн нягтлан бодох багц бүрд ҮНЭГҮЙ; dedicated-д OFF; систем
  ашиглахгүй хэрэглэгч **«AI нягтлан» (`skills`)** — 29,000₮/сар, trial 24 цаг,
  `/register?plan=skills`. Захиалгын бүтээгдэхүүн тул read-only үед хаагдана
  (`featureUsable`). Кодод `if plan === …` ХОРИОТОЙ (billing дүрэм хэвээр).
  НЭВТЭРСЭН хэрэглэгч энэ линкийг нээвэл proxy самбар руу ҮСЭРГЭХГҮЙ
  (`lib/auth-redirect.ts`, тесттэй) — бүртгэлийн хуудас «багцад аль хэдийн
  багтсан → холбох заавар» / «гараад шинэ бүртгэл» сонголт харуулна
  (`components/skills/skills-signed-in.tsx`). Console хэрэглээг
  `GET /api/platform/subscriptions` (`knowledgeReads30d`, `oauthConnections`,
  `lastConnectorUseAt` — Console-ийн «AI нягтлан» хуудас) ба байгууллагын
  дэлгэрэнгүйн `aiAccountant` (уншилт, OAuth холболт, сүүлд ашигласан) — ТОО л
- **`skills` багцад нягтлан бодох систем (`accounting` боломж) ХААЛТТАЙ** — хямд
  багцаар бүх системийг үнэгүй ашиглах зам болохоос сэргийлнэ: `requireModuleAction`
  (уншилт ч, `assertModuleEntitlements`), `ModuleGuard`, AI/MCP tool
  (`lib/billing/tool-scope.ts` `ACCOUNTING_FREE_TOOLS` — `tools/list` шүүлт +
  `executeAiTool` хаалт), вэб нүүр = НЭГ хуудас (`components/skills/skills-home.tsx`:
  давуу тал → ① төлбөр/сунгах (`SkillsPay`, QR диалог нь billing-тэй НЭГ) →
  ② холбох); `/settings/billing` нүүр рүү redirect, топбарын багцын баннер гарахгүй. Шинэ
  tool нэмэхэд skills-д нээх эсэхийг ЗӨВХӨН `ACCOUNTING_FREE_TOOLS`-оор шийднэ.
  Тест `tests/billing-skills.test.ts`, `tests/skills-plan-flow.test.ts` (DB)
- **Хэсгээр л** — «бүгдийг буцаах» параметр, сэдвийг бүтнээр өгөх зам НЭМЭХГҮЙ;
  хэсэг `KNOWLEDGE_MAX_SECTION_CHARS`-аар таслагдвал ИЛ хэлнэ
- **`surfaces: ["mcp"]`** — REST-д ГАРАХГҮЙ (`aiToolsForSurface("rest")`
  жагсаалт ба дуудлага хоёуланд шүүнэ). Шинэ tool consumer нэмбэл
  `aiToolsForSurface(<зам>)`, `allAiTools()` шууд БИШ
- Уншилт бүр `knowledge_reads` (аудит БИШ); 24ц квот `KNOWLEDGE_DAILY_READ_LIMIT`
  DB-ээс тоологдоно — in-memory rate limit ХЭРЭГЛЭХГҮЙ (олон instance)
- AI хариултдаа ишлэлээ ЗААВАЛ дурдана; санах ойгоос таахгүй (system prompt)
- **Фаз 2 ХИЙГДСЭН (2026-09-25):** агуулга `entry-knowledge` хувийн repo-д; fork-ын
  preDeploy эх сурвалжгүй тул юу ч ачаалахгүй. Production-ийг ЗӨВХӨН `knowledge-sync`
  service бичнэ — `entry-accounting`-д `KNOWLEDGE_REPO*` env ТАВИХГҮЙ (хоёр бичигч
  болж parser зөрвөл хэсгүүд устаж/үүснэ). Core-ийн tarball зам
  (`KNOWLEDGE_REPO` + `KNOWLEDGE_REPO_TOKEN`) нь нөөц / dedicated sync-д үлдсэн.
  **`entry-knowledge/sync/knowledge-parse.mjs` = `scripts/lib/knowledge-parse.mjs`-ийн
  ИЖИЛ хуулбар** — parser өөрчилбөл хоёуланг нь; `knowledge_articles`-ийн багана
  өөрчилбөл `sync/seed.mjs`-ийг хамт. Бүрэн биш эх сурвалж (01, 02, 04-skills
  гурвуулаа биш) → DB ХЭВЭЭР, устгахгүй. Сонголт (§6.4, хийгдээгүй): dedicated
  харилцагчид `ENTRY_LICENSE`-ээр sync
- **Хөгжүүлэлтэд:** `entry-knowledge`-ийг core-ийн хажууд `../entry-knowledge` болгон
  clone хийнэ (Claude Code web-д repo-г session-д нэмнэ); `CLAUDE.md`-ийн
  `entry-knowledge/…` лавлагаа тэр repo-г заана. Локал DB-д:
  `KNOWLEDGE_DIR=../entry-knowledge node scripts/seed-knowledge.mjs`

### 10. Effective date (татвар/цалины тооцоололд)

Knowledge: `entry-knowledge/02-нягтлан-бодох-мэргэжлийн/guardrails/effective-date.md`

- Татварын хувь, НДШ, ХАОАТ bracket-ийг **огноогоор** lookup хийнэ
- Хамаарах огноогүй тооцоолол хийхгүй — хэрэглэгчээс асууна

---

## UI стандарт

### Дизайн токен — эх сурвалж

```
ui-kit/tokens.css          ← ЦОРЫН ГАНЦ ЭХ СУРВАЛЖ (:root = light, .dark = dark)
   ├─→ app/globals.css     @import — бүтэн систем эндээс авна
   └─→ ui-kit/preview.html статик preview (dev server хэрэггүй, WCAG контраст тооцно)
```

Өнгө/сүүдэр/радиус өөрчлөх бол **зөвхөн `ui-kit/tokens.css`**. Component дотор
hex/rgba бичихийг хориглоно. Заавар: [ui-kit/README.md](ui-kit/README.md).
Амьд component gallery: `/settings/ui-kit`.

### Өнгө аяс

```css
body: var(--ea-bg) | card: var(--ea-surface) | border: var(--ea-border)
primary: var(--ea-primary) | danger: var(--ea-danger) | success: var(--ea-success)
text: var(--ea-text-1) | secondary: var(--ea-text-3)
```

**Семантик өнгө — текст vs дэвсгэр:**

| Хэрэглээ | Токен | Шалтгаан |
|----------|-------|----------|
| ТЕКСТ (амжилт/аюул/анхааруулга) | `--ea-success-fg` / `--ea-danger-fg` / `--ea-warning-fg` | Суурь өнгө цайвар surface дээр 2.5–3.8:1 — AA давахгүй |
| Дэвсгэр, хүрээ, дүрс, chart | `--ea-success` / `--ea-danger` / `--ea-warning` | Дүүргэлтэд контраст шаардлага бага |

**Dark mode:** суурь нь тас хар (`--ea-bg: #000`), цэнхэр нь **зөвхөн accent**
(товч, линк, focus, сонгосон мөр). Цэнхэрийн ханалт 62% — тас хар дээр неон
гэрэлтэхээс сэргийлнэ. Контраст 8.17:1 (AAA).

### Хөвөгч ажлын панель (зөөх · хэмжээ · хавсралт)

`components/panel/floating-panel.tsx` — панелийн ЦОРЫН ГАНЦ жааз.

- **Зөөх:** гарчгаас чирнэ; **хэмжээ:** 4 ирмэг + 4 булангаас татна. Чирсэн
  мөчид панелийн бодит тэгш өнцөгт `panel.rect`-д бүртгэгдэж, цаашид байрлал
  ЗӨВХӨН түүнээс тооцогдоно (`slot`-ийн CSS хэрэглэгдэхгүй) — нэг байрлалд
  хоёр эзэн байхгүй. ⟲ «Байрлалыг сэргээх» товч анхны суудалд буцаана
- **Геометр нь ЦЭВЭР** `lib/ui/panel-geometry.ts` (тесттэй): анхны байрлал,
  чирэлт, хэмжээ солилт, хил. Панель дэлгэцээс БҮРЭН гарахгүй
  (`PANEL_KEEP_VISIBLE` = 160px гарчиг үргэлж харагдана), topbar-ын доогуур
  орохгүй, `PANEL_MIN_WIDTH`/`HEIGHT`-ээс доош шахагдахгүй; цонх жижгэрэхэд
  панель дотогш эргэж орно. Component дотор шинэ геометр бодохыг ХОРИГЛОНО
- Чирэлт **3px хөдөлсний ДАРАА** эхэлнэ — гарчгийн давхар даралт (дэлгэц
  дүүрэх) болон товчнуудтай мөргөлдөхгүй; дэлгэц дүүрэн үед чирэлт унтарна
- **Хавсралт панельд НЭГ МӨР:** `components/attachments/attachment-section.tsx` —
  `Хавсралт [төрөл ▾] [⬆ Файл хавсаргах] [📎 Хавсралт харах · N]`. Жагсаалт нь
  ЗӨВХӨН popup-д; хавсралтгүй үед «харах» товч идэвхгүй бөгөөд **хоосон блок
  (EmptyState) панельд ХЭЗЭЭ Ч гарахгүй** — гол агуулгыг доош түлхэхийг
  хориглоно. Панель дотор `AttachmentList`-ийг ШУУД суулгахгүй; бүтэн таб
  байгаа газарт л шууд (PO панелийн «Хавсралт» таб)
- **Хавсралтын логик НЭГ л газар** (`attachment-list.tsx`): `useAttachments`
  (төлөв + хуулах/устгах — дуудагч бүр НЭГ controller, давхар fetch хийхгүй) +
  `AttachmentUploadBar` / `AttachmentRows` харагдах хэсгүүд. Шинэ байрлал
  нэмэхдээ эдгээрийг compose хийнэ, хуулалт/устгалтыг дахин бичихийг ХОРИГЛОНО

### Баримтын төлөв, тоо, утасны карт (UI гайд)

- **Төлөв** — `lib/status.ts` `DOCUMENT_STATUS` ЦОРЫН ГАНЦ бүртгэл (шошго, өнгө,
  дүрс, хэлбэр: ноорог тасархай, буцаагдсан зураастай, `--ea-reversed*` токен).
  Жагсаалтад `col({ eaType: "status", field: "status" })` (зөвхөн дүрс, tooltip +
  aria-label), дэлгэрэнгүйд `DocumentStatusBadge`. Хуудас бүрд өөрийн
  STATUS_LABELS/tone map бичихийг ХОРИГЛОНО
- **Үйлдлийн нэр:** «Ноорог хадгалах» / «Батлах»; «сторно» БИШ «буцаалт»
- **Тоо:** `readonly-money` 0 → «—», сөрөг «−» + улаан (`ea-negative`); хуудасны
  гол тоо `fmtMntCompact` («13.95 сая ₮», title-д бүтэн дүн) — НЭГ л ширхэг
- **Маягтын мөрийн grid** (`journal-lines-grid`, `arap-lines-grid`) шүүлтүүр,
  эрэмбэлэлтгүй (`FORM_GRID_COL_DEF`)
- **Утас (<640px):** жагсаалт хүснэгтийн оронд `MobileCardList`
  (`useIsMobileViewport`) — төлөв · нэр · дүн, дарахад десктопын давхар даралттай
  ижил панель. Одоо: журнал, АР/АП баримт
- **Латин UI текст** `tests/ui-latin-text.test.ts`-ээр сахиулагдана (allowlist-тэй)

### Тайлангийн стандарт — ЗААВАЛ мөрдөнө

Бүх тайлан (GL, касс, насжилт, бараа, POS, ҮХ, өртөг, хангамж, цалин) НЭГ
зарчмаар ажиллана (2026-09-24 — өмнө нь зарим нь топбараар, зарим нь хуудас
доторх табаар ӨӨР тайлан руу шилждэг, зарим нь өөрийн огнооны талбартай,
зарим нь хөл дүнгүй байв):

1. **Тайлан СОЛИХ = ЗӨВХӨН топбарын сонгогч** (`HeaderReportSelect`).
   Жагсаалтын ЦОРЫН ГАНЦ эх нь `lib/constants/report-registry.ts` — шинэ
   тайлан = нэг мөр. Нэг хуудсанд параметрээр солигддог модуль `param`-тай
   (GL `report`, Бараа `tab`, Цалин `view`); сонгогч огнооны параметрийг л дагуулна
2. **Хуудас доторх таб = НЭГ тайлангийн ЗҮСЭЛТ л** (Бараагаар / Өдрөөр,
   Дансаар / S8 / Дэлгэрэнгүй, урьдчилгаа / сүүл) — өөр тайлан руу шилжүүлэх
   таб ХОРИОТОЙ
3. **Огноо = ЗӨВХӨН топбарын период** — тайлан дотор огнооны input /
   «Шинэчлэх» товч / сарын сонгогч тавихгүй; URL-ийн `start`/`end`/`period`/
   `asOf` нь deep link-ээр л дарна (§4). Үр дүнгүй сар руу ЧИМЭЭГҮЙ шилжихгүй —
   хоосон төлөв юу хийхийг заана
4. **Жааз** `components/reports/report-layout.tsx`: дээрээс доош тогтмол
   `ReportHeader` (гарчиг = registry-ийн нэр, `meta` = `reportRangeLabel`
   + тайлбар, баруун талд Excel/хэвлэх) → `ReportToolbar` (`views` зүсэлт →
   `filters` шүүлтүүр) → хүснэгт (`height="flex"`) эсвэл `ReportEmpty`
5. **Хөл дүн** (`pinnedBottomRowData`) нийлбэр УТГАТАЙ багана бүрд: валют
   холимог бол валют бүрд мөр, хэмжих нэгж холимог бол тоо хэмжээгүй,
   нэгж өртөг/дундаж/хувь хоосон (NaN → formatter «»), нэг мөр олон бүлэгт
   тоологдох бол давхардалгүй нийлбэр

`tests/report-standard.test.ts` сахиулна: тайлангийн route бүр registry-д,
registry-ийн href бодит хуудас, тайлангийн view-д огнооны input / «Шинэчлэх»
байхгүй, `ReportPage`/`ReportHeader` хэрэглэсэн, хасагдсан шилжүүлэх табууд
эргэж ирээгүй. Шинэ тайлангийн view нэмбэл тестийн `REPORT_VIEWS`-д бүртгэнэ.

### Таб ба шүүлтүүрийн chip

`components/ui/tabs.tsx` — хуудас доторх таб/шүүлтүүрийн **ЦОРЫН ГАНЦ**
хэрэгжилт; өөрийн tab markup бичихийг хориглоно:

- `<PageTabs size="sm|md" trailing={...} />` — доогуур зураастай хэсгийн таб
  (option бүр `disabled` дэмжинэ)
- `<FilterChips />` — дугуй статус шүүлтүүр (`count` тоолуур, `tone="warning"`)

Хэрэглэгдэж буй газрууд: AI тохиргоо, касс/бараа жагсаалт, дансны тохиргоо
(2 түвшин), өртгийн тохиргоо. Амьд жишээ: `/settings/ui-kit`.

### Формын талбар (FormField / SwitchField)

`components/ui/form-field.tsx` — Label + input + hint жааз, Switch + гарчиг +
тайлбар. Форм/диалог бүрд өөрийн `Field`, `SwitchField` бичихийг ХОРИГЛОНО
(POS тохиргоо, хөнгөлөлтийн дүрэм, ээлжийн диалог үүгээр). Амьд жишээ
`/settings/ui-kit` → «Form элементүүд».

### Popup / Modal

```
Overlay: rgba(0,0,0,0.4)
Content: #fff, border-radius 8px, box-shadow
Header: гарчиг + × товч | Footer: [Болих] [Хадгалах]
Хаах: × товч / Болих / overlay дарах / Esc
```

### Destructive үйлдэл

```
Устгах → confirm диалог: [Болих] [Устгах]
Ашиглагдсан данс устгах → анхааруулна
```

---

## Хүснэгтийн стандарт (AG Grid Community)

Бүх хүснэгтийн UI **AG Grid Community v35**-д суурилдаг. `<table>`, shadcn `<Table>`,
эсвэл custom CSS grid-ээр шинээр хүснэгт бичихийг хориглоно.

### Эх сурвалж файлууд

```
components/datagrid/
├── DataGrid.tsx          Wrapper (theme, keyboard, clipboard, undo/redo defaults)
├── DataGridDynamic.tsx   dynamic(ssr:false) — БҮХ callsite энийг import
├── ComboFilter.tsx       Багана шүүх combo фильтер
└── datagrid.css          Grid стайл

components/account/       Дансны нэгдсэн component-ууд (бүх модульд)
├── account-segment-picker.tsx  Идэвхтэй сегмент бүрд searchable dropdown
└── account-input.tsx           Гараар бичих + ⌄ товчоор сегмент picker popover

components/journal/
└── journal-lines-grid.tsx      Журналын мөрийн хүснэгт (Данс/Дт/Кт/Тайлбар) —
                                GL journal entry ашиглана, Cash/VAT/Payroll-д reuse

lib/grid/                 Туслах модулиуд (wrapper биш)
├── types.ts              ColumnTypeId, EaColDef, RowMeta, BatchPatch, HistoryEntry
├── registerGrid.ts       AG Grid module registry (DataGrid-аас л дуудна)
├── theme.ts              themeQuartz.withParams({...}) → --ea-* CSS vars
├── validators.ts         required, nonNegativeNumber, debitXorCredit, segmentCodeShape, accountExists, dateISO
├── formatters.ts         fmtMnt, parseMntInput, moneyValueFormatter, accountValueFormatter
├── columnTypes.ts        ColumnTypeId → Partial<ColDef> ЦОРЫН ГАНЦ бүртгэл
├── segments.ts           buildSegCode, parseSegParts, fmtAccountDisplay, normalizePastedAccount
├── clipboard.ts          processClipboardData (TSV + сегмент-аатай account column танина)
└── editors/
    ├── SegSelect.tsx                Portal-mounted searchable dropdown
    ├── AccountSegmentEditor.tsx     Inline данс editor: гараар бичих + ⌄ сегмент panel
    │                                (AG Grid v32+: onValueChange-ээр commit, портал нь
    │                                ag-custom-component-popup class-тай байх ЁСТОЙ)
    ├── DebitCreditEditor.tsx        Number editor + Dr⊕Cr mutex
    └── SwitchCellRenderer.tsx       shadcn Switch нүднэнд

lib/store/grid-store.ts   Zustand factory: createGridStore<TData>(surfaceId, initial, capacity=100)
                          — patch-based undo/redo, buildBatch() → Server Action
```

### Column type registry

`lib/grid/columnTypes.ts` бол **шинэ column kind тодорхойлох цорын ганц газар**.
Surface-үүд compose хийдэг бөгөөд багана тус бүрд `valueParser` / `valueFormatter` /
alignment / editor зэргийг дахин зарлахгүй. Дэмжих kinds:

| `eaType` | Хэрэглээ |
|----------|---------|
| `text` | Текст редактор |
| `readonly-text` | Текст харагдах |
| `number-money` | MNT тоо, баруун зэрэгцүүлэлт, locale-tolerant parse |
| `readonly-money` | Тооцоо харагдах |
| `debit` / `credit` | DebitCreditEditor + mutex |
| `account-segment` | AccountSegmentEditor (popup) + valueFormatter |
| `date` | `YYYY-MM-DD` text editor |
| `switch` | SwitchCellRenderer (callback dispatch) |
| `select` | agSelectCellEditor |

### Keyboard / mouse contract

| Товч | Үйлдэл |
|------|--------|
| Нэг даралт | Нүдний мужийн ЗАНГУУ (Excel-маягийн сонголт эхэлнэ) |
| Shift+даралт | Зангуунаас тэгш өнцөгт муж сонгоно |
| Давхар даралт | Мөрийн дэлгэрэнгүй панель / edit mode (жагсаалтын grid бүрд) |
| Arrow keys | Нүд хооронд |
| Tab / Shift+Tab | Дараагийн / өмнөх editable нүд |
| Enter / Shift+Enter | Commit + доош / дээш |
| F2 | Edit mode эхлүүлэх |
| Esc | Edit-ийг буцаах / мужийн сонголтыг арилгах |
| Ctrl/Cmd+C / V / X | Copy (сонгосон муж → TSV) / Paste / Cut |
| Ctrl/Cmd+Z / Y | Undo / Redo |
| Delete | Сонгосон нүднүүдийг цэвэрлэх |

**Хуудас эзэмшдэг товчлол:** F2 = топбарын «+ Шинэ» аппын ХААНА Ч (кассын
дэлгэцэд ч — хайлтын input `data-global-hotkeys="F2"`-оор нэвтрүүлнэ); кассын
бараа хайлт F3 / «/». Хуудас глобал товчлолыг өөрөөр хэрэглэвэл
`lib/ui/hotkeys.ts`-ийн `PAGE_OWNED_HOTKEYS`-д ЗААВАЛ бүртгэнэ — глобал
сонсогч тэнд алгасна (`pageOwnsHotkey`; касс «/»-г эзэмшдэг тул палитр
Cmd/Ctrl+K-гаар). Хуудасны нэрийг глобал сонсогчид hardcode хийхгүй
(`tests/hotkeys.test.ts`).

**Мужийн сонголт + copy (DataGrid built-in, бүх grid-д):** AG Grid
Community-д range selection байхгүй тул `DataGrid.tsx` дээр custom
хэрэгжсэн — нэг даралт зангуу, Shift+даралт муж, `ea-range-cell` класс
(багана бүрийн `cellClassRules`-д wrapper автоматаар шингээдэг),
Ctrl/Cmd+C нь мужийг TSV болгож clipboard-д тавина (тоон утга raw, бусад нь
formatted) — MS Excel-д шууд paste хийгдэнэ. Нэг агшинд нэг л grid-д
сонголт идэвхтэй. Мөрийн сонголт (batch үйлдэл) зөвхөн checkbox-оор —
`enableClickSelection` default false. **Дэлгэрэнгүй панель нээх нь ДАВХАР
даралт** — шинэ жагсаалтын grid нэмэхдээ `onCellDoubleClicked` /
`onRowDoubleClicked` хэрэглэнэ, нэг даралтад panel нээхийг хориглоно.

### Мөрийн өндөр (заавал мөрдөх)

Нэг grid-д мөрийн өндрийг **НЭГ л эзэн** тогтооно:

- Мөрүүдээ өөрөө өрдөг grid (журналын жагсаалт — мөр бүр журналын бүх
  бичилтийг харуулдаг) → `getRowHeight`
- Чөлөөт урт текст → баганын `autoHeight: true`

**Хоёуланг ХАМТ хэрэглэхийг ХОРИГЛОНО.** AG Grid эхлээд `getRowHeight`-ээр
мөрүүдээ байрлуулаад, дараа нь `autoHeight` баганыг хэмжиж өндрийг ДАХИН
тааруулдаг — рендерийн дараа мөрүүд босоо чиглэлд ШИЛЖИНЭ. Улмаар хулганы
доорх мөр өөр болж, хэрэглэгч дарсан мөрийнхөө ОРОНД хажуугийнхыг нээдэг
(2026-09-19: журналын жагсаалтад яг ийм алдаа гарч, дарсан журналын оронд
дараагийн журналын панель нээгдэж байв). Урт текстийг мөрийн ӨӨРИЙН өндөрт
`-webkit-line-clamp`-аар багтаана, бүтнээр нь `title`-д.

`tests/grid-row-height.test.ts` энэ зөрчлийг статикаар барина.

### Paste contract

- TSV / CSV — Excel, Sheets-ээс шууд хуулна
- Number нүднүүд `parseMntInput`-ээр `₮`, зай, таслал, цэгийг танина
- Account-segment баганад 10-part dotted ЭСВЭЛ active-only N-part код хүлээж авна
  (`normalizePastedAccount` нь идэвхгүй position-уудыг `SEG_DEFAULTS`-ээр padded)
- Алдаатай нүд улаан-border invalid тэмдэглэгдэнэ, paste-ийг REJECT хийхгүй

### Mutation contract

```
cell edit  →  DataGrid onCellValueChanged  →  setRows / store.applyPatches
add row    →  api.applyTransaction({ add }) + store.addRow({ isNew: true })
delete row →  store.removeRow(id)
save       →  store.buildBatch() → { create, update, delete: string[] } → Server Action
```

**Client-ээс DB-руу шууд хандахгүй.** Mutation болгон Server Action дайраад явна.

### Сегмент дүрэм (заавал биелүүлэх)

- Editor бүр **бүтэн 10-part dotted код** буцаана (`buildSegCode`-р).
- **Бүх сегмент бөглөгдөнө:** бичигдээгүй (идэвхгүй ЭСВЭЛ идэвхтэй ч
  сонгоогүй) сегмент **оронгийн тоогоор "0"** утга авна — `SEG_DEFAULTS` нь
  SEGMENT_DEFS-ийн length-ээс автоматаар гарна (S1="000", S2="000000"…).
  Онцгой: S3 үндсэн данс default-гүй (заавал сонгоно), S9="GL".
- Идэвхгүй байсан сегментийг идэвхжүүлэхэд хуучин дата "0…0" утгатайгаа
  шууд харагдана — migration хэрэггүй (parseSegParts хуучин хоосон хэсгийг
  ч default-аар уншина; DB-ийн хуучин код 2026-08-д нэг удаа 0-жүүлэгдсэн).
- Picker бүрд "Ерөнхий (default)" 0-сонголт автоматаар нэмэгдэнэ
  (`withSegDefaultOption`, S3-д үгүй).
- Read/display: `fmtAccountDisplay(code, activeSegIds)` идэвхтэй хэсгийг л
  үзүүлнэ; данс (S3) сонгогдоогүй бол бүхэлдээ хоосон.
- Paste/Excel/AI/MCP бүгд `normalizePastedAccount`-оор normalize хийнэ —
  хуучин форматын (хоосон хэсэгтэй) код мөн 0-жиж орж ирнэ.

### SSR

AG Grid module init үед `document` хэрэгтэй. Бүх surface `DataGridDynamic`-ийг
(`next/dynamic` `ssr:false`) ашиглана. Page-ууд Server Component хэвээр үлдэж
`rowData`-г prop-оор дамжуулна.

### Surface inventory

| Surface | Файл | Хэлбэр |
|---------|------|--------|
| Journal entry (бичих/засах) | [components/gl/journal-entry-form.tsx](components/gl/journal-entry-form.tsx) | `JournalLinesGrid` reuse — inline данс editor + Dr⊕Cr mutex + undo/redo |
| Journal lines grid (shared) | [components/journal/journal-lines-grid.tsx](components/journal/journal-lines-grid.tsx) | Дахин ашиглагдах мөрийн хүснэгт — pinned totals, clipboard, min-мөр хамгаалалт |
| Journal list | [components/gl/journal-list.tsx](components/gl/journal-list.tsx) | Read-only, dynamic row height, pagination. Мөр = `JournalListRow` (`lib/gl/journal-list-data.ts`): ваучер + эх баримтын (касс / АР/АП) харилцагч, валют, ханш + үүсгэсэн хэрэглэгч; Дт/Кт MNT ба валютаар (MNT ÷ ханш — лавлагаа, MNT баримтад хоосон), Дансны нэр багана. "Журналын нэр" = `description` |
| Мөнгөн гүйлгээний жагсаалт | [components/cash/cash-documents-view.tsx](components/cash/cash-documents-view.tsx) | Veritech "Харилцахын баримт"-тай ижил багана: Дансны код (мөнгөн дансны GL) · Валют · **Дебит дүн / Кредит дүн** (MNT — орлого Дт, зарлага Кт, шилжүүлэг хоёулаа) · Ханш · Дебит/Кредит /валют/ · Харилцагчийн код (`counterparties.code`) · Харилцагчийн нэр · Харилцах GL данс · Журналын дугаар · МГ код / МГ нэр (S8). Дт/Кт задаргаа ЦЭВЭР `lib/cash/list-columns.ts` (тесттэй) |
| Cash баримтын панель | [components/panel/cash-doc-panel.tsx](components/panel/cash-doc-panel.tsx) | `JournalLinesGrid` reuse (readOnly) — сегмент panel, харилцагч (код · нэр), МГ код · нэр, журналын дугаар, холбогдсон нэхэмжлэхийн линк, Батлах/Буцаах/Устгах |
| Accounts config | [components/gl/accounts-table.tsx](components/gl/accounts-table.tsx) | Inline switches, batch save, group headers |
| GL trial balance | [components/gl/gl-balance-view.tsx](components/gl/gl-balance-view.tsx) | Multi-header colGroup + pinned totals |
| Balance sheet / IS / Cash flow | [components/gl/report-grid.tsx](components/gl/report-grid.tsx) | Section / group / subtotal / total мөртэй flat row model |
| Өртгийн хяналт (C1/Орлого/Зарлага/C2) | [components/costing/cost-control-report.tsx](components/costing/cost-control-report.tsx) | **ТОГТМОЛ** 2 түвшний colGroup толгой (docs/cost §2.2) — дахин зохиогдохгүй; нэгж өртгийн багана нийлбэргүй |
| Гүйлгээний дэлгэрэнгүй + GL тулгалт | [components/costing/transaction-detail-report.tsx](components/costing/transaction-detail-report.tsx) | colGroup + `columnGroupShow: "open"` — задарч нэмэлт багана гаргана |
| Бүрэлдэхүүний задаргаа | [components/costing/component-analysis-report.tsx](components/costing/component-analysis-report.tsx) | Бараа × бүрэлдэхүүн, нэгжид нөлөө, хуваарилалтын лавлагаа |
| Зардлын хуваарилалт · чөлөөт (таб) | [components/costing/cost-allocation-view.tsx](components/costing/cost-allocation-view.tsx) | Сонголтын хүснэгт + хадгалахын өмнөх урьдчилсан хуваарь |
| Өртгийн модулийн хэсгийн таб | [components/costing/costing-section-tabs.tsx](components/costing/costing-section-tabs.tsx) | Зардлын хуваарилалтын 2 route-ыг НЭГ нав цэс дор — `PageTabs`, layout-д Suspense-тэй (тайлангуудад ХЭРЭГЛЭХГҮЙ — топбарын сонгогч) |
| Тайлангийн жааз (нийтлэг) | [components/reports/report-layout.tsx](components/reports/report-layout.tsx) | `ReportPage` · `ReportHeader` (гарчиг + муж + Excel) · `ReportToolbar` (зүсэлт → шүүлтүүр) · `ReportEmpty` — «Тайлангийн стандарт» |
| Нягтлан бодох период | [components/periods/periods-view.tsx](components/periods/periods-view.tsx) | Хаах / дахин нээх, сар бүрийн бичилтийн тоо |
| Хангамжийн самбар | [components/procurement/procurement-dashboard.tsx](components/procurement/procurement-dashboard.tsx) | Түр дансдын үлдэгдэл, ноорог/нээлттэй/хаах боломжтой PO тоолол, сүүлийн захиалгууд |
| Худалдан авалтын захиалга | [components/procurement/purchase-orders-view.tsx](components/procurement/purchase-orders-view.tsx) | `FilterChips` статус шүүлтүүр + хүлээн авсан/нэхэмжилсэн % багана; давхар даралт → PO панель |
| Хүлээн авалт (GR) | [components/procurement/goods-receipts-view.tsx](components/procurement/goods-receipts-view.tsx) | Огноо/агуулах/МБ ханш/дүн; давхар даралт → хүлээн авалтын панель |
| Зардлын хуваарилалт · PO-ийн зардал (таб) | [components/costing/unallocated-costs-view.tsx](components/costing/unallocated-costs-view.tsx) | Нэхэмжлэхийн мөр × бүрэлдэхүүн worklist — хуваарилсан / үлдэгдэл MNT |
| Хангамжийн тайлан | [components/procurement/procurement-report-view.tsx](components/procurement/procurement-report-view.tsx) | Захиалгаар / Нийлүүлэгчээр таб — гүйцэтгэлийн дүн, валют бүрийн pinned нийт |
| Нийлүүлэгчийн карт | [components/procurement/supplier-card.tsx](components/procurement/supplier-card.tsx) | Харилцагчийн бүртгэлээс уншина (PO-д хадгалахгүй) + нээлттэй өглөг, өмнөх захиалга |
| АР/АП мөрийн хүснэгт (shared) | [components/arap/arap-lines-grid.tsx](components/arap/arap-lines-grid.tsx) | `arap-doc-panel.tsx`-ээс ЗӨӨСӨН — `mode` prop (`arap` / `po_invoice` / `goods_receipt`), Нэгж үнэ + Бүрэлдэхүүн багана |
| Харилцагчийн сонгогч (shared) | [components/arap/counterparty-select.tsx](components/arap/counterparty-select.tsx) | АП ба PO панель хоёулаа ҮҮНИЙГ хэрэглэнэ — давхардсан сонгогч бичихгүй |
| Хавсралтын жагсаалт (нийтлэг) | [components/attachments/attachment-list.tsx](components/attachments/attachment-list.tsx) | Зөвхөн ui-kit (`Button`, `IconAction`, `StatusBadge`, `EmptyState`, `useConfirm`) — шинэ icon бичихгүй |
| Хавсралт — компакт мөр + popup | [components/attachments/attachment-section.tsx](components/attachments/attachment-section.tsx) | Панелиудын НЭГДСЭН хэрэглээ: `📎 Хавсралт · N` товч → `Dialog` дотор бүтэн жагсаалт |
| POS кассын дэлгэц (v2, дэлгүүрийн POS) | [components/pos/pos-checkout-view.tsx](components/pos/pos-checkout-view.tsx) | **Хүснэгт БИШ** — хүрэлцэх дэлгэцийн ticket (AG Grid стандарт хамаарахгүй, баримтын preview-тэй ижил ангилал): зүүн `checkout/product-panel` (сканнер/хайлт, бүлгийн `FilterChips`, барааны tile), баруун `checkout/ticket-panel` (мөр сонгох, −/+/×, дүн, агуулах ЭЭЛЖИЙНХ (дундуур солихгүй), үнэгүй бараа «Үнэ тохируулаагүй»; тоо −/+ эсвэл мөр дээр шууд бичих (numpad 2026-09-26-нд хасагдсан) — касс ҮНЭ ЗАСАХГҮЙ: барааны картын үнэ, жинлэдэгт кг-ийн үнэ × жин, буулгах нь хөнгөлөлтөөр; ТӨЛБӨР); `checkout/discount-dialog` (F4 — купон, баримтын ба мөрийн % хөнгөлөлт), `checkout/parked-dialog` (олон түр хадгалсан сагс); цэвэр төлөв `lib/pos/checkout-state.ts` (тесттэй); `quotePosSale` debounce 250мс (мөрийн дүн ШУУД `resolveLineAmounts`, эцсийн дүн серверийнх); баримт автомат хэвлэх (төхөөрөмжийн localStorage), Онлайн/Офлайн тэмдэг + баннер; сканнер = гар (input үргэлж focus-той); F9/F3/F4/F6/↑↓/+−/Delete/Esc (F2 = глобал «+ Шинэ») |
| POS төлбөрийн диалог | [components/pos/payment-dialog.tsx](components/pos/payment-dialog.tsx) | Хэлбэрийн товчнууд, мөр бүрд дүн/лавлагаа/бэлгийн карт/кредит, хурдан бэлэн, Төлсөн/Үлдэгдэл/Хариулт (`roundToCashUnit`) — server `planPayments` эрх мэдэлтэй |
| POS борлуулалтын жагсаалт | [components/pos/sales-list-view.tsx](components/pos/sales-list-view.tsx) | `FilterChips` статус + Борлуулалт/Буцаалт, огнооны муж (URL → cookie), давхар даралт → `pos-sale` панель |
| POS ээлж / Z-тайлан | [components/pos/shifts-view.tsx](components/pos/shifts-view.tsx) | Ээлжийн grid, нээх/хаах диалог (`shift-dialogs.tsx`), тоолсон vs системийн бэлэн, зөрүү |
| POS тохиргоо | [components/pos/pos-settings-view.tsx](components/pos/pos-settings-view.tsx) | 3 дэд таб: дансны роль/хязгаар · төлбөрийн хэлбэр grid · хөнгөлөлтийн дүрэм grid (`discount-rule-dialog.tsx`) + симуляци |
| Борлуулалтын тайлан | [components/pos/sales-report-view.tsx](components/pos/sales-report-view.tsx) | 8 зүсэлт (гүйлгээ/бараа/өдөр/салбар/кассчин/хэлбэр/харилцагч/дүрэм) — «Гүйлгээ»-нд салбар, ээлж, eBarimt статус + ДДТД; «Өдрөөр»/«Салбараар»-т eBarimt илгээсэн/чек; COGS суурь `final`/`provisional` ил, pinned нийт |
| Цалингийн хуудас (payslip) | [components/payroll/payslip-report-view.tsx](components/payroll/payslip-report-view.tsx) | Ажилтны жагсаалт (pinned нийт) + A4 хуудас: давхар даралт → нэг ажилтан, «Бүгдийг хэвлэх» → ажилтан бүр шинэ хуудсанд (`ea-printing-payslip`) |
| POS борлуулалтын панель | [components/panel/pos-sale-panel.tsx](components/panel/pos-sale-panel.tsx) | Read-only мөрийн grid (хөнгөлөлт, НӨАТ, буцаасан, урьдчилсан COGS), төлбөр/буцаалт/холбоос, Буцаалт диалог, Дахин хэвлэх |

---

## Excel импорт/экспортын стандарт

Excel-тэй харилцах БҮХ зам нэг стандартаар явна — шинэ импорт/экспорт нэмэхдээ
өөр parser/dialog зохиохгүй, доорх хэсгүүдийг compose хийнэ.

### Эх сурвалж файлууд

```
lib/excel/
├── import-spec.ts   Цэвэр логик (тесттэй): ImportSpec<T>, parseMatrix,
│                    parseAmountCell (₮/зай/таслал), parseDateCell (round-trip)
├── specs.ts         Спек үйлдвэрүүд: journalLinesSpec, arapLinesSpec,
│                    journalVouchersSpec + groupVoucherRows
└── core.ts          Client тал (exceljs dynamic import): readWorkbookMatrix,
                     downloadWorkbook, downloadTemplate(spec)

components/excel/excel-import-dialog.tsx   Нийтлэг диалог (аль ч спекээр)
lib/actions/journal-import.ts              Багц журнал → НООРОГ (server шалгалттай)
```

### Хатуу дүрмүүд

- **Багана НЭРЭЭР танигдана** (байрлалаар БИШ) — том/жижиг үсэг, зай, `*`
  хамаарахгүй; илүүдэл багана үл тоомсорлоно; заавал багана дутвал
  headerError болж юу ч орохгүй
- **Мөр бүр тусдаа шалгагдана**, алдаа нь Excel-ийн мөрийн ДУГААРТАЙГАА
  урьдчилан харах хүснэгтэд гарна. **Зөвхөн зөв мөрүүд орно** — алдаатай мөр
  хэзээ ч чимээгүй орохгүй
- **Загвар файл спекээсээ үүснэ** (`downloadTemplate`) — толгой, жишээ мөр,
  "Заавар" хуудас parser-аас зөрөх боломжгүй
- **Дансны нүд paste-тай ИЖИЛ normalize** — `normalizePastedAccount` (бүтэн
  10-part, active-only N-part, эсвэл ганц 8 оронтой код); идэвхтэй данс мөн
  эсэхийг спек + server хоёулаа шалгана
- **Багц журнал НООРОГ болж үүснэ** (human-in-the-loop §9); server action
  данс/период/мөрийн тоог ДАХИН шалгаж баримт бүрд тусдаа амжилт/алдаа буцаана
- **Экспорт нь импортын загвартай ижил баганатай** (журналын экспорт →
  багц импортын толгой + Статус) — round-trip ажиллана
- Client-ээс DB-руу шууд хандахгүй — импортын бичилт Server Action-аар

### Одоогийн integration-ууд

| Газар | Импорт | Экспорт |
|-------|--------|---------|
| Журнал бичих форм (footer) | Мөрүүд (`journalLinesSpec`) | — |
| Журналын жагсаалт (toolbar) | Багц журнал (`journalVouchersSpec` → draft) | Шүүгдсэн журнал мөрөөрөө |
| АР/АП баримтын панель (мөрийн footer) | Мөрүүд + бараа/агуулах кодоор (`arapLinesSpec`) | — |
| АР/АП баримтын жагсаалт | — | Шүүгдсэн баримтууд |
| Ажилтнууд (toolbar) | Ажилтан (`employeesSpec` — РД таарвал шинэчилнэ) | Жагсаалт загвартай ижил баганаар + загвар татах |

---

## DB өгөгдлийн бүтэц (Drizzle / PostgreSQL)

Бүх хүснэгт `userId`-аар хамгаалагдсан (нэг хэрэглэгч = нэг компани).
`users.welcome_dismissed_at` — нүүрний анхны туршилтын картыг хаасан мөч (§9a).
Дэлгэрэнгүйг `lib/db/schema.ts`-ээс уншина — доор нь зөвхөн бүлэглэл.

```
Цөм        users, chart_of_accounts, segment_configs, segment_values,
           module_configs, accounting_periods
             segment_values.linkedOrganizationId — S1/S6-ийн утга аль
               байгууллагаас автоматаар бүрдсэн бэ (§3a); null = гараар оруулсан
GL         journal_vouchers, journal_lines, document_counters
             journal_vouchers.documentNo — ЖУРНАЛЫН БИЧИЛТИЙН ДУГААР
               "<МОДУЛЬ>-<YY>-<NNNNNN>" (§2a); хуучин бичилтэд NULL
             document_counters (organization_id, scope) — дугаарын АТОМИК
               тоолуур; scope = "GL-26" г.м.
             journal_lines.costEntryId / inventoryMovementId — дэд дэвтрийн
             эх сурвалж (Source → Movement → Cost → GL мөр → Журнал)
             journal_lines.businessObjectType / businessObjectId — клирингийн
             түлхүүр (PO), бичих МӨЧИД тавигдана
             journal_vouchers.currency / exchangeRate / rateSource / rateDate +
               journal_lines.debitFc / creditFc — баримтын ВАЛЮТ (§2b);
               MNT баримтад "MNT" / 1 / 0
Cash       cash_accounts, cash_documents, bank_statements,
           bank_statement_lines, cash_fx_revaluations
             cash_documents.counterpartyId — харилцагчийн БҮРТГЭЛИЙН холбоос
               (задаргаа: код/РД + нэр); `counterparty` текст нь нэр (бүртгэлгүй
               харилцагчид ч бичигдэнэ). Холбох дараалал `resolveCashCounterparty`
               (lib/actions/cash.ts): ил ID → нэхэмжлэхийн харилцагч → чөлөөт
               нэрээр ЯГ таарсан бүртгэл (`matchCounterpartyByName`, олон
               таарвал холбохгүй — ХОЛБООС ЗОХИОХГҮЙ). Банкны хуулга импорт мөн
               ижил дүрмээр холбоно. Харилцагч устгагдвал set null, нэр үлдэнэ
             cash_documents.cashFlowCode — МГ код (S8); МГ нэр нь segment_values(8)-ээс
               уншигдана, баримтад хадгалагдахгүй (нэр солигдвол дагана)
             cash_account_period_balances — хаалтын үлдэгдэл (дансны валютаар),
               период хаахад бичигдэж дахин нээхэд устдаг (snapshot + delta), exchange_rates
             exchange_rates — НИЙТИЙН лавлах: organizationId БАЙХГҮЙ (ханш нь
               нийтийн баримт), unique INDEX (source, currency, date) —
               constraint биш, drizzle-kit #5955-ийн улмаас (§5b); source
               mongolbank|tdb|golomt, date = ханшийн ӨӨРИЙН огноо (RATE_DATE),
               fetchedAt = хэзээ татсан (§5b)
             fx_revaluations.closingRate / rateSource / rateBasis / sourceDate /
               manualOverrideReason — тэгшитгэлийн ханшийн баримт
AR/AP      counterparties, ar_ap_documents, ar_ap_document_lines,
             documents.documentType ar_invoice|ap_bill|ar_credit_note|ap_debit_note;
               sourceDocumentId / lines.sourceLineId — кредит/дебит баримтын эх (§5d)
           ar_ap_settlements, arap_ecl_settings, arap_write_offs,
           arap_write_off_recoveries (ENT-065 §5e — хасалт нь settlement +
             voucher-той, сэргэлт нь хасалтын үлдэгдлийг бууруулна)
             settlements.cashDocumentId нь `on delete set null` тул кассын
               баримт rollback-гүй устсан үед мөр ӨНЧИН үлдэж нэхэмжлэх «төлөгдсөн»
               мэт харагддаг байв (хяналтын дансны ТОГТМОЛ зөрүү). Бичилтийн
               замууд (deleteCashDocument / reverseCashDocument /
               reverseArApOffset) rollback хийдэг; ӨМНӨХ мөрүүдийг preDeploy-ийн
               `scripts/cleanup-orphan-settlements.mjs` (идемпотент) нөхнө —
               өнчин = cashDocumentId ба voucherId ХОЁУЛАА null; цэвэр логик
               `scripts/lib/settlement-cleanup-plan.mjs` (тесттэй), GL хөндөхгүй
             documents.purchaseOrderId — PO-той нэхэмжлэх (→ өглөгийн түр данс)
             lines.purchaseOrderLineId / unitPrice / costComponentId
               (CHECK: itemId ба costComponentId зэрэг байж болохгүй)
             counterparties.code — ХАРИЛЦАГЧИЙН КОД: РД/ТТД-ээс ТУСДАА, org дотор
               давтагдашгүй (partial unique index, хоосон = давхардал биш),
               `normalizeCounterpartyCode` (ТОМ үсэг, ≤32) — автомат дугаарлалт
               ХИЙХГҮЙ (гараар / импортоор оноогдоно). Кассын "Харилцагчийн код"
               багана, AI list/create/update_counterparty, master data CSV (`code`)
             counterparties.tin — ТТД (татвар төлөгчийн дугаар, 11–14 орон):
               регистрээс ТУСДАА багана; ЦЭВЭР `normalizeTin` / `effectiveTin`
               (counterparty-kind.ts, тесттэй — хуучин мөрд регистрийн талбарт
               бичигдсэн ТТД-г preDeploy нөхнө, харагдацад ч өвлөнө). Картын
               «ТЕГ-ээс лавлах» (`lookupCounterpartyTaxpayer`: ТТД → нэр/НӨАТ
               төлөгч, байгууллагын регистр → ТТД) НЭГ удаа; POS кассын B2B ба
               AI `create_pos_sale` (customerTin өгөөгүй бол) картын ТТД-г шууд
               хэрэглэнэ — регистрээр лавлах 2026-06-15-аас хязгаарлагдсан.
               AI create/update/batch/list_counterparty `tin`, CSV `tin`
             counterparties.entityKind — СУБЪЕКТИЙН төрлийн КОД: систем
               "organization" (Байгууллага, default) | "individual" (Хувь хүн) ЭСВЭЛ
               байгууллагын НЭМСЭН `kind_<n>` (counterparty_entity_kinds: name,
               baseKind organization|individual, isActive; систем 2 төрөл мөргүй ч
               бий, устгагдахгүй — нэрийг л засна). Бизнесийн логик (регистрийн
               шалгалт, POS eBarimt B2B) ЗӨВХӨН `baseKindOf`-оор — шинэ төрлийн
               кодыг hardcode хийхгүй; хэрэглэгдэж буй төрөл устгагдахгүй
               (идэвхгүй болгоно). UI: Харилцагчид → «Төрөл». — `counterpartyType` (авлага/
               өглөгийн ЧИГЛЭЛ)-ээс ТУСДАА хэмжээс. ЦЭВЭР `lib/arap/counterparty-kind.ts`
               (тесттэй): шошго, `inferEntityKindFromRegisterNo` (иргэний РД
               = 2 кирилл + 8 орон → individual; 7/11/14 орон → organization;
               бусад null — таамаглахгүй), `registerNoMismatch` ЗӨВЛӨМЖ (хориг
               биш — гадаадын харилцагч). Форм: «Төрөл» = субъект, «Тооцоо» =
               чиглэл; регистрийн шошго төрлөөр. POS төлбөрийн диалог байгууллага
               харилцагчийн РД/ТТД-г eBarimt B2B-ээр урьдчилан бөглөнө. AI
               create/update/batch `entityKind`; CSV `entityKind`; preDeploy
               иргэний РД хэлбэртэй хуучин мөрийг individual болгож нөхнө
             counterparties.contactPerson / bankName / bankAccountNo
Хангамж    purchase_orders, purchase_order_lines, goods_receipts,
           goods_receipt_lines
             orders.status draft|open|closed|cancelled; closeVoucherId —
               түр дансдыг тэгшитгэсэн хаалтын журнал
             receipts.exchangeRate / rateSource / rateDate — хүлээн авсан
               өдрийн Монголбанкны албан ханш (барааны өртөг ҮҮГЭЭР)
             receipt_lines.movementId — үүсгэсэн орлогын хөдөлгөөн
Хавсралт   document_attachments — polymorphic (entityType: `purchase_order`,
           `goods_receipt`, `journal`, `cash`, `arap`, `inventory`, `fa` —
           аудитын entityType-тай ижил; whitelist
           lib/attachments/constants.ts ATTACHMENT_ENTITY_MODULE_KEYS),
           файл base64-аар, FK байхгүй тул устгалтыг модулийн delete зам
           deleteAttachmentsFor-оор ӨӨРӨӨ хийнэ; унших зам ЗААВАЛ org +
           модулийн эрхийн шалгалттай (арап нь ar/ap аль нэг эрхээр)
Inventory  inventory_items, warehouses, inventory_movements, inventory_categories,
           inventory_category_levels
             categories.parentId — ОЛОН ТҮВШИНТЭЙ мод (ЦЭВЭР
               lib/inventory/category-tree.ts, тесттэй): цикл/гүн хориг, устгах
               хориг (дэд ангилал/бараа/хөнгөлөлтийн дүрэм). УДАМШИЛ: эцэг ангиллын
               хөнгөлөлтийн дүрэм (CartLine.categoryPath), POS chip, борлуулалтын
               тайлангийн шүүлт дэд ангиллын бараанд ч; eBarimt ангилал хоосон бол
               өвөг рүү өгсөж өвлөнө (readiness + queue НЭГ дүрэм). Self-FK NO
               ACTION — байгууллагын cascade устгал бүх модыг нэг дор устгана
             category_levels (org, depth, name) — түвшний нэр; мөргүй бол
               default «Ерөнхий › Үндсэн › Дэд»; хамгийн багадаа 1, ашиглагдаж
               буй гүнээс доош хасахгүй. Хуудас: Бараа · Ангилал · Агуулах ТУСДАА
             items.barcodeType (GS1|ISBN|UNDEFINED → PosAPI barCodeType),
               description / brand / manufacturer / originCountry — барааны
               дэлгэрэнгүй карт (тооцоонд нөлөөгүй; Excel импортод хоосон нүд =
               өөрчлөхгүй)
             items.salesPrice — борлуулах үнэ (MNT, нэгжид, null = тогтоогоогүй):
               АР нэхэмжлэхэд бараа сонгоход нэгж үнэ автоматаар (байхгүй бол
               сүүлийн АР мөрийн unitPrice); өртөгтэй ХОЛБООГҮЙ, үнэ зохиохгүй
             movements.issueTypeId — зарлагын дебет чиглэл
             movements.sourceType `po_receipt` — хүлээн авалтын мөрөөс үүссэн
POS        pos_settings (рольын данс, walkInCounterpartyId, issueTypeId,
           provisionalCogs, allowNegativeStock, хөнгөлөлтийн хязгаар, бөөрөнхийлөл),
           pos_payment_methods (kind × cashAccountId × feePercent — ewallet
           settlement-ийн шимтгэл), pos_settings.ewalletFeeAccountNumber
           (шимтгэлийн зардал, default 73100008), pos_discount_rules,
           pos_shifts, pos_sales, pos_sale_lines (arApLineId / movementId /
           provisionalCostEntryId), pos_sale_discounts, pos_payments,
           pos_gift_cards, pos_store_credits; inventory_categories,
           item_price_history; inventory_items.salesPrice/barcode/vatMode…;
           counterparties.customerGroup/creditLimit; vat_settings.isVatPayer;
           ar_ap_documents / cash_documents .sourceType ("pos") + sourceId;
           cost_entries.trueUpOfEntryId, valuationSource "provisional_avg",
           entryType "cogs_true_up" (ТЭМДЭГТЭЙ дүн)
QPay       pos_settings.qpay{Enabled,ApiUrl,ApiKeyEnc,WebhookSecretEnc,MerchantId,
           InvoiceTtlSec} (нууц ШИФРТЭЙ), pos_payment_methods.provider ("qpay" |
           null — зөвхөн ewallet), pos_qpay_intents (org, shift, cashier, amount,
           cartSnapshot jsonb, status open|paid|finalized|cancelled|expired|failed,
           qpayInvoiceId/qrText/qrImage/urls, paymentId/paidAmount/paidAt,
           expiresAt, saleId, lastCheckAt, lastError; unique INDEX (org,
           qpayInvoiceId) where not null)
eBarimt    pos_settings.ebarimt{Enabled,MerchantTin,BranchNo,DistrictCode,PosNo,
           PosApiUrl,Mode} (мерчантын тохиргоо — нууц БАЙХГҮЙ),
           pos_payment_methods.ebarimtCode, inventory_items.ebarimt{Classification,
           TaxProduct}Code, inventory_categories.ebarimtClassificationCode,
           pos_sales.ebarimt{Id,Lottery,Status,QrData,Date,Type,ConsumerNo,CustomerTin},
           pos_ebarimt_submissions (дараалал — kind send|cancel, status pending|
           claimed|sent|failed|cancelled, payload/response jsonb, attempts,
           nextAttemptAt; partial unique (saleId, kind) pending|claimed)
Costing    cost_components, inventory_issue_types, costing_account_settings,
           costing_item_settings, cost_allocations, cost_allocation_lines,
           costing_runs, cost_entries, cost_period_results
             account_settings.apClearingAccountNumber — өглөгийн түр дансны
               шинэ роль (default 31000099)
             cost_entries.sourceLineId + businessObjectType/Id;
               valuationSource `po_receipt` | `ap_line`
             cost_allocations.sourceLineId / purchaseOrderId — нэхэмжлэхийн
               мөрөөс хийсэн хуваарилалт (Σ ≤ мөрийн MNT дүн)
FA         fixed_assets, fa_depreciation_entries, fa_settings
             fixed_assets.location / subLocation — байршил, дэд байршил
             fixed_assets.depreciationStartDate — ӨДРИЙН суурийн эхлэл
             fixed_assets.taxUsefulLifeMonths / taxDepreciationMethod — §7a
             fa_depreciation_entries.taxAmount (мэмо) / depreciatedDays
             fa_settings.depreciationBasis — "monthly" | "daily" (§7a)
VAT        vat_settings
Payroll    employees, payroll_settings, payroll_runs, payroll_run_lines
             run_lines.standardHours / workedHours — цагт суурилсан олголт
             run_lines.vacationPay / otherAdditions — нийт олголтод нэмэгдэнэ
             run_lines.advanceHours / advanceAmount — урьдчилгаа (§7)
             runs.advanceDate / advanceDocumentId / finalDocumentId — хоёр
               нэгтгэсэн өглөгийн нэхэмжлэх
             settings.standardMonthlyHours / employeePayableAccountNumber /
               employeeCounterpartyId
Audit      audit_events — статус шилжилт бүрд lib/audit.ts logAuditEvent
           (бизнесийн урсгалыг хэзээ ч унагахгүй); /settings/audit хуудас
Мэдэгдэл   notifications (хүлээн авагч × org, dedupeKey unique INDEX,
           readAt, emailedAt), notification_preferences (user × org, channels
           JSON, mutedUntil, telegramChatId/LinkCode), notification_runs (job ×
           periodKey × org unique — scheduler/digest булаалт),
           notification_deliveries (мэдэгдэл × суваг unique) — §9d;
           company_settings.largeAmountAlertMnt (D2 босго)
Багц       organization_subscriptions (planId, status, seats, trialEndsAt,
           currentPeriodEnd, overrides, pricePerSeatMnt — харилцагчийн ТУСГАЙ үнэ)
             billing_payments — багцын QPay төлбөр (§6a): plan/seats/months/amount,
               status open|paid|cancelled|expired|failed, qpayInvoiceId (partial
               unique INDEX), QR, paidAt, periodStart/End; org cascade
             platform_plan_prices — багцын үнийн ТҮҮХ, ПЛАТФОРМЫН лавлах
               (organizationId БАЙХГҮЙ). Мөр бүр = ОГНООНЫ МУЖ: effective_from
               (YYYY-MM-DD text) … effective_to (null = хугацаагүй), note;
               unique INDEX (plan_id, effective_from). Тухайн өдрийг хамрах үе
               байхгүй бол lib/billing/plans.ts-ийн default; price null = хэлэлцээрээр
Дэмжлэг   platform_support_sessions — платформын операторын ТҮР хандалт:
           token_hash (sha256, unique INDEX), user_id (линк НЭГ хүнд уягдана),
           role viewer|admin (owner БАЙХГҮЙ), expires_at (линк) · started_at →
           ends_at (сесс) · ended_at (гарсан), reason/issued_by — Console
Мэдлэг     knowledge_articles — НИЙТИЙН лавлах (organizationId БАЙХГҮЙ): slug ×
           section unique INDEX, category, title/heading/body, citation, modules
           jsonb, source_path, checksum (sha256 — seed алгасалт), sort_order.
           knowledge_reads (org, user, slug, section, created_at; org+time index)
           — 24ц квот + бөөнөөр татах илрүүлэлт, аудит БИШ (§9e)
Тохиргоо   company_settings.aiPostLimitMnt — AI/MCP/REST-ийн ШУУД БАТЛАХ дээд
           хязгаар (MNT, null = 10 сая ₮ default, §9); tool-оор өсгөхөд 1 тэрбум ₮ тааз
AI         ai_settings (write_mode л — §9a; ai_messages / ai_attachments 2026-09-25-нд
           архивлагдсан, removed-schema-objects)
Тайлан     report_line_mappings
             cfCodes — мөнгөн гүйлгээний тайлангийн S8 сегментийн кодууд
               (дансны таарцаас ТҮРҮҮЛЖ шалгагдана)
```

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
