# Системийн review — ажлын явц (2026-05-18)

`claude/musing-rosalind-d69c47` салаа дээр хийгдсэн review-ийн дараах
хийгдсэн ажил болон үлдсэн зүйлсийн жагсаалт. Маргааш Macbook дээрээс
үргэлжлүүлэхэд хэрэгтэй.

## ✅ Хийгдсэн (энэ PR)

### P0 — критикал

- **`proxy.ts → middleware.ts` нэр өөрчилсөн**. Файл нь Next.js-д таниулагдахгүй
  байсан тул `(standalone)` routes (журнал шинээр бичих/засах хуудсууд) auth
  guard-гүй байсан. Одоо middleware бүх routes дээр ажиллана.
- **NextAuth config split хийсэн** — Edge runtime-д `bcryptjs` болон `postgres-js`
  орохгүй болсон.
    - **NEW** `lib/auth.config.ts` — providers байхгүй, JWT callbacks, pages
    - `lib/auth.ts` — `...authConfig` spread + Credentials provider
    - `middleware.ts` — `NextAuth(authConfig)` instance, no DB/bcrypt
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

## 🛠 Маргааш үргэлжлүүлэхэд хэрэгтэй

```bash
git checkout claude/musing-rosalind-d69c47
git pull
npm install        # node_modules дахин бүтээнэ (mac бол)
# Migration шинэ DB дээр ажиллуулах бол:
npx drizzle-kit migrate
# эсвэл (dev only):
npx drizzle-kit push

npx tsc --noEmit   # 9 алдаа гарна — бүгд EAField prop type (pre-existing)
npm run dev
```

### Дараах P0/P1-аас эхлэх зөвлөмж

1. **Register-ийн `signIn` field bug** (1 мөр) — хамгийн жижиг, хамгийн их UX impact.
2. **`email.toLowerCase()` register-т** (1 мөр) — duplicate user prevention.
3. **`status` enum** (schema + migration) — data integrity.
4. **CLAUDE.md дансны код шинэчлэх** — doc consistency.
