# ITC developer портал (developer.itc.gov.mn) — холболтын бэлтгэл

**Зорилго:** «Цахим татварын систем» (eTax) ба «Цахим санхүүгийн тайлангийн
систем» (e-Balance)-тэй холбогдох ирээдүйн ажилд шаардлагатай БҮХ албан эх
сурвалж, хаяг, нэвтрэлт, орчин, дүрмийг нэг дор хадгална. Холболтыг эхлэхээс
ӨМНӨ энэ баримтыг уншина; шинэ мэдээлэл олдвол ЭНД нэмнэ (тархай баримт үүсгэхгүй).

**Төлөв (2026-09-25):** судалгаа. eBarimt (PosAPI 3.0) хэсэг албан агуулгаар
бүрэн тулгагдсан — `01-ebarimt-posapi-verification.md`. eTax API-ийн
дэлгэрэнгүй спек (PDF) ба developer порталын eTax хуудас энэ орчноос
уншигдаагүй (§7 — хандалтын хязгаар); Монголын сүлжээнээс татаж §4-ийг нөхнө.

---

## 1. Портал юу вэ

| Зүйл | Утга |
|---|---|
| Хаяг | https://developer.itc.gov.mn/ (Stoplight дээр суурилсан API баримтын портал) |
| Эзэн | **СМТТ УТҮГ** — «Санхүүгийн мэдээллийн технологийн төв» Улсын төсөвт үйлдвэрийн газар (Сангийн яамны харьяа; гааль, татвар, санхүүгийн мэдээллийн нэгдсэн системүүдийг хөгжүүлдэг) |
| Холбоо барих | info@itc.gov.mn; PosAPI/eBarimt асуудал **posapi@itc.gov.mn**, утас 99974468 (Б.Булганжаргал — PosAPI 3.0 зааврын хариуцагч); хаяг: УБ, Хан-Уул, 15-р хороо, Махатма Ганди 31/1, NM Tower 16 давхар |
| Postman | Портал дээрх API-г «Original» сонгож export → Postman collection болгож импортолно (`/docs/ebarimt-api/uunzbhjh8se4c-postman`) |
| Хандалт | **Монголын IP-ээс** л найдвартай нээгдэнэ (§7). Порталын хуудас бүр `/docs/<project>/<nodeId>-<slug>` хэлбэртэй; nodeId нь тогтмол, slug өөрчлөгдөж болно |

### 1.1 Порталын «API бүхий системүүд» (нүүр хуудасны жагсаалт, 2026)

| Систем | Portal path / линк | Entry-д хамаарал |
|---|---|---|
| **Нэвтрэлтийн нэгдсэн систем** (auth.itc.gov.mn, Keycloak) | PDF: `share.itc.gov.mn/share/st-kc/user-manual/userManual.pdf` | Бүх ITC API-ийн token-ийн эх (§2) |
| **Цахим төлбөрийн баримтын систем** (eBarimt / PosAPI 3.0) | `/docs/ebarimt-api/8mw1byololjkv-cz-ahim-t-lb-rijn-barimtyn-sistem-pos-api-3-0` | ✅ ХЭРЭГЖСЭН — `docs/pos/03`, `docs/deployment/ebarimt.md`, тулгалт `01-ebarimt-posapi-verification.md` |
| **Цахим татварын систем** (eTax, etax.mta.mn) | `/docs/etax-api/u5lwigkjw3pcv-tanilczuulga` · PDF: `share.itc.gov.mn/share/st-kc/user-manual/ETAX%20API%20documentation%20v1.1.pdf` («Цахим тайлангийн системийн вэбсервисийн холболтын …») | 🎯 Дараагийн холболт — §4 |
| **Ухаалаг гарц** (SmartGate — гаалийн) | `/docs/smartgate-api/nlfjso9nnm5a6-tanilczuulga` | Импортын гаалийн мэдүүлэг — хожим (PO landed cost-той холбож болно) |
| **Бараа бүртгэлийн нэгдсэн систем** (ББНС) | Нүүрэнд линкгүй; API нь ebarimt-api дотор (`/api/info/check/barcode/all`, `.../barcode/v2/…`) | Барааны баркод · БҮНА ангилалын лавлах — ангилалын код сонгогчид ашиглаж болно |
| **Онцгой албан татвар бүртгэлийн систем** (ОАТ) | `/docs/ontsgoi/w5gtxmkkd3a14-tanilczuulga` · `service.itc.gov.mn/rest/tpiMain/mainApi/getInventoryList`, `/api/inventory/getActiveStockNoPos` | Архи/тамхи борлуулагч харилцагчид: `items[].data.stockQR` (2025-04-01-ээс заавал) — одоо ДЭМЖИГДЭЭГҮЙ (01-р баримт §3) |

