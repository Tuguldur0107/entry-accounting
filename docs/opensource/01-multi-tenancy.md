# Фаз 01 — Multi-tenancy: Байгууллага + Гишүүнчлэл

## Зорилго

Одоогийн «нэг хэрэглэгч = нэг компани» загварыг «байгууллага (organization) =
компани, хэрэглэгч олон байгууллагад гишүүн» загвар руу шилжүүлэх. Гол
хэрэглээний кейс: нягтлан/аудит фирмийн нэг нягтлан 10–30 клиент компанийн
бүртгэлийг НЭГ нэвтрэлтээр хөтөлнө; компани нэг байгууллагадаа хэд хэдэн
ажилтантай (эрхийн түвшинтэй) байна.

**Энэ фаз нээлттэй болгохын урьдач нөхцөл** — гадны fork үүссэний дараа
өгөгдлийн суурь загвар өөрчилбөл экосистем хоёр хуваагдана.

## Одоогийн байдал

*Шинэчилсэн: 2026-08-08 (аудит + НӨАТ/Цалин/Сар хаалт/Audit log нэмэгдсэний дараа)*

- `lib/db/schema.ts` — **55 хүснэгт** (2,006 мөр), бизнесийн бүх хүснэгт
  `userId`-аар хамгаалагдсан, `organizationId` байхгүй. 8/7-ноос хойш
  НЭМЭГДСЭН userId-тэй хүснэгтүүд (migration-д мөн орно): `vat_settings`,
  `employees`, `payroll_settings`, `payroll_runs` (+lines), `audit_events`
- `lib/auth.ts` — NextAuth v5 (Credentials + JWT), `runAsUser(userId, fn)`
  AsyncLocalStorage impersonation (MCP-д ашиглагддаг); login/register-т
  in-memory rate limit (`lib/rate-limit.ts`, identifier-ээр түлхүүрлэсэн)
- `lib/periods/guard.ts` — `assertPeriodOpen(userId, date)` +
  `assertPeriodOpenInTx(tx, userId, date)` (advisory lock түлхүүр 5,
  `hashtext(userId)`-аар) — org руу шилжихэд lock түлхүүр мөн org-оор
- Advisory lock-ууд бүгд `hashtext(userId)` суурьтай: түлхүүр 1 (inventory),
  2 (costing run), 3 (costing close/FA), 4 (production), 5 (period gate),
  6 (api_tokens) — бүгдийг org суурьтай болгоно
- `api_tokens` (одоо `expiresAt`-тэй), `oauth_*` — хэрэглэгчийн түвшинд
- `ai_settings` — хэрэглэгчийн түвшинд (write_mode, model)
- Partial unique index: `(user_id, external_ref)` гурван хүснэгтэд; мөн
  `payroll:YYYY-MM`, `vat-settlement:YYYY-MM`, `year-end-YYYY-*`,
  `cash-opening:<id>` externalRef idempotency бүгд user түвшинд
- `unique(userId, ...)` constraint-ууд: дансны дугаар, воучерийн дугаар,
  период код, ажилтны нэр, payroll run-ий сар г.м. — бүгд org руу шилжинэ
- Харилцагчийн давхардлын шалгалт: нэр (case-insensitive) + ТТД, user түвшинд
- `lib/audit.ts` `logAuditEvent` — userId параметртэй, 23 дуудлагын цэгтэй
- Сар хаалтын wizard (`lib/actions/month-end.ts`), банкны тулгалтын
  suggestions route — мөн userId scope-той шинэ цэгүүд

## Хийх ажил

### Шат 1 — Шинэ хүснэгтүүд

```
organizations   id, name, registryNo (ТТД, nullable), createdAt,
                planId (nullable — фаз 05-д ашиглана)
memberships     id, organizationId, userId, role, createdAt
                unique(organizationId, userId)
role enum       owner | admin | accountant | viewer
```

Эрхийн утга (энэ фазад энгийн байлга):

| Role | Эрх |
|------|-----|
| owner | Бүгд + байгууллага устгах, гишүүн урих/хасах, төлбөр |
| admin | Бүгд (байгууллага устгах, төлбөрөөс бусад) |
| accountant | Бичилт үүсгэх/засах/батлах, тайлан. Period хаах ЭРХГҮЙ, тохиргоо засах ЭРХГҮЙ |
| viewer | Зөвхөн унших |

### Шат 2 — Backfill migration

1. Бизнесийн хүснэгт бүрд `organization_id` nullable багана нэм
2. Одоо байгаа хэрэглэгч бүрд байгууллага үүсгэ (нэр = хэрэглэгчийн нэр,
   байхгүй бол email-ийн local хэсэг), тухайн хэрэглэгчийг `owner`-оор нэм
3. Бүх мөрийн `organization_id`-г `user_id` → шинэ org mapping-аар бөглө
4. `organization_id NOT NULL` болго + index нэм (одоогийн `user_id`
   index-үүдтэй ижил хэв маягаар)
5. **`user_id` баганыг УСТГАХГҮЙ** — цаашид "хэн үүсгэсэн" (createdBy) гэсэн
   аудитын утгатай үлдэнэ. Гэхдээ scoping-ийн WHERE нөхцөлд ашиглахаа болино.

⚠️ CLAUDE.md-ийн анхааруулга: `drizzle-kit push` одоо байгаа DB-тэй diff
хийдэг, урьд нь гар SQL-ээр үүссэн хүснэгтүүд бий. Migration SQL-ийг файлд
гаргаж, шаардлагатай хэсгийг нь л ажиллуул. Бүх migration нэг transaction
дотор, rollback-тэй.

