# eTax («Цахим татварын систем», etax.mta.mn) модуль

> `CLAUDE.md` §6a-гийн дэлгэрэнгүй. Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина.
> Хатуу дүрмийн хураангуй `CLAUDE.md`-д — хоёуланг ЗЭРЭГ шинэчилнэ. Албан эх, нэвтрэлт,
> гео-хязгаар, ITC-д тавих асуулт: `docs/integrations/00-itc-developer-portal.md` §2–§4.

## 1. Төлөв (2026-10-02) — суурь ХЭРЭГЖСЭН, илгээлт нь ГАРААР

ТЕГ-ийн eTax API-ийн албан спек («ETAX API documentation v1.1», developer портал `etax-api`)
Монголын IP-ээс л татагддаг тул энэ орчинд уншигдаагүй. Тиймээс одоо хэрэгжсэн нь
**спекээс хамаарахгүй суурь**: Entry-ийн НӨАТ-ын бодолтыг ТЕГ-ийн маягтын хуулбар
(snapshot) болгон бэлтгэж, шалгаж, хүн хянаж, etax.mta.mn-ээс гараар тушаасан дугаараар
бүртгэнэ. ТЕГ рүү Entry **юу ч илгээхгүй**; зөвхөн ITC Keycloak нэвтрэлтийг шалгана.
Спек ирмэгц `lib/itc/etax/client.ts` + маягтын mapper нэмэгдэж, «Тушаасан» алхам
автоматжина (төлөвийн машин, хүснэгт, UI хэвээр).

### 1.1 eTax вэбээс ажиглагдсан зүйл (2026-10-02, бодит bundle — АЛБАН БИШ)

`etax.mta.mn`-ийн React апп (`/static/js/main.*.js` + 85 chunk) энэ орчноос нээгдэв:

- Keycloak: `https://auth.itc.gov.mn/auth`, realm `ITC`, client `etax-gui` (public);
  realm-д `password` grant нээлттэй (`.well-known/openid-configuration`)
- Backend нь ижил хост дээр `/backapi/*` (axios `baseURL = window.location.origin`);
  тайлангийн хэсэг `/backapi/beta/return/*`: `getReportPeriod` → `getFormList` /
  `getFormDetail` → `saveFormData` / `saveSheetData` / `sheetExcelImport` (хуудас бүр Excel-ээс)
  → `validatePrevReport` / `getFormValidData` → `submit` → гарын үсэг (`/backapi/signature/*`:
  E-sign, `gSignSubmit`, SMS OTP) → `getHistory`, `getReportStatusData`; дахин тушаалт
  `checkResubmitReportGuarantee`
- Маягт = taxType + `formNo` + хуудсууд (`sheetCode`): ажиглагдсан кодууд `TT-03A_4…8` (НӨАТ),
  `TT-10(…)_A/B`, `TT-15*`, `TT-16…19`, `TT-06` — аль маягт аль татварынх болохыг албан баримтаар батална
- **Тушаалт тоон гарын үсэг / OTP-гүйгээр болдоггүй** → Entry-ийн «Тушаасан» алхам хүний
  үйлдэл хэвээр үлдэх магадлал өндөр (API-д ч). Ноорог-first зарчим ТЕГ-ийн талаас давхар.

Эдгээр нь GUI-ийн ДОТООД, `beta` угтвартай, баримтжаагүй замууд — production кодонд
ХЭРЭГЛЭХГҮЙ (CLAUDE.md «зохиохгүй»). Зөвхөн загварын ойлголтод.

## 2. Урсгал

```
/tax/vat (computeVatReturn)
   │  «Бэлтгэх (ноорог)»  tax:write
   ▼
etax_submissions  status=draft   snapshot = buildVatSnapshot(summary, settings, Компанийн мэдээлэл)
   │                              validation = validateVatSnapshot(snapshot, УБ өнөөдөр)
   │  «Бэлэн — хянасан»  tax:write  (алдаагүй, бодолт зөрөөгүй — stale бол хаалттай)
   ▼
ready ──«Ноорог руу»──▶ draft           «Дахин бодох»: дүн зөрвөл ready → draft АВТОМАТ
   │  хэрэглэгч etax.mta.mn-д ТТ-03А бөглөж тоон гарын үсгээр тушаана
   │  «Тушаасан гэж бүртгэх» tax:post — ТЕГ-ийн хүлээн авсан дугаар ЗААВАЛ
   ▼
submitted ──▶ accepted (tax:post)
          └─▶ rejected (tax:post, шалтгаан ЗААВАЛ) → шинэ ноорог «Бэлтгэх»-ээр
draft/ready ──▶ cancelled (tax:write)
```

- Нэг маягт × тайлант үед ЗЭРЭГ нэг л амьд (draft/ready/submitted/accepted) илгээлт —
  partial unique index `etax_submissions_org_form_period_active_ux`; rejected/cancelled
  дараа шинээр үүснэ (түүх хадгалагдана)
- Хуудас `/tax/etax` (нав «Татвар → eTax тайлан»); огноо = топбарын период, URL `period` дарна
- Холболтын тохиргоо (ITC нэвтрэх нэр/нууц үг, орчин) хуудасны доод хэсэгт — админ+ л;
  «Нэвтрэлт шалгах» = Keycloak password grant (`etaxClientId()`), юу ч илгээхгүй