> **e-Balance («Цахим санхүүгийн тайлангийн систем») ЭНЭ ПОРТАЛД БАЙХГҮЙ.**
> Тэр нь Сангийн яамны систем (ebalance.mof.gov.mn), СМТТ-ийн API порталаас
> тусдаа — §5.

---

## 2. Нэвтрэлт (бүх ITC API-д нийтлэг)

ITC-ийн бүх сервер-талын API Keycloak OpenID Connect token-оор нэвтэрнэ
(Нэвтрэлтийн нэгдсэн систем). Token авах:

```
POST {authBase}/auth/realms/{realm}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded
grant_type=password&client_id={client}&username={нэвтрэх нэр}&password={нууц үг}
→ { access_token, expires_in, refresh_token, refresh_expires_in, token_type, session_state, scope }
```

| Орчин | authBase | realm | Тайлбар |
|---|---|---|---|
| Хөгжүүлэлт (staging) | `https://st.auth.itc.gov.mn` | `Staging` | Тестийн хэрэглэгч (eBarimt): `АА10010110` / `Test@123` — нийтэд ил, албан зааварт бичигдсэн |
| Бодит (production) | `https://auth.itc.gov.mn` | `ITC` | Байгууллагын ДАН/ITC бүртгэлээр |

`client_id` нь хандаж буй домэйнээс хамаарна (албан заавар):

| Хандах домэйн | client_id |
|---|---|
| `https://api.ebarimt.mn` (eBarimt TPI: борлуулалтын задаргаа, мерчант бүртгэх …) | `vatps` |
| `https://service.itc.gov.mn` (хялбар бүртгэл, ОАТ, easy-register) | `e-inventory` |
| eTax GUI (`etax.mta.mn`) — вэбийн нэвтрэлт | `etax-gui` (redirect-ээс ажиглагдсан; API-ийн client_id-г §4.4-ийн асуултаар тодруулна) |

- Зөвхөн `access_token`-ийг ашиглана (албан заавар); `Authorization: Bearer <token>`
- Зарим TPI сервис нэмэлт **`X-API-KEY`** толгой шаарддаг — ХСН (хэрэглэгчийн
  систем нийлүүлэгч) байгууллагад posapi@itc.gov.mn-ээс олгоно (staging түлхүүр
  зааварт ил: `9406e79323ec0fed4e560342bce72221107a808b`)
- Entry-д: token-ийг `lib/ai/crypto.ts`-ийн `encryptSecret`-ээр шифрлэж хадгална
  (QPay түлхүүртэй ижил зарчим), лог/аудит/health-д утга ХЭЗЭЭ Ч гарахгүй

---

## 3. Сүлжээ, орчин, хязгаар (БҮХ ITC системд)

