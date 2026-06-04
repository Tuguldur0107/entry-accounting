# Системийн review — ажлын явц (2026-05-18)

`claude/musing-rosalind-d69c47` салаа дээр хийгдсэн review-ийн дараах
хийгдсэн ажил болон үлдсэн зүйлсийн жагсаалт. Маргааш Macbook дээрээс
үргэлжлүүлэхэд хэрэгтэй.

> ⚠️ **2026-05-18 залруулга**: Эхний review-д "`proxy.ts` нь Next.js-д
> таниулагдахгүй байна" гэж буруу мэдэгдсэн. Next.js 16-аас эхлэн
> `middleware` файлын convention нь **`proxy`** болж шинэчлэгдсэн
> (https://nextjs.org/docs/messages/middleware-to-proxy). Анхны `proxy.ts`
> бүрэн ажиллаж байсан, Node.js runtime-д ажилладаг тул `bcryptjs`/`postgres-js`
> импорт асуудалгүй. AGENTS.md-д сэрэмжлүүлсэн "this is NOT the Next.js
> you know" анхааруулгыг анхаараагүйн алдаа. Тус коммитоор middleware/auth
> split-г бүгдийг буцаан сэргээв.

## ✅ Хийгдсэн (энэ PR)

### P0 — критикал

- ~~`proxy.ts → middleware.ts` нэр өөрчилсөн~~ — **БУЦААСАН**.
  Next.js 16-д `proxy.ts` нь зөв convention.
- ~~NextAuth config split хийсэн (`lib/auth.config.ts`)~~ — **БУЦААСАН**.
  Proxy нь Node.js runtime тул split хэрэггүй байсан.
- **`createVoucher`/`updateVoucher`/`deleteVoucher` транзакц болгосон**.
  Орфан voucher үүсэх эрсдэлийг арилгасан.
- **Posted journal lock** серверт хэрэгжүүлсэн.
  - `updateVoucher`: `existing.status === "posted"` бол throw — "Сторно бичилт ашиглана уу"
  - `deleteVoucher`: posted бол throw — "Сторно бичилт ашиглана уу"
  - `journal-list.tsx`: Устгах товчийг `v.status === "draft"` блок дотор зөөсөн
- **Drizzle migration**: `0001_overjoyed_sinister_six.sql` үүсгэсэн.
  Schema-аас хоцорсон 3 хүснэгт (`module_configs`, `segment_configs`,
  `segment_values`) болон 2 багана (`chart_of_accounts.is_enabled`, `.modules`)
  нэмэв. Шинэ DB-д migration зөв ажиллана.

### P1 — чухал

- **Balance threshold `0.005 → 0.01`** (CLAUDE.md §1-тэй тааруулсан).
  3 серверт + 2 UI = 5 газар.
- **`DEFAULT_ACCOUNTS` нэгтгэсэн**: `lib/constants/standard-accounts.ts`-аас
  derive хийсэн. Бүртгэлийн үед нэмэгдэх данс STANDARD_ACCOUNTS-тай 100% тааруулна.

### P2 — цэвэрлэгээ

- **Dead code устгасан**: `components/gl/journal-entry-modal.tsx` (411 мөр),
  `lib/store/gl-store.ts` (24 мөр).
- **`EAField` prop type засвар**: `autoFocus` болон `onKeyDown` prop-ыг
  `FieldProps`-д нэмж input-руу дамжуулсан. `npm run build` энэ pre-existing
  алдаагаар блоклогдож байсан — одоо typecheck цэвэр.

---

## ❌ Үлдсэн ажил (хийгдээгүй)

### P0 / P1

- [ ] **`status` багана PostgreSQL enum/check constraint болгох**
  ([lib/db/schema.ts:52](lib/db/schema.ts:52)).
  Одоо text тул `"psoted"` гэх typo хадгалагдана.
- [ ] **`registerUser` дотор `email.toLowerCase()`** хийх — case-sensitive
  unique constraint-тай зөрчилдөж байна ([lib/actions/auth.ts](lib/actions/auth.ts)).
- [ ] **`signIn("credentials", { email: ... })` → `identifier`-р** солих
  ([lib/actions/auth.ts:33](lib/actions/auth.ts:33)). Одоо бүртгэлийн дараах
  auto-login ажиллахгүй (provider нь `identifier` field хүлээдэг).

### P1 — нийцлийн зөрчил

- [ ] **CLAUDE.md дансны код шинэчлэх**:
  - 11210000 Касс → 10000001 (Кассд байгаа бэлэн мөнгө MNT)
  - 41100000 Эздийн өмч → 41000001
  - 31410000 НӨАТ өглөг → 31000003 (Татварын өр)
  Эсвэл STANDARD_ACCOUNTS-ыг CLAUDE.md-руу таарууллах. Product decision.

### P2 — кодын чанар

- [ ] **`reports-view.tsx` `useMemo` deps буруу** — `activeSegIds`,
  `resolveAccountName` deps-д ороогүй ([components/gl/reports-view.tsx:123](components/gl/reports-view.tsx:123)).
- [ ] **`parseSegParts` зөрчил** journal-list vs journal-entry-form-д адил
  биш — legacy partial code map хийх логик ялгаатай.
- [ ] **`index.html`** root-д байгаа (888 мөр) — Next.js app-д шаардлагагүй.
- [ ] **`scripts/check-segments.ts` болон `check-segs.ts`** хоёулаа ижил
  нэртэй — нэгийг устгах.
- [ ] **`getSegmentKey` unused import** [lib/actions/gl.ts:19](lib/actions/gl.ts:19) —
  `eslint --fix` ажиллуулна.
- [ ] **`zustand` package хасах** — `gl-store.ts` устгасан тул хэрэглэгдэхгүй.
- [ ] **`useFormStatus` / `useTransition`** ашиглаж UI loading state-ийг
  Next-ийн loading mechanic-аар оруулах.
- [ ] **Pagination** 100+ хуудас үед бүх товч render — virtualize эсвэл
  ellipsis (`1 ... 5 6 [7] 8 9 ... 100`) болгох.
- [ ] **Password policy** — нийтлэг сул нууц үгийн blacklist нэмэх,
  цахим хүчтэй байх зөвлөмж.
- [ ] **`AUTH_SECRET` strength** — `.env.local`-д хүчтэй secret
  байгаа эсэхийг production-д шалгах.
- [ ] **`AGENTS.md` Next.js 16 breaking changes audit** хийх — `node_modules/next/dist/docs/`
  унших.

### Plan (CLAUDE.md ёсоор хараахан хийгээгүй модулиуд)

- [x] **Cash модуль V1** (2026-06-04) — доорх "Cash модуль" хэсгийг үз
- [ ] **Period систем** (open/closed status, period close workflow)
- [ ] **Reversing entry UI** (posted journal-г сторно бичилтээр амлахл)
- [ ] **`adjustment_type` багана** (regular/prior_period/closing/reversing/fx_reval/accrual)
- [ ] **`audit_log` хүснэгт** + хэн юу хийсэн tracking
- [ ] **НӨАТ модуль** (10% борлуулалт/худалдан авалт, тооцоо, GL posting)
- [ ] **Payroll модуль** (Gross→Net, НДШ, ХАОАТ, GL posting 7 мөр)
- [ ] **AI agent** (expert accountant — draft-first guardrail)
- [ ] **Effective-date lookup** (татварын хувь огноогоор)
- [ ] **Large-amount approval** (>10M₮ нягтланч баталгаажуулах)

---

## 🔢 Сегментийн системийн засвар (2026-06-04)

Дүрэм: [`knowledge/03-стандарт/segment-coding-rules.md`](knowledge/03-стандарт/segment-coding-rules.md) ·
Реализаци: [`lib/segments.ts`](lib/segments.ts) · CLAUDE.md "⛔ Сегментийн код" дүрэм нэмэв.

### ✅ Засагдсан (3 invariant)
1. **Zero-fill** — унтарсан/хоосон сегмент DB-д орон тоогоор нь **ТЭГ** бичигдэнэ
   (өмнө нь `""` хоосон байсан). `000.000000.51100000.00.0000.000.0000.0000.GL.0`.
   S9 (модуль) онцгол — `GL`.
2. **Default-ON consistency** — `computeActiveSegIds()` нэг эх сурвалж: тохиргоо
   байхгүй → идэвхтэй. Өмнө config-tab (`?? true`) ба журнал хуудас (`=== true`)
   зөрж байсныг арилгав. S3 үргэлж идэвхтэй.
3. **Тайлан нийлбэр** — тайлан сегмент ашиглаагүй бол **S3-аар group хийж
   нийлбэрлэнэ** (`extractMainAccount`). Өмнө бүтэн composite-аар задалж нэг
   данс олон мөр болдог байсан.

- Бүх логик `lib/segments.ts`-д төвлөрсөн (form/list/reports/4 page хуваалцана).
  Хуваагдсан `SEG_DEFAULTS`/гар `split(".")`-ийг устгав.
- gl.ts `isValidLine`: дүнтэй мөрийн **S3 тэг (00000000) байхыг хориглов**.
- **Live test 13/13**: zero-fill, parse round-trip, display нуулт, S3 нийлбэр
  (3×S1→1 мөр), plain cash extract, default-ON, S3 lock. tsc/eslint цэвэр,
  бүх 6 route HTTP 200.

### ❌ Сегмент follow-up
- [ ] Тайланд сегмент сонгож "зүсэх" UI (S2/S5/S8-аар breakdown) — §7.8 бусад зүсэлт
- [ ] Cash модулийн GL posting-ийг composite код руу шилжүүлэх (одоо plain 8-оронт)
- [ ] Хуучин өгөгдөл байгаа бол migration (одоо production өгөгдөлгүй тул шаардлагагүй)

---

## 🏦 Cash модуль V1 (2026-06-04)

Spec: [`knowledge/.../workflows/cash-management.md`](knowledge/02-нягтлан-бодох-мэргэжлийн/workflows/cash-management.md)

### ✅ Хийгдсэн
- **Schema**: `bank_accounts`, `bank_transactions` + **CHECK constraint**
  (`direction`, `cf_category`, `status`, `recon_status`, `amount>=0`) —
  GL `status` чөлөөт-text gap-ийг энд давтаагүй. Migration `0002_crazy_thanos.sql`.
- **Server actions** [`lib/actions/cash.ts`](lib/actions/cash.ts): банкны данс CRUD;
  гүйлгээ create/update/post/delete — бүгд `db.transaction` дотор, **posted-lock**
  (бичигдсэнийг засах/устгахыг хорьж сторно шаардана), post үед **GL журнал
  автомат үүсгэнэ** (inflow: Dr банк/Cr эсрэг; outflow: Dr эсрэг/Cr банк).
- **UI** [`app/(dashboard)/cash/*`](app/(dashboard)/cash) + [`components/cash/*`](components/cash):
  Гүйлгээ (жагсаалт + add/edit dialog + summary), Дансууд, Тайлан (Үлдэгдэл +
  Direct cash flow by IAS 7 ангилал). Topbar nav-д "Мөнгөн гүйлгээ" нэмэв.
- **Live test (8/8)**: CHECK reject (bad direction/cf_category/negative),
  posting balance D=C, voucher холбоос, үлдэгдэл тооцоо, cascade delete. Routes 200.

### ❌ Cash follow-up (дараагийн фаз)
- [ ] **Reconciliation** — bank statement vs систем тулгалт (`/cash/reconciliation`)
- [ ] **Statement import** — CSV/Excel auto-match
- [ ] **AR/AP холболт** — `source='ar'|'ap'` автомат гүйлгээ (E2/E4)
- [ ] **Multi-currency FX reval** — IAS 21 period-close
- [ ] **Indirect cash flow** тайлан (цэвэр ашгаас reconciliation)
- [ ] **Reversing entry UI** — posted гүйлгээг сторнодох (GL-тэй хамт)

---

## 🛠 Маргааш үргэлжлүүлэхэд хэрэгтэй

```bash
git checkout claude/musing-rosalind-d69c47
git pull
npm install        # node_modules дахин бүтээнэ (mac бол)
# Migration шинэ DB дээр ажиллуулах бол:
npx drizzle-kit migrate
# эсвэл (dev only):
npx drizzle-kit push

npx tsc --noEmit   # цэвэр (0 алдаа)
npm run build      # production build шалгах
npm run dev
```

### Дараах P0/P1-аас эхлэх зөвлөмж

1. **Register-ийн `signIn` field bug** (1 мөр) — хамгийн жижиг, хамгийн их UX impact.
2. **`email.toLowerCase()` register-т** (1 мөр) — duplicate user prevention.
3. **`status` enum** (schema + migration) — data integrity.
4. **CLAUDE.md дансны код шинэчлэх** — doc consistency.