## 3. Хатуу дүрэм

- **Тайлан ЗОХИОХГҮЙ** — snapshot нь `getVatReturnData`-ийн дүнг л хуулна; `validateVatSnapshot`
  зөвхөн уялдааг (төлөх = гаралт − оролт − шилжсэн кредит, сөрөг биш, толгой бүрэн) шалгана,
  дүн дахин бодохгүй; хувь/алдангийн тоо кодод байхгүй (хоцорсныг л анхааруулна)
- **Ноорог-first** (§9): draft → submitted шууд ХОРИОТОЙ (хүний «Бэлэн» дунд нь заавал);
  «Тушаасан» ТЕГ-ийн дугааргүй ХОРИОТОЙ; «Буцаасан» шалтгаангүй ХОРИОТОЙ
- **Төлөв ЗӨВХӨН `ETAX_TRANSITIONS`-ийн ирмэгээр** (`lib/itc/etax/submission.ts`); эцсийн
  (accepted/rejected/cancelled) төлвөөс гарахгүй; бичилт бүр уншсан төлөвтөө нөхцөлтэй
  (`where status = <уншсан>` + `returning`, 0 мөр → `stateChangedError`, C4)
- **Батлах шинжтэй шилжилт** (submitted/accepted/rejected) `tax:post`; бусад `tax:write`;
  тохиргоо `requireRole("admin")`. AI/MCP tool нэмэхдээ submitted → post горим + хязгаар
  (`[HUMAN_REQUIRED]` — татварын тайлан = хүний гарын үсэг)
- **Нууц** (`passwordEnc`) `encryptSecret`-ээр, утга нь client/лог/аудит/алдаа/тестэд ХЭЗЭЭ Ч
  гарахгүй; талбар write-only (хоосон = хуучнаа хадгална). Хост ЗӨВХӨН `lib/itc/constants.ts`
  (+ `ITC_AUTH_BASE*` прокси), `ETAX_WEB_BASE`; хэрэглэгч URL оруулахгүй
- **Клиент бичихгүй** спекгүйгээр: `/backapi/*` (§1.1) ХОРИОТОЙ; `ETAX_PATHS` зөвхөн албан
  баримтаас. client_id env `ETAX_CLIENT_ID` (default `etax-gui`)
- Үйлдэл бүр `logAuditEvent` (`etax_connection` / `etax_submission`); нууц утгагүй

## 4. Файлууд

```
lib/itc/etax/constants.ts   client-safe: ETAX_WEB_BASE, ETAX_CLIENT_ID_DEFAULT, ETAX_FORMS (vat ТТ-03А),
                            төлөв + шошго, ETAX_ACTIVE_STATUSES, ETAX_ERRORS
lib/itc/etax/submission.ts  ЦЭВЭР (tests/etax-submission.test.ts): buildVatSnapshot, validateVatSnapshot,
                            snapshotAmountsDiffer, ETAX_TRANSITIONS / canTransition / assertTransition,
                            isPostingTransition, requiresTaxReference, normalizeTaxReference
lib/itc/etax/types.ts       view төрлүүд (EtaxConnectionView, EtaxSubmissionView, EtaxPageData)
lib/itc/etax/store.ts       DB (server): холболт, checkEtaxConnection (Keycloak), loadEtaxTaxpayer,
                            loadEtaxPageData, prepareVatSubmission, transitionEtaxSubmission
lib/actions/etax.ts         Server Actions (ActionResult): get/save/test/deleteEtaxConnection,
                            prepareEtaxVatReturn, setEtaxSubmissionStatus
app/(dashboard)/tax/etax/page.tsx       хуудас (tax layout-ийн ModuleGuard дор)
components/tax/etax-view.tsx            карт, илгээлт, товчнууд, түүх (DataGridDynamic)
components/tax/etax-connection-settings.tsx  тохиргоо (админ)
lib/db/schema.ts            etax_connections, etax_submissions (docs/dev/db-schema.md)
lib/status.ts               ETAX_STATUS_TONES
```

## 5. Дараагийн алхам (спек ирэхэд)

1. `docs/integrations/00` §4.4-ийн хариу + «ETAX API documentation v1.1» → `ETAX_PATHS`,
   `lib/itc/etax/client.ts` (ижил `request` хэв маяг, `ITC_AUTH_BASE` прокси), маягтын
   mapper `lib/itc/etax/forms/vat.ts` (snapshot → ТТ-03А-ийн хуудас/мөр, ЦЭВЭР, тесттэй)
2. «Тушаасан» алхам: API-аар ноорог илгээх → ТЕГ-ийн ID-г `taxReference`-д; гарын үсэг/OTP
   шаардвал хэрэглэгч etax.mta.mn-д баталгаажуулж, Entry төлөвөө `getReportStatusData`-тай
   дүйцэх уншилтаар шинэчилнэ (E4 — `attention.ts` дохио)
3. ХАОАТ (`payroll_runs`), ААНОАТ маягтууд — ижил snapshot/validation загвараар
4. MCP tool: `get_etax_submissions` (унших), `prepare_etax_vat_return` (ноорог)