| Дүрэм | Эх | Entry-д нөлөө |
|---|---|---|
| `api.ebarimt.mn` (103.17.108.216/217), `auth.itc.gov.mn` (103.87.69.75/76) — **зөвхөн Монгол Улсын сүлжээнээс**; гадаадаас Монгол IP-тэй VPN | PosAPI 3.0 API холболтын заавар «Сүлжээний тохиргоо» | Railway (гадаад бүс) дээрх Entry сервер ТЕГ-ийн нийтийн лавлах (`getTinInfo`/`getInfo`/`getBranchInfo`), TPI, eTax API-д **ШУУД хүрэхгүй байх магадлал өндөр** — Монголд байрлах egress (операторын сервер / VPN / прокси) шаардлагатай. `01-ebarimt-posapi-verification.md` §3 P1 |
| PosAPI-г нийтийн сүлжээнд ил тавихгүй, зөвхөн дотоод сүлжээ | Best practices §3 | Entry (cloud) ↔ операторын PosAPI хооронд хувийн суваг (VPN/tunnel), IP allowlist |
| PosAPI: ≤1000 мерчант, ≤100 000 баримт/өдөр, DB ping <100ms | Best practices §1, 2, 4 | Операторын загварт (нэг PosAPI, олон харилцагч) хяналтын босго |
| Staging: `st-operator.ebarimt.mn`, `stg-invoice.ebarimt.mn`, `st-api.ebarimt.mn`; тест мерчант ТТД `37900846788` (РД 99119911), түрээслэгч `61200064714`; TEST OPERATOR1 | Туршилтын орчны заавар | Автомат тест энд л (ачааллын тест ХОРИОТОЙ) |
| Monpass тоон гарын үсэг ITC системд ажиллахгүй (2025-05-22) — Гэрэгэ / Инфосерт / Тридум | Мэдэгдэл | Харилцагчид E-sign гэрээ байгуулахад зөвлөнө |
| Хувь хүний мэдээлэл: иргэний РД-аар ТИН лавлах (`getTinInfo?regNo=`) **2026-06-15-аас зогсоох** төлөвлөгөө | Мэдэгдэл 2026-05-11 | Entry B2B лавлах (`lib/ebarimt/lookup.ts`) — 01-р баримт §3 P1 |

---

## 4. Цахим татварын систем (eTax) — холболтын бэлтгэл

### 4.1 Мэддэг зүйл (албан эх сурвалжаас)

- **Систем:** etax.mta.mn (ТЕГ), 2019 оноос e-tax.mta.mn-ийг орлосон; нэг
  нэвтрэлтээр etax / itax / eBarimt (Засгийн газрын 2016-12-07-ны 177-р тогтоол —
  татварын бүх үйлчилгээг цахимжуулах). Албан мэдээлэлд «санхүүгийн программаас
  татварын тайланг **шууд илгээх**, цахим баримтын мэдээллээс хялбаршуулсан
  тайлан бэлтгэх» боломж гэж заасан → API нь **тайлан илгээх** зорилготой.
- **Порталын нэр:** «Цахим татварын систем» проект `etax-api`, эхний хуудас
  «Танилцуулга» (`u5lwigkjw3pcv-tanilczuulga`). Дэлгэрэнгүй спек нь PDF
  **«ETAX API documentation v1.1»** — гарчиг нь «Цахим тайлангийн системийн
  вэбсервисийн холболтын [заавар]».
- **Нэвтрэлт:** Нэвтрэлтийн нэгдсэн систем (§2) — realm `ITC`, вэб client
  `etax-gui`; API-ийн client_id / эрх олголтын журам PDF-д (§4.4).
- **Татварын хуваарь (Entry-д одоо байгаа):** `lib/tax/calendar.ts` — НӨАТ
  дараа сарын 10, НДШ 5 (ndaatgal.mn — ITC биш), ХАОАТ 10, ААНОАТ улирлын дараа
  сарын 20; жилийн ААНОАТ дараа оны 2-р сарын 10.
