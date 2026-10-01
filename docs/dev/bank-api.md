# Банкны API холболт (Corporate Gateway) — Фаз 1: Голомт, ЗӨВХӨН унших

`CLAUDE.md`-ийн «Банкны API» хураангуйн дэлгэрэнгүй. Эх баримт: Голомт банкны
**Open Banking Interface SPEC 1.5.9** (банкнаас хувиар ирсэн, repo-д БАЙХГҮЙ).

## 1. Урсгал

```
Касс → Банкны хуулга → [данс сонгох] → «Голомтоос татах» (огнооны муж)
  → fetchGolomtStatement (lib/actions/bank-api.ts, cash:write)
      → GolomtClient: LGIN → OPERACCSTAINQ (хуудас бүр) — lib/bank/golomt/client.ts
      → golomtStatementToParsed (ЦЭВЭР) + өмнө импортлогдсоныг алгасах (externalRef)
  → файлын импорттой ЯГ ИЖИЛ хянах хүснэгт (данс оноох, дүрэм, санал)
  → «Хадгалах» → saveBankStatement (lib/cash/import-statement.ts) → GL
```

- Татах нь **GL-д юу ч бичихгүй** — хэрэглэгч хянаж, данс оноож «Хадгалах» дарна
  (§9 human-in-the-loop). Тусдаа импортын логик ХОРИОТОЙ — нэг `saveBankStatement`.
- Давхардал: мөр бүр `externalRef` = `golomt:<данс>:<tranId>:<tranPostedDate>:<C|D>:<дүн>`
  (`recNum` оролцохгүй — хүсэлт бүрд өөрчлөгддөг). Татахад өмнө хадгалагдсаныг
  алгасна, хадгалахад дахин шалгаж татгалзана (`lib/cash/statement-external-refs.ts`,
  байгууллагын түвшинд). Огнооны муж давхцсан татал ижил гүйлгээг ДАХИН бичихгүй.
- Кассын данс Голомтынх гэж тооцогдох нь: `bankCode = 150000` эсвэл банкны нэрэнд
  «Голомт/Golomt» + дансны дугаартай (`isGolomtCashAccount`). Дансны дугаар = API-ийн `accountId`.

## 2. Аюулгүй байдал (ХАТУУ)

- **Фаз 1 зөвхөн унших:** ACCTLST, OPERACCSTAINQ (+ нэвтрэх). Гүйлгээ хийх
  (CGWTXNADD, CGWBLKTXN) болон түүний TOTP түлхүүр (**X-GOLOMT-KEY**) Entry-д
  ОРУУЛАХГҮЙ, хадгалахгүй — тохиргоо алдагдсан ч мөнгө хөдлөхгүй.
- Нууц (нууц үг, session key, IV key) `bank_api_connections`-д `encryptSecret`
  (AES-256-GCM, AUTH_SECRET-ээс) — утга нь client, лог, аудит, алдааны текстэд
  ХЭЗЭЭ Ч гарахгүй. Талбарууд write-only: хоосон бол хуучнаа хадгална.
- Хост ЗӨВХӨН `GOLOMT_API_BASE` (uat / production) — хэрэглэгч URL оруулахгүй.
- Тохиргоо засах/шалгах/устгах admin+; татах `cash:write`. Хадгалах, устгах,
  татах бүр `logAuditEvent` (`bank_api_connection`).
- Тестэд ЗӨВХӨН дамми түлхүүр. Банкнаас ирсэн UAT/production нууцыг repo, тест,
  баримт, чатад бичихгүй.

## 3. Протокол (SPEC-ээс, UAT дээр батлагдсан хэсэг тэмдэглэгдсэн)