### Шат 3 — Auth контекст

- Session/JWT-д `activeOrgId` нэм. Нэвтрэхэд: гишүүнчлэл нэгтэй бол шууд,
  олонтой бол сүүлд сонгосон нь (cookie `ea-org`), огт байхгүй бол
  автоматаар personal org үүсгэ (шинэ бүртгэлийн default зам)
- `lib/auth.ts`-д helper: `getActiveOrg()` → `{orgId, userId, role}`.
  **Бүх server action энэ helper-ээр org-оо авна** — client-ээс orgId-г
  parameter-ээр ХЭЗЭЭ Ч хүлээж авахгүй (IDOR хамгаалалт)
- `runAsUser` → `runAsOrg({userId, orgId}, fn)` болгож өргөтгө
  (MCP token-д org хадгалагдана, Шат 6 хар)
- Эрхийн шалгалт: `requireRole(minRole)` helper — mutation action бүрийн
  эхэнд. Матриц: viewer → унших л; accountant → бичилт, батлах;
  period close/reopen, тохиргоо, master data устгах → admin+

### Шат 4 — Query давхаргын шилжилт

- Бүх server action, report, list query-ийн `WHERE user_id = ...` →
  `WHERE organization_id = ...`
- `assertPeriodOpen(userId, date)` → `assertPeriodOpen(orgId, date)`;
  `accounting_periods` org-оор явна
- Partial unique index-үүд: `(user_id, external_ref)` →
  `(organization_id, external_ref)` (хуучныг унага, шинийг үүсгэ)
- Харилцагч/бараа/данс давхардлын шалгалт org түвшинд
- Idempotency, dedup логик (`lib/ai/tools.ts`) org түвшинд

Аргачлал: эхлээд `grep -n "userId" lib/ --include="*.ts" -r`-ээр бүрэн
жагсаалт гарга, файл бүрээр төлөвлө. "Scoping" vs "audit/createdBy"
хэрэглээг ялгаж, зөвхөн scoping-ийг соль.

### Шат 5 — UI

- Topbar-д байгууллага сонгогч (period-filter.tsx-ийн хажууд, ижил хэв маяг):
  байгууллагын нэр + dropdown. Сонгоход cookie + session шинэчлэгдэж бүх
  хуудас тухайн org-ийн дата харуулна
- Тохиргоо → Байгууллага хуудас: нэр/ТТД засах, гишүүд урих (email-ээр),
  role өөрчлөх, гишүүн хасах. Урилга: хамгийн энгийнээр — бүртгэлтэй email
  бол шууд нэм, бүртгэлгүй бол "энэ email-ээр бүртгүүлмэгц орно" pending мөр
- UI текст бүгд монголоор (байгууллага, гишүүн, эрх г.м.)

### Шат 6 — MCP / AI

- `api_tokens`, oauth token-д `organizationId` нэм. Token үүсгэхэд идэвхтэй
  org-д уягдана; `resolveApiToken` → `{userId, orgId}` буцаана
- `ai_settings` → `(userId, organizationId)` unique — горим org бүрд тусдаа
- AI chat context (system prompt-д орж буй компанийн мэдээлэл) идэвхтэй
  org-оос уншина

## Хатуу дүрэм

- **Дата алдахгүй.** Migration-ий өмнө backup, дараа нь мөрийн тоо
  таарч буйг шалгах query ажиллуул
- Client-ээс orgId parameter хүлээж авахгүй — үргэлж session-оос
- Одоогийн ганц-хэрэглэгчийн урсгал ӨӨРЧЛӨГДӨХГҮЙ мэдрэгдэнэ: шинээр
  бүртгүүлсэн хүн personal org-той төрж, org гэдэг ойлголтыг анзаарахгүйгээр
  ажиллаж чадна
- Нягтлан бодох guardrail-ууд (journal balance, period guard, draft-first)
  ХӨНДӨГДӨХГҮЙ

## Хамрахгүй (энэ фазад ХИЙХГҮЙ)

- Байгууллага хоорондын нэгтгэсэн тайлан (consolidation)
- Billing/план хязгаарлалт (фаз 05)
- Байгууллага доторх нарийн эрх (данс бүрийн түвшний эрх г.м.)
- SSO/Google нэвтрэлт

## Хүлээн авах шалгуур

- [ ] Хуучин хэрэглэгч нэвтрэхэд бүх дата нь хэвээр харагдана (personal org)
- [ ] Нэг хэрэглэгч 2 байгууллага үүсгэж, сонгогчоор шилжихэд журнал,
      тайлан, харилцагч, период — бүгд тусдаа
- [ ] Байгууллага A-ийн гишүүн B-ийн датаг ямар ч замаар (UI, server action,
      MCP, AI tool, тайлан) харж чадахгүй — үүнийг шалгах тест бичигдсэн
- [ ] viewer бичилт хийж чадахгүй, accountant период хааж чадахгүй
- [ ] MCP token нэг org-д уягдсан, тэр org-ийн л дата буцаана
- [ ] externalRef idempotency org түвшинд ажиллана (өөр org ижил ref
      ашиглаж болно)
- [ ] `npm run build` + бүх тест ногоон; migration script rollback-тэй
- [ ] README статус хүснэгт шинэчлэгдсэн