- **Холбогдох eBarimt TPI сервисүүд** (НӨАТ тайлангийн тулгалтад шууд хэрэгтэй,
  `api.ebarimt.mn`, Bearer `vatps` + `X-API-KEY`):
  - `POST /api/tpi/receipt/getSalesTotalData` — борлуулалтын задаргаа (жил/сар/өдөр,
    status: 0 бүгд · 1 B2B · 2 сугалаатай · 3 нэхэмжлэх · 4 багцын толгой; startCount/endCount)
    → `posRno` (ДДТД), `posRdate`, `posRamt`, `posVamt` (НӨАТ), `cityTax`, `netAmt`,
    `csmrRegNo/csmrName`, `posNo`, `districtCode`; 2025-09-01-ээс `prParentRno`
    (нэхэмжлэхийн төлөлт болох баримт). Том татвар төлөгчид зориулсан.
  - `POST /api/tpi/receipt/getSaleListERP` — толгой татвар төлөгч охин компанийнхаа
    **худалдан авалтыг** татах (`Pin`, `subPin[]`, `StartDate`, `EndDate`) →
    `receiptBuyModelList[]` (`prPosRno`, борлуулагчийн `regNo/name`, `amountVat`,
    `amountCityTax`, `amountTotal`, `amountNet`, `fromType`, 2025-09-01-ээс `receiptType`)
    → **оролтын НӨАТ-ын eBarimt тулгалт** (АП баримт ↔ ТЕГ-ийн бүртгэл).
  - `GET /api/info/check/getInfo?tin=` → `vatPayer`, `cityPayer`, `freeProject`
    (true бол `taxType VAT_FREE` + `taxProductCode "304"`), `isGovernment`,
    `vatpayerRegisteredDate` — харилцагчийн картын НӨАТ төлөгч тэмдэглэгээг автоматжуулна.

### 4.2 Entry-д хийх ажлын хүрээ (санал)

| # | Юу | Entry-ийн эх | Хэлбэр |
|---|---|---|---|
| E1 | **НӨАТ тайлан илгээх** (сарын) — `computeVatReturn` (`lib/vat/return.ts`) дүнг eTax-ийн НӨАТ маягтын мөрүүдэд буулгаж илгээх; батлагдсан тайлангийн ID/статусыг `vat_settlement`-тэй холбох | `/vat`, `get_vat_return` | Илгээхийн өмнө **ноорог + хүний баталгаажуулалт** (§9 draft-first) |
| E2 | **ХАОАТ / НДШ-ийн цалингийн тайлан** — ХАОАТ eTax-д (`payroll_runs`); НДШ нь ndaatgal.mn (ITC биш, тусдаа) | `lib/payroll/` | Хожим |
| E3 | **ААНОАТ улирал/жил** — орлогын тайлан + татварын тохируулга (татварын элэгдэл `taxAmount` мэмо, IAS 12 зөрүү) | `lib/reports/`, `lib/fa/` | Хожим; маягт олон мөртэй |
| E4 | **Татварын тайлангийн төлөв татах** (тушаасан/хүлээн авсан/хүлээгдэж буй) → `attention.ts` дохио, сар хаалтын checklist | `lib/notifications/attention.ts`, `/close` | Уншилт — аль ч горимд |
| E5 | eBarimt TPI-ээр **борлуулалт/худалдан авалтын тулгалт** (§4.1) → `reconcile_modules`-ийн шинэ хэсэг «ТЕГ ↔ Entry» | `lib/ai/tools.ts` | НӨАТ тайлангийн өмнөх алхам |

Хатуу дүрмүүд (CLAUDE.md-тэй нийцүүлнэ): тайлан **зохиохгүй** — GL-ээс бодогдсон
дүнг л илгээнэ; илгээлт бүр `logAuditEvent` (`tax_return` entityType) + мэдэгдэл;
eTax-ийн token/нууц шифртэй, `/api/health`-д зөвхөн тоолуур; AI/MCP tool
`submit_*` нь post горим + `[HUMAN_REQUIRED]` (татварын тайлан = хүний гарын үсэг).

### 4.3 Модулийн загвар (кодын байршил)

