# eTax («Цахим татварын систем», etax.mta.mn) модуль

> `CLAUDE.md` §6a-гийн дэлгэрэнгүй. Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина.
> Хатуу дүрмийн хураангуй `CLAUDE.md`-д — хоёуланг ЗЭРЭГ шинэчилнэ. Албан эх, нэвтрэлт,
> гео-хязгаар, ITC-д тавих асуулт: `docs/integrations/00-itc-developer-portal.md` §2–§4.

## 1. Төлөв (2026-10-02) — АЛБАН API ХЭРЭГЖСЭН (staging баталгаажуулалт хүлээгдэж буй)

Албан спек `docs/integrations/etax/00-etax-api-spec.md` (developer портал «Цахим татварын
систем» proj-1787125468395, product owner 2026-10-02-нд татсан). Хэрэгжсэн урсгал:
Entry-ийн НӨАТ-ын бодолт → snapshot (ноорог) → хүн «Бэлэн» → **API-аар ТЕГ-д хадгалах**
(`saveFormData`, reportNo) → **API-аар илгээх** (`submit`) → **төлөв** (`getHistory`: хүлээн
авсан / буцаасан). Гараар (etax.mta.mn-ээс) тушааж дугаараар бүртгэх зам ХЭВЭЭР — NE-KEY
байхгүй / API алдаатай үед. ТЕГ-ийн маягт ДИНАМИК (`getFormDetail` нүд бүр `tagKey`) тул аль
нүд аль дүн болохыг спек хэлдэггүй — админ **нэг удаа нүдний холболт** тохируулна (§4).

**Албан спекийн гол зүйл** (§3): Keycloak token (`etax-api-staging` — staging; бодит client_id
спекд үгүй), header `NE-KEY` (ХСН-д posapi@itc.gov.mn-ээс; бодит орчинд ТЕГ-ийн ТТҮГ-т албан
бичгээр), `getUserOrgs` → `entId` (бүх дуудлагын query), `getList` → тушаах тайлангийн мөр
(taxTypeId, branchId, formNo, year/period, reportNo, returnDueDate), `getFormDetail` →
sections/rows/cells (`tagId`, `key`, `isDisable` = «утга авна», `expression`, `validations`),
`saveFormData` body `{reportData{…reportStatusId 2}, reportDataDetail[{tagId,type,tagKey,value}]}`
→ `reportNo`; `submit` → ТЕГ validations-оо шалгана; төлвийн код 2 хадгалсан · 3 илгээсэн ·
6 хуваарилсан · 11 хүлээн авсан · 8 буцаасан. Хавсралт МЭДЭЭ (§3.11–§3.15 `sheet`: борлуулалт /
худалдан авалтын задаргаа) ✅ — §7.

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
Тохиргоо (админ, нэг удаа): ITC нэвтрэлт → «Байгууллага татах» (getUserOrgs → entId, регистрээр)
   → «Жагсаалт татах» (getList → татварын төрөл × маягт) → «Загвар татах» (getFormDetail → нүднүүд)
   → нүдний холболт: outputVat/inputVat/payableVat (заавал), carriedInVat/refundableVat → tagKey

/tax/vat (computeVatReturn)
   │  «Бэлтгэх (ноорог)»  tax:write
   ▼
draft   snapshot = buildVatSnapshot(summary, settings, Компанийн мэдээлэл), validation
   │  «Бэлэн — хянасан»  tax:write  (алдаагүй, бодолт зөрөөгүй — stale бол хаалттай)
   ▼
ready ──«ТЕГ-д хадгалах» tax:write──▶ saved   (saveFormData → reportNo, ТЕГ-ийн төлөв 2;
   │                                            дахин хадгалах saved → saved ижил reportNo)
   │  ──«Гараар тушаасан гэж бүртгэх» tax:post (ТЕГ-ийн дугаар ЗААВАЛ)──▶ submitted
   ▼
saved ──«Мэдээ ТЕГ-д бичих» tax:write──▶ saved  (хавсралт мэдээ: deleteAllSheetData → saveSheetData, §7)
saved ──«ТЕГ-д илгээх» tax:post──▶ submitted   (submit — ТЕГ validations, алдаа мессеж ил)
   │
submitted ──«ТЕГ-ийн төлөв шинэчлэх» tax:write (getHistory)──▶ accepted (11) | rejected (8)
          ──«ТЕГ хүлээн авсан» / «ТЕГ буцаасан» tax:post (гараар, шалтгаан ЗААВАЛ)
