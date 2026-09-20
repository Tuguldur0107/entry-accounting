# Дэмжлэгийн хандалт (support access)

**Асуудал.** Харилцагчийн байгууллагад асуудал гарахад (сар хаагдахгүй,
тулгалт зөрж байна, eBarimt илгээгдэхгүй) платформын оператор өгөгдлийг нь
харахгүйгээр оношлох боломжгүй. Гэхдээ апп дотор «супер админ» РОЛЬ үүсгэх
нь хамгийн аюултай зам: тэр эрх нэг удаа үүсмэгц үүрд үлдэж, хэн ч, хэзээ ч
хэрэглэж болох болно.

**Шийдэл.** Эрхийг ХЭРЭГЛЭГЧИД биш **СЕССЭД** уяв. Хандалт бүр нь Entry
Console-оос олгогдсон, хугацаатай, нэг хүнд уягдсан, аудитад ил бичигддэг
линк — апп дотор ямар ч платформын роль, платформын хуудас БАЙХГҮЙ
(CLAUDE.md §billing: «апп дотор platform admin эрх ҮҮСГЭХГҮЙ»).

## Урсгал

```
Console → байгууллага → «Байгууллагад нэвтрэх»
   POST /api/platform/support-sessions  (Bearer ENTRY_PLATFORM_API_KEY, зөвхөн saas)
   body { organizationId, email, role?, reason?, actor? }
        ↓  линк (15 мин хүчинтэй, нэг хэрэглэгчид уягдсан)
GET  /entry/support/enter?token=…
   ├─ нэвтрээгүй бол NextAuth /login?callbackUrl=… (оператор ӨӨРИЙН дансаар)
   ├─ token → sha256 → platform_support_sessions; эзэн, хугацаа шалгагдана
   ├─ startedAt тавигдаж сесс 1 ЦАГ хүчинтэй болно
   ├─ httpOnly cookie `ea-support` тавигдана
   └─ АУДИТ `support_session / support_entered` + эзэн/админд instant мэдэгдэл
        ↓
getActiveOrg() — cookie хүчинтэй бол scope нь ТЭР байгууллага
   viewer (default) → зөвхөн унших  ·  admin → бичих, тохиргоо
   owner ХЭЗЭЭ Ч олгогдохгүй (байгууллага устгах, эзэмшил шилжүүлэх боломжгүй)
        ↓
Топбарын ШАР БАННЕР: «Дэмжлэгийн хандалт — <байгууллага> · үлдсэн N мин»
   «Дэмжлэгээс гарах» → cookie устаж, сесс хаагдаж, АУДИТ `support_exited`
```

## Хатуу дүрмүүд

- **Линк ЗӨВХӨН Console-оос** — `lib/api/platform-auth.ts` хаалга (timing-safe
  Bearer, saas-only, rate limit). Апп дотор олгох зам байхгүй.
- **Линк нэг хэрэглэгчид уягдана** (`userId`): и-мэйлээр нь БАЙГАА Entry данс
  олдоно — данс ЗОХИОХГҮЙ. Линк алдагдсан ч өөр хүн ашиглаж чадахгүй.
- **Хоёр хугацаа:** ашиглагдаагүй линк 15 мин (`SUPPORT_LINK_TTL_MS`),
  идэвхжсэн сесс 1 цаг (`SUPPORT_SESSION_TTL_MS`). Дахин орох нь хугацааг
  СУНГАХГҮЙ.
- **DB-д зөвхөн sha256 hash** (`token_hash`) — auth_tokens / api_tokens-тай
  ИЖИЛ зарчим.
- **Аудит + мэдэгдэл ЗААВАЛ:** орох/гарах бүр `audit_events`-д
  (`support_session`) бичигдэж харилцагч `/settings/audit` дээрээ хардаг;
  орох мөчид эзэн/админд `security.support_access` мэдэгдэл (instant и-мэйл).
  Дэмжлэгийн хандалт ХЭЗЭЭ Ч чимээгүй болохгүй.
- **Сесс идэвхтэй үед байгууллагын сонгогч ганц мөртэй** (`getMyOrgs`) —
  оператор өөрийн байгууллага руугаа санамсаргүй бичихгүй.
- **MCP / REST token-ий зам дэмжлэгийн сессийг ХЭРЭГЛЭХГҮЙ**
  (`currentSupportSession` impersonation store байвал null буцаана) — API
  token өөрийн scope-той.
- **Багцын read-only давамгайлна:** `assertWritesAllowed` нь дэмжлэгийн
  сессэд ч үйлчилнэ (admin түвшинд ч төлбөр хоцорсон байгууллагад бичихгүй).

## API

| Зам | Тайлбар |
|-----|---------|
| `GET /api/platform/organizations?id=` | Байгууллагын дэлгэрэнгүй (профайл, гишүүд, тоо, тохиргооны төлөв). ЗӨВХӨН унших; нууц үг, token, лого/тамга, бизнесийн бичилт буцаахгүй |
| `GET /api/platform/support-sessions?organizationId=&limit=` | Сессийн түүх (`pending`/`active`/`expired`/`ended`) |
| `POST /api/platform/support-sessions` | Линк олгох → `{ url, expiresAt, role }` |
| `DELETE /api/platform/support-sessions?id=` | Идэвхтэй сессийг ТАСЛАХ (Console-оос) |

## Код

```
lib/platform/support.ts        ЦЭВЭР (tests/support-session.test.ts): хугацааны
                               хоёр цонх, төлөв, эрхийн танилт, cookie maxAge
lib/platform/support-store.ts  DB давхарга: issue / start / loadActive / end / list
lib/platform/org-detail.ts     Console-ийн байгууллагын дэлгэрэнгүй (унших)
lib/auth.ts                    currentSupportSession + getActiveOrg-ийн шалгалт
app/support/enter              Линк → cookie → аудит → апп руу
app/support/denied             Хүчингүй линкийн тайлбар (шалтгаан ил)
lib/actions/support.ts         exitSupportSession (баннерын товч)
components/layout/support-banner.tsx  Топбарын доорх шар баннер
```