✅ **Scaffold 2026-09-25** — спек шаардахгүй хэсэг (нэвтрэлт, TPI) кодод, тесттэй;
eTax-ийн өөрийн замууд PDF ирмэгц нэмэгдэнэ (зохиохгүй):

```
lib/itc/
├── constants.ts     ✅ Орчин (staging/production authBase + realm), client_id (vatps /
│                    e-inventory / etax-gui), TPI зам, status, timeout, [CODE] — client-safe
├── auth.ts          ✅ ЦЭВЭР (tests/itc-auth.test.ts): itcTokenUrl, password/refresh grant body,
│                    parseItcTokenResponse (expires_in → expiresAt), isAccessTokenUsable
│                    (30 сек skew), isRefreshUsable, bearerHeader, describeToken (утгагүй лог)
├── tpi.ts           ✅ ЦЭВЭР (tests/itc-tpi.test.ts): salesTotalDataBody / saleListErpBody
│                    (Pin/subPin/StartDate/EndDate — албан), parseSalesTotalData /
│                    parseSaleListErp (танигдахгүй мөр алгасаж ТООЛНО), assertTpiStatus,
│                    reconcileDdtd (ТЕГ ↔ Entry ДДТД олонлог — E5-ийн суурь)
├── client.ts        ✅ SERVER: fetchItcToken / refreshItcToken (Keycloak), tpiSalesTotalData /
│                    tpiSaleListErp (Bearer + X-API-KEY, 60 сек timeout); env ITC_TPI_BASE
│                    (Монголд байрлах прокси — §3), ITC_ENV, ITC_TPI_API_KEY (.env.example)
├── etax/            ⏳ client.ts (REST), forms/ (маягт → JSON mapper, ЦЭВЭР, тесттэй), types.ts —
│                    «ETAX API documentation v1.1» PDF-ээс (§4.4 №2–3)
└── token-store.ts   ⏳ Байгууллага бүрийн token шифртэй (`encryptSecret`), refresh — DB давхарга
lib/actions/etax.ts  ⏳ Server Actions (requireModuleAction("vat"|"payroll", "post"), actionError)
app/(dashboard)/tax/etax   ⏳ Тохиргоо (холболт, орчин), илгээлтийн түүх, төлөв
```

⚠ `salesTotalDataBody`-ийн wire талбарын нэр (year/month/day/status/startCount/endCount)
албан ТАЙЛБАРЫН нэрээр — staging дээр Монголоос шалгаж баталгаажуулна (§4.4 №3).

### 4.4 Нээлттэй асуултууд — ITC-ээс (posapi@itc.gov.mn / info@itc.gov.mn) тодруулах

1. eTax API-д хандах **эрх**: ХСН (хэрэглэгчийн систем нийлүүлэгч) гэрээ eBarimt-тэй
   ижил үү, тусдаа хүсэлт үү; шалгалт (тест) шаардах уу
2. API-ийн **client_id / realm** (§2), **staging** хост (etax-ийн st орчин), sandbox татвар төлөгч
3. Дэмжигдэх **тайлангийн маягтууд** (НӨАТ ТТ-03? ХАОАТ ТТ-11? ААНОАТ ТТ-02?) ба
   маягт бүрийн JSON/XML схем, мөрийн код; хавсралт (борлуулалт/худалдан авалтын
   задаргаа) файлаар уу, мөрөөр үү
4. Илгээлтийн **урсгал**: ноорог → шалгалт (validation) → баталгаажуулалт (тоон
   гарын үсэг шаардах эсэх — 9.5) → хүлээн авсан; залруулга (нөхөн/засварласан тайлан)
5. **Хязгаар:** rate limit, хугацаа хэтэрсэн тайлан, төлбөрийн (etax «Төлөлт») API байгаа эсэх
6. `getSalesTotalData` / `getSaleListERP`-ийн X-API-KEY нь оператор (Entry) бүрд нэг үү,
   татвар төлөгч бүрд үү; өгөгдлийн эзний зөвшөөрөл (нүүрний «мэдээллийн эзний
   зөвшөөрлийн дагуу гуравдагч этгээдэд дамжуулна») хэрхэн бүртгэгдэх