«Дахин бодох»: дүн зөрвөл ready/saved → draft АВТОМАТ; draft/ready/saved → cancelled (tax:write)
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
- **Замууд ЗӨВХӨН албан спекээс** (`ETAX_PATHS`, `/api/beta/...`); вэбийн `/backapi/*` (§1.1)
  ХОРИОТОЙ. `NE-KEY` = операторын env `ETAX_NE_KEY` (харилцагчид харуулахгүй, UI талбар
  байхгүй); client_id staging `etax-api-staging`, бодит `ETAX_CLIENT_ID` (default `etax-gui`)
- **Нүдний холболтыг ТААХГҮЙ** — `getFormDetail`-ийн нүднээс админ сонгоно (`etax_form_mappings`);
  томьёотой нүд сонгогдохгүй; холболт дутуу бол «ТЕГ-д хадгалах» хаалттай (`mappingProblems`)
- **ТЕГ-д хадгалах ≠ илгээх:** `saved` нь ТЕГ-ийн төлөв 2 (reportNo-той, илгээгээгүй); `submit`
  ЗӨВХӨН `tax:post` + хүний баталгаажуулалт (confirm); ТЕГ-ийн хариу мессеж (`code ≠ 0`) ил
- **ТЕГ-ийн төлөв зөвхөн уншина** (`getHistory`), УРАГШ л: saved → submitted (3/6 — вэбээс
  илгээсэн), submitted → accepted (11) | rejected (8); танигдахгүй код төлөв хөндөхгүй
- Үйлдэл бүр `logAuditEvent` (`etax_connection` / `etax_submission`); нууц утгагүй

## 4. Файлууд

```
docs/integrations/etax/00-etax-api-spec.md  АЛБАН спек (хуулбар) — замын ЦОРЫН ГАНЦ эх
lib/itc/etax/constants.ts   client-safe: ETAX_API_BASE, ETAX_PATHS, ETAX_CLIENT_IDS, ETAX_TAX_STATUS,
                            ETAX_FORMS (vat ТТ-03А), төлөв + шошго, ETAX_VAT_FIELDS, ETAX_ERRORS
lib/itc/etax/api.ts         ЦЭВЭР (tests/etax-api.test.ts): parseUserOrgs/pickEtaxOrg, parseReportList/
                            findVatReportRow, parseHistory/taxStatusToEntry/findHistoryRow, parseFormDetail/
                            describeCell, normalizeCellMapping/mappingProblems/buildReportDataDetail,
                            reportHeadOf/saveFormDataBody/submitBody, parseSaveResponse/parseSubmitResponse
lib/itc/etax/client.ts      SERVER HTTP: etaxClientId/etaxNeKey/etaxApiBase (env), Bearer + NE-KEY,
                            fetchEtaxUserOrgs/ReportList/History/FormDetail, saveEtaxFormData, submitEtaxReport
lib/itc/etax/submission.ts  ЦЭВЭР (tests/etax-submission.test.ts): buildVatSnapshot, validateVatSnapshot,
                            snapshotAmountsDiffer, ETAX_TRANSITIONS (draft→ready→saved→submitted→…),
                            isPostingTransition, requiresTaxReference, normalizeTaxReference
lib/itc/etax/types.ts       view төрлүүд (Connection/Mapping/Submission/PageData, EtaxReportChoice)
lib/itc/etax/store.ts       DB: холболт, etaxSessionOf/requireEtaxSession, checkEtaxConnection, mapping row/view,
                            loadEtaxPageData, prepareVatSubmission, transitionEtaxSubmission
lib/itc/etax/tax-flow.ts    DB + API: syncEtaxOrg, loadEtaxReportChoices, fetchEtaxTemplate, saveEtaxMapping,
                            saveSubmissionToTax, submitSubmissionToTax, refreshTaxStatus,
                            fetchEtaxSheetTemplates, saveEtaxSheetMappings, saveSheetsToTax (§7)
lib/itc/etax/sheet-source.ts  DB: loadVatSheetRows — АР/АП баримтаас задаргаа (харилцагчаар / баримтаар)
lib/actions/etax.ts         Server Actions (ActionResult): холболт (admin), syncEtaxOrganization,
                            getEtaxReportChoices, fetchEtaxFormTemplate, saveEtaxFormMapping (admin),
                            prepareEtaxVatReturn, saveEtaxSubmissionToTax, refreshEtaxSubmissionStatus
                            (tax:write), submitEtaxSubmissionToTax, setEtaxSubmissionStatus (tax:post)
app/(dashboard)/tax/etax/page.tsx       хуудас (tax layout-ийн ModuleGuard дор)
components/tax/etax-view.tsx            карт, илгээлт, API/гар товчнууд, түүх (DataGridDynamic)
components/tax/etax-connection-settings.tsx  тохиргоо + «Байгууллага татах» (админ)
components/tax/etax-mapping-editor.tsx       маягтын нүдний холболт (админ)
components/tax/etax-sheet-editor.tsx         хавсралт мэдээний холболт (админ, §7)
lib/db/schema.ts            etax_connections (+entId…), etax_form_mappings, etax_submissions (+reportNo, taxStatus*)
lib/status.ts               ETAX_STATUS_TONES
```