| Зүйл | Утга |
|------|------|
| Хост | UAT `https://openapi-uat.golomtbank.com/api`, үндсэн `https://openbank.golomtbank.com/api` |
| Зам | SPEC-ийн `/v1/...` (2026-09-30 UAT-д шалгав: `/v1/auth/login` → 400 validation, жишээ кодын `/auth/login`, `/account/balance/inq/v1` → 404 — банкны жишээ код ХУУЧИРСАН) |
| Нэвтрэх | `POST /v1/auth/login`, `X-Golomt-Service: LGIN`, `{name, password: AES(нууц үг)}`, checksum-гүй; token 300 сек |
| Сэргээх | `GET /v1/auth/refresh`, `Authorization: Bearer <refreshToken>` — 240 сек-ээс хойш |
| Checksum | `AES-CBC(sha256_hex(ИЛГЭЭХ body-ийн ЯГ ТЭР текст))` → Base64. Объектыг дахин stringify хийхгүй |
| Шифр | AES-CBC/PKCS7, түлхүүр = session key-ийн UTF-8 байт (16/24/32), IV = IV key (16) |
| Хариу | Base64 шифртэй JSON; алдаа, нэвтрэх, `/v1/utility` шифргүй JSON (`{status, message, debugMessage}`) |
| OAuth | Эхний хүсэлтэд `client_id/state/scope` ГУРВУУЛАА хоосон (SPEC §5 алхам 2 — тохиргооны Client ID-г илгээхгүй: 2026-10-01 UAT-д client_id-тай эхний хүсэлт `merchant.details.not.present` буцаасан). Банк grant (`clientId, state, scope, redirectUri` эсвэл `url: …?response_type=code&client_id=…`) буцаавал түүгээр НЭГ удаа дахин илгээнэ; дахиад grant бол зөвшөөрлийн холбоостой ил алдаа |
| Алдааны хариу | 4xx/5xx хариу ч Base64 AES-ээр шифрлэгдэж ирдэг (2026-10-01 UAT: ACCTLST / OPERACCSTAINQ-ийн 400) — клиент тайлж уншина (`plainErrorBody`); шифртэй текст логт бичигдэхгүй |
| Алдааны код | `subErrors[].code` — `MERDET0001` (`merchant.details.not.present`) = нэвтрэх нэр банкинд бүртгэлгүй (2026-10-01 UAT-д зохиомол нэрээр батлав); талбарын шалгалтын монгол мессеж (ж: «Нэвтрэх нууц үг оруулна уу») шууд харагдана (`KNOWN_BANK_ERRORS`, client.ts) |
| Алдаа | Мессеж алхмыг нэрлэнэ (нэвтрэх / дансны жагсаалт / хуулга татах) + HTTP статус + банкны код; 200 хариутай `status: FAILED` / `errDesc` ч алдаа. Серверийн логт `[golomt] <service> …` (нууц, токен, өгөгдөлгүй) |
| Хуулга | `OPERACCSTAINQ` `{accountId, registerNo, startDate, endDate, page, size:100}` → `statements[]{tranId, drOrCr, tranAmount, tranDesc, tranPostedDate, tranCrnCode, exchRate}`, `totalPages` |

Хуулгад харьцсан данс/харилцагчийн нэр ИРДЭГГҮЙ — харилцагчийн саналыг гүйлгээний
утга (tranDesc) болон П8 дүрмээр гаргана.

**UAT-д бодит нууцаар шалгах үлдсэн зүйл:** нэвтрэх нууц үгийн Base64 төрөл
(standard уу, URL-safe уу — жишээ кодууд зөрдөг, standard сонгосон), grant-ийн
урсгал корпорацын эрхэд хэрэгтэй эсэх, `exchRate`-ийн утга валютын дансанд.

## 4. Ханш, валют

- MNT данс: ханш 1. Валютын данс: банкны `exchRate` > 1 бол түүгээр, эс бөгөөс
  ХООСОН — хэрэглэгч хадгалахаас өмнө бөглөнө (ханш ЗОХИОХГҮЙ). Хуулгын валют
  кассын дансны валютаас зөрвөл ил алдаа.

## 5. Файлууд

| Файл | Агуулга |
|------|---------|
| `lib/bank/golomt/constants.ts` | ЦЭВЭР, client-safe: хост, орчин, данс танилт, огнооны мужийн шалгалт |
| `lib/bank/golomt/crypto.ts` | ЦЭВЭР (node:crypto): AES, checksum |
| `lib/bank/golomt/statement.ts` | ЦЭВЭР: хуулга → `ParsedBankStatement`, externalRef |
| `lib/bank/golomt/client.ts` | HTTP клиент (fetch тарьж болно) |
| `lib/bank/golomt/connection.ts` | DB: тохиргоо, нууц тайлах, татах |
| `lib/actions/bank-api.ts` | Server Actions (`ActionResult`) |
| `components/cash/golomt-dialogs.tsx` | Холболтын тохиргоо, татах диалог |
| `tests/golomt-bank-api.test.ts` | Шифрийн вектор, mapping, хуурамч банктай протокол |

## 6. Дараагийн фаз (хийгдээгүй)

- Хаан банк, ХХБ — гэрээ/туршилтын эрх ирмэгц ижил `bank_api_connections` + adapter.
- Автомат өдөр тутмын татлага (scheduler) — одоогоор гараар.
- Үлдэгдлийн тулгалт (ACCTBALINQ) тулгалтын хуудсанд.
- Гүйлгээ хийх (Фаз 2) — maker/checker, AI эхлүүлэх ХОРИОТОЙ; тусдаа шийдвэр.