---

## 5. Цахим санхүүгийн тайлангийн систем (e-Balance) — холболтын бэлтгэл

### 5.1 Мэддэг зүйл

| Зүйл | Утга |
|---|---|
| Систем | **ebalance.mof.gov.mn** (шинэ; хуучин `old-ebalance.mof.gov.mn/EBalance/`), Сангийн яам. Аймаг/дүүргийн Санхүү, төрийн сангийн хэлтэс хянаж хүлээн авна (`inspector-ebalance.mof.gov.mn`). **ITC порталын API биш** |
| Нэвтрэлт | Нэгдсэн нэвтрэлт (ДАН/и-мэйл + нууц үг + байгууллагын регистр); хуучин: регистр + ЗДТГ-ын СТСХ-ээс авсан код |
| Хууль | Нягтлан бодох бүртгэлийн тухай хууль (2015): **8.1** тайлангийн бүрдэл — санхүүгийн байдлын тайлан, орлогын дэлгэрэнгүй тайлан, өмчийн өөрчлөлтийн тайлан, мөнгөн гүйлгээний тайлан, тодруулга; **9.1** цахим хэлбэрээр, **9.5** тоон гарын үсэг; **10.3** хагас жилийн тайлан **7-р сарын 20**, жилийн **дараа оны 2-р сарын 10**; **10.4** нэгтгэсэн тайлан **3-р сарын 1** |
| Журам | «Аж ахуйн нэгж, байгууллагын санхүүгийн тайланг хүлээн авах, хянах, нэгтгэл хийх … журам» (legalinfo lawId=210883): систем хуулийн хугацааны эхний өдрөөс сүүлийн өдрийн 24:00 хүртэл нээлттэй; цахим тайланг ажлын 15 өдөрт хянаж хүлээн авна; маягтын дагуу бүрэн, тооцооллын алдаагүй; залруулга — хүсэлт + хэвлэмэл баримтаар, ажлын 5 өдөрт |
| Залруулгын цонх | Жилийн тайлангийн залруулга дараа оны 12-р сарын 20 хүртэл, хагас жилийнх тайлант оны эцэс хүртэл (Сангийн яамны 2023-03 мэдэгдэл) |
| Интеграци | **Нийтэд ил API / файл импортын албан спек ОЛДООГҮЙ** (2026-09-25). Систем нь ХУР-аар байгууллагын бүртгэл татдаг. Нягтлан «шивж» оруулдаг (Сангийн яамны заавар «И-баланс системд хэрхэн шивж, илгээх вэ»); Excel загвар/импорт байгаа эсэхийг системд нэвтэрч **шалгана** (§5.3) |

### 5.2 Entry-д хийх ажлын хүрээ (санал — API-гүй үед ч утгатай)