## 5. Staging-д батлах зүйл (Монголын IP шаардахгүй — etax.mta.mn, auth.itc.gov.mn гадаадаас нээгддэг)

1. Бодит орчны Keycloak **client_id** (спек зөвхөн staging `etax-api-staging`) — ITC-ээс; хүртэл `etax-gui`
2. `NE-KEY` staging/бодит — ХСН-д posapi@itc.gov.mn / ТЕГ-ийн ТТҮГ албан бичиг (00 §4.4)
3. `getUserOrgs` хариу массив уу, нэг объект уу (parser хоёуланг уншина); олон байгууллагад регистрээр
4. `getList`-д `activitiType` байхгүй — `reportHeadOf` 1 гэж явуулна (спекийн жишээ); ТЕГ татгалзвал
   `getFormData`/жагсаалтаас авах
5. Шинэ тайланд `reportNo = 0`-оор `saveFormData` хүлээн авах эсэх; `isDisable` = «утга авна» утга
6. Хавсралт мэдээ: `getSheetDetail` хариуны хэлбэр (хавтгай массив уу — parser хоёуланг уншина),
   `type`/`isTotal` утга, ТЕГ нийт мөр (`isTotal 1`) шаардах эсэх, мөрийн дээд хэмжээ (хуудаслалт)

## 6. Дараагийн алхам

1. ХАОАТ (`payroll_runs`), ААНОАТ маягтууд — ижил snapshot/holbolt загвараар (`form` түлхүүр нэмнэ)
2. `attention.ts`: хуулийн хугацаа ойртсон тушаагаагүй тайлан (`getLateList`) → «Анхаарах»
3. MCP tool: `get_etax_submissions` (унших), `prepare_etax_vat_return` (ноорог); илгээх tool НЭМЭХГҮЙ
   (`[HUMAN_REQUIRED]` — татварын тайлан = хүний баталгаажуулалт)

## 7. Хавсралт мэдээ (sheet, спек §3.11–§3.15)

Маягтын хавсралт мэдээ (борлуулалт / худалдан авалтын задаргаа) ч динамик: `getSheetList`
(reportNo-той тайланд) → мэдээ бүрийн `getSheetDetail` → баганууд (`columnKey`). Тиймээс:

- **Холболт** (`etax_form_mappings.sheets`, админ, нэг удаа): мэдээ бүрд ЭХ — `sales`
  (ar_invoice + ar_credit_note), `purchases` (ap_bill + ap_debit_note), эсвэл `null` (илгээхгүй);
  нэгтгэл — `counterparty` (регистр → ТТД → нэрээр нийлбэр) | `document` (баримт бүрээр);
  багана — Entry талбар (`ETAX_SHEET_FIELDS`: регистр, ТТД, нэр, баримтын №, огноо, ДДТД,
  цэвэр, НӨАТ, нийт, баримтын тоо, д/д) → `columnKey`. Харилцагчийн таних + дүнгийн багана ЗААВАЛ
- **Эх өгөгдөл** (`sheet-source.ts`): батлагдсан (posted/partially_paid/paid) баримт, огноо тайлант
  үед; НӨАТ = мөрүүдийн `vat_settings`-ийн НӨАТ дансны дүн, нийт = `baseTotalAmount`, цэвэр = нийт −
  НӨАТ; буцаалт СӨРӨГ (`ledgerSign`); reversed орохгүй; POS-ийн АР нэхэмжлэх ч орно
- **Бичилт** (`saveSheetsToTax`, tax:write, ЗӨВХӨН `saved` төлөвт): эхтэй мэдээ бүрд
  `deleteAllSheetData` → `saveSheetData` (мөр 0 бол зөвхөн устгана); `sheetsSavedAt`/`sheetsSummary`;
  дахин бичих боломжтой; «ТЕГ-д илгээх»-ийн өмнө. Нийт мөр (`isTotal`) Entry бичихгүй — ТЕГ бодно
  гэж таамаглав (staging §5.6)
- Мэдээний загвар татах нь reportNo шаарддаг тул UI-д «Мэдээний загвар татах» зөвхөн ТЕГ-д
  хадгалсан илгээлттэй үед идэвхтэй
