# custom/ — Таны өргөтгөлийн хавтас

Энэ хавтас **таных**. Core (upstream) энд хэзээ ч бичихгүй, та core файлд гар
хүрэхгүй — тэгвэл `Upstream sync` PR conflict-гүй merge болно.

## Бүтэц

```
custom/
├── index.ts            ← ЦОРЫН ГАНЦ entrypoint: багцуудаа энд бүртгэнэ
├── theme.css           ← --ea-* токен override (брэндийн өнгө)
├── packages/
│   └── demo/index.ts   ← жишээ багц: tool + 2 hook + webhook (идэвхгүй)
├── README.md           ← энэ файл
└── CLAUDE.md           ← Claude Code-д зориулсан дэлгэрэнгүй дүрэм
```

## 3 алхамд өргөтгөл нэмэх

1. `custom/packages/demo`-г хуулж `custom/packages/<миний-нэр>/` болго
2. `index.ts`-д tool / hook-оо бич (`demo`-г дуурай)
3. `custom/index.ts`-д бүртгэ:

```ts
import { myPackage } from "./packages/my-package";
export const customization = mergeCustomizations(myPackage);
```

`npm run dev` → tool нь AI чат, MCP (`tools/list`), REST (`GET /api/v1/tools`)
гурвуулд харагдана; `/settings/system` хуудсанд багцын нэр, tool/hook тоо гарна.

## Юу хийж болох вэ

| Өргөтгөл | Талбар | Хэрэглээ |
|----------|--------|----------|
| AI/MCP/REST tool | `tools[]` | Салбарын тайлан, тусгай шалгалт, гадаад системд өгөгдөл бэлдэх |
| `beforeJournalPost` | `hooks` | Нэмэлт хориг: "тайлбаргүй/төсөл кодгүй журнал батлагдахгүй" |
| `afterJournalPost` | `hooks` | Webhook, sync, мэдэгдэл (алдаа бичилтийг унагахгүй) |
| `beforePeriodClose` | `hooks` | "Банкны тулгалт дуусаагүй бол сар хаахгүй" |
| Өнгө | `theme.css` | `:root { --ea-primary: #0f766e }` |

## Хийж БОЛОХГҮЙ

- Core guardrail-ийг сулруулах (баланс, период, эрх, 10 сая ₮ хязгаар) — hook
  зөвхөн НЭМЭЛТ хориг тавьж чадна
- `lib/`, `app/`, `components/` дотор өөрчлөлт — хэрэгтэй бол core руу PR
- Нууц, URL, дансны дугаар кодонд хатуу бичих — `process.env` / тохиргооны хүснэгт
- Client-ээс DB руу шууд хандах — tool нь server талд ажилладаг

## Claude Code-той ажиллах

Fork дээр `claude` нээгээд: *"custom/ дотор барилгын объектоор зардлын тайлан
гаргадаг tool нэм"* — Claude Code `custom/CLAUDE.md`-г уншиж core-д гар
хүрэлгүй хийнэ. Upstream шинэчлэлт: *"Actions → Upstream sync PR-ыг merge
хийхэд conflict гарвал custom/ дахь дүрмүүдийг хадгалж шийд"*.