| # | Юу | Entry-ийн эх |
|---|---|---|
| B1 | ✅ **e-Balance маягтын дарааллаар тайлан гаргах** (2026-09-25) — `lib/reports/ebalance.ts` (ЦЭВЭР, тесттэй): СТ-1 БС (эхний/эцсийн), СТ-2 ОДТ, СТ-3 ӨӨТ, СТ-4 МГТ (шууд арга, S8 код → мөр) Entry-ийн `report_line_mappings` (BS/IS/CF)-аас; мөр бүрийн эх ил, харгалзах мөргүй маягтын мөр 0 + тэмдэглэл. Хуудас `/gl/reports?report=ebalance`, AI `get_ebalance_statements`. **Тодруулгын хүснэгтүүд** (ҮХ хөдөлгөөн, насжилт, бараа) — дараагийн алхам | `lib/reports/ebalance.ts`, `knowledge/03-стандарт/reports/01-line-mapping.md` |
| B2 | ✅ **Excel экспорт e-Balance-ийн маягтын хэлбэрээр** — 4 хуудастай нэг файл (`downloadWorkbookSheets`), мөрийн дугаараар хуулна; импортын спек гарвал ижил mapping-аас файл/JSON үүснэ. Маягтын мөрийн дугаар албан маягттай **тулгагдаагүй** (§5.3 №3) — `EBALANCE_*_FORM` нэг жагсаалтаас засна | `lib/excel/core.ts`, `components/gl/ebalance-view.tsx` |
| B3 | Сар хаалт → жилийн хаалт (`create_year_end_closing`)-ын дараа «e-Balance бэлэн» checklist: тэнцэл, өмчийн өөрчлөлт = ОДТ-ийн цэвэр ашиг, МГТ = кассын хөдөлгөөн (`reconcile_modules`) | `/close`, `attention.ts` (хугацаа 7/20, 2/10 — татварын хуанлитай нэг эх) |
| B4 | Хэрэв импорт/API гарвал: `lib/mof/ebalance/` — нэвтрэлт (ДАН OAuth?), маягт JSON, илгээлтийн түүх, аудит | — |

### 5.3 Нээлттэй асуултууд — Сангийн яам / ebalance тусламж (7018-2017?) / системд нэвтэрч шалгах

1. Шинэ e-Balance-д **файлаас (Excel/XML) оруулах** цэс байгаа эсэх, загвар файлын бүтэц
2. Программ хангамж нийлүүлэгчид зориулсан **API / мэдээлэл солилцооны гэрээ** (ХУР-аар эсвэл шууд)
3. Маягтын мөрийн код (санхүүгийн байдлын тайлангийн мөр бүрийн дугаар) — Сангийн яамны 2023-ын шинэчилсэн маягт
4. Тоон гарын үсэг: тайланг захирал + ерөнхий нягтлан хоёул зурах уу (9.5), Entry дотроос зурах боломж (E-sign SDK)

---

## 6. eBarimt (PosAPI 3.0) — албан лавлах (ХЭРЭГЖСЭН, товч)

Дэлгэрэнгүй: `docs/pos/03-ebarimt-integration-plan.md`, `docs/deployment/ebarimt.md`.
Порталын ebarimt-api проектын хуудсууд (2026-08 байдлаар; nodeId тогтмол):

