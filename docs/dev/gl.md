# Ерөнхий журнал: дугаар, валют, хяналтын данс, сегмент

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§2a–§2c, §3a). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

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
