# custom/ — Claude Code-д зориулсан дүрэм

Энэ fork дээр ажиллаж байгаа Claude Code-д: **өргөтгөл ЗӨВХӨН энэ хавтсанд.**
Root `CLAUDE.md`-ийн нягтлан бодох дүрмүүд (дансны бүлэг, ноорог-first,
периодын хамгаалалт, дансны дугаар хатуу бичихгүй) бүгд энд ч үйлчилнэ.

## Interface (эх сурвалж: `lib/custom/types.ts`)

```ts
import type { EntryCustomization } from "@/lib/custom/types";

export const myPackage: EntryCustomization = {
  name: "my-package", version: "1.0.0",
  tools: [{
    name: "get_something",            // ^[a-z][a-z0-9_]{2,63}$, core-той давхцахгүй
    description: "≥10 тэмдэгт, монголоор — модель үүгээр хэзээ дуудахаа шийднэ",
    inputSchema: { type: "object", properties: {...}, required: [...] },
    async execute(ctx, input) {       // ctx: { orgId, userId, mode }
      // ... db query ЗААВАЛ ctx.orgId-аар шүүнэ
      return { resultText: "монгол текст", action?: AiAction };
      // алдаа: throw new Error("монгол текст") → "Алдаа: ..." болж буцна
    },
  }],
  hooks: {
    beforeJournalPost: async (ctx) => ({ ok: true } | { ok: false, reason }),
    afterJournalPost:  async (ctx) => { /* webhook г.м */ },
    beforePeriodClose: async (ctx) => ({ ok: true } | { ok: false, reason }),
  },
};
```

Бүртгэл: `custom/index.ts` → `mergeCustomizations(pkgA, pkgB)`. Loader
(`lib/custom/loader.ts`) эхний хандалтад шалгаж, алдаатай бол монгол
текстээр зогсоно — тест: `npx tsx --test tests/custom-validate.test.ts`.

## Хэв маяг

- **DB унших:** `import { db } from "@/lib/db"` + `@/lib/db/schema`, Drizzle
  query; `where`-д `eq(table.organizationId, ctx.orgId)` ЗААВАЛ (multi-tenant).
- **Бичих:** core server action дуудна (`@/lib/actions/*` — `createVoucher`,
  `createCounterparty`…). Шууд `db.insert` хийхгүй — guardrail алгасагдана.
  Server action `{ error }` буцаавал `unwrapAction` (`@/lib/action-result`).
- **Гадаад дуудлага:** `fetch` + `AbortSignal.timeout(5000)`; URL/түлхүүр
  `process.env.*` (`.env.example`-д тайлбар нэм).
- **Огноо/период:** `@/lib/periods/period` (`isPeriodCode`, `periodRange`).
- **Дүн:** `number`, ₮ форматлах бол `new Intl.NumberFormat("en-US")`.
- Hook нь удаан ажиллах ёсгүй (транзакц дотор) — DB query 1–2, гадаад
  дуудлага `afterJournalPost`-д л.

## Хориотой

- `lib/`, `app/`, `components/`, `tests/` (custom тестээс бусад) засах. Core-д
  байх ёстой сайжруулалт бол upstream руу PR — энэ fork-д биш.
- Core tool-ийн нэрийг дахин тодорхойлох, hook-оор core хоригийг тойрох.
- `custom/`-д нууц, дансны дугаар, харилцагчийн нэр хатуу бичих.
- `package.json`-д dependency нэмэх — upstream sync conflict үүсгэнэ; заавал
  бол тусдаа commit, README-д тэмдэглэ.

## Шалгах

```bash
npx tsc --noEmit && npx eslint custom && npx tsx --test tests/custom-validate.test.ts
npm run dev  # /settings/system → багц харагдана; AI чатад tool дуудаж үз
```