| Хуудас | Path |
|---|---|
| Цахим төлбөрийн баримт API холболт (танилцуулга, TOKEN хостууд) | `c1tfgzwv4fe23-czahim-t-lb-rijn-barimt-api-holbolt` |
| POSAPI 3.0 системийн заавар + Best practices | `9ebc8iaq69ipw-posapi-3-0-sistemijn-zaavar` |
| PosAPI 3.0 API холболт зааврууд (posapi.ini, сүлжээ, идэвхжүүлэлт, эмийн сан) | `inbishdm2zj3x-pos-api-3-0-sistemijn-api-holbolt-zaavruud` |
| Өөрчлөлтийн түүх (v3.0.12, мэдэгдлүүд) | `hbtdfmovl87p0-…` |
| Туршилтын орчин | `u0vpfrq242mtu-posapi-3-0-sistemijn-turshiltyn-orching-ashiglah-zaavar` |
| ХСН-д тавигдах шаардлага (шалгалтын 18 зүйл) | `zm085dap73b7m-…-tavigdah-shaardlaga` |
| ХСН-ээр бүртгүүлэх (бодит орчин, E-sign) | `zm085dap73b9m-…-bodit-orchnoos` |
| Оператор-ИБаримт систем (operator.ebarimt.mn) | `3y4wht9xi9vxw-operator-i-barimt-sistem` |
| Token авах (staging) | `h4qz7kqjzd3p3-token-avah` |
| **POST /rest/receipt** Төлбөрийн баримт хадгалах | `etzeubckb91df-t-lb-rijn-barimt-hadgalah` |
| **DELETE /rest/receipt** Төлбөрийн баримт буцаах | `w7pedek4l5nu8-t-lb-rijn-barimt-buczaah` |
| GET /rest/info | `xy84sum9avx4v-azhillagaany-medeelel-h-leen-avah` |
| GET /rest/sendData | `q2dg4cjtbfsdx-t-lb-rijn-barimtyn-negdsen-sistemd-medeelel-ilgeeh` |
| GET /rest/bankAccounts | `i5pt9wo7bxq0y-bankny-dansny-medeelel-lavlah` |
| getTinInfo (РД → ТТД) | `fmm0i9s4dq2t9-tatvar-t-l-gchijn-dugaar-lavlah-tin-civil-id` |
| getInfo (ТТД → нэр, vatPayer, cityPayer, freeProject) | `0lh6tut76i7lb-b-rtgelijn-medeelel-lavlah` |
| getBranchInfo (дүүргийн код) | `fbdleubwxraqa-district-code-lavlah` |
| getProductTaxCode (VAT_FREE/ZERO кодын лавлах, огноотой) | `16ukw8k7rdro5-vat-free-vat-zero-no-vat-baraa-jlchilgeenij-kod-lavlah` |
| БҮНА ангилал/баркод (`/api/info/check/barcode/v2/…`, `/barcode/all`) | `said1mgfz0gb7-…`, `tb2umi3rs1u85-…` |
| Мерчантын байршил (`/api/info/cityTax/location`, X-API-KEY) | `t60f5v7q762rx-…` |
| Оператороос мерчант/түрээслэгч бүртгэх (`/api/tpi/receipt/saveOprMerchants`, `saveOprLessors`) | `5l5d2e9b18ve0-…`, `b0xntb7pqs0g8-…` |
| Борлуулалтын задаргаа / охин компанийн худалдан авалт (TPI) | `amem8bql9kgmn-…`, `2mi7tvxyzkxsi-…` |
| Хялбар бүртгэл (easy-register, `service.itc.gov.mn/api/easy-register/…`) | `i6179fzdicgrc-…` ба дэд хуудсууд |

PDF хувилбарууд (Монголын IP): `share.itc.gov.mn/share/developer/POS%20API%203.0.1.pdf`,
`.../combine.pdf`, `vat%20zero.xlsx`, `vat%20free%20good.xlsx`, `gs1_gs1.xlsx`.

---

## 7. Хандалтын тэмдэглэл (яагаад энэ баримт бүрэн биш)

2026-09-25-нд Entry-ийн cloud орчноос (гадаад IP) `developer.itc.gov.mn`,
`share.itc.gov.mn`, `ebalance.mof.gov.mn`, `mof.gov.mn` бүгд холболт тасалдаж
(connection reset / 503) нээгдээгүй; Wayback-д зөвхөн порталын нүүр (2024-06,
2026) хадгалагдсан, eTax хуудас ба PDF-үүд архивлагдаагүй. eBarimt хэсгийг
**2026-08-20-ны албан хуудсуудын хуулбар** (нээлттэй эх, MIT — Tsolmonx/ebarimt-mcp
`docs/api/`) + гурван нээлттэй SDK (techpartners-asia/ebarimt-pos3-go 2026-08,
Fibocloud/payment-sdks 2026-03, hurelhuyag/ebarimt 2025-02)-аар тулгав.

**Дараагийн алхам (Монголын сүлжээнээс, ~30 мин):**

1. Порталын `etax-api` проектын БҮХ хуудсыг Postman export эсвэл Stoplight
   «Export → Original» хийж `docs/integrations/etax/` дор хадгалах (нууц үг, API
   key оруулахгүй); PDF v1.1-ийг мөн хадгалах
2. §4.4, §5.3-ийн асуултуудыг ITC / Сангийн яамд албан бичгээр
3. e-Balance-д нэвтэрч импортын боломж, маягтын мөрийн кодыг баримтжуулах
4. `01-ebarimt-posapi-verification.md` §4-ийн staging тестийг ажиллуулах
