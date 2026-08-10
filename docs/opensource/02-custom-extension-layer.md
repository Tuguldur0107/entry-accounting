# Фаз 02 — `custom/` өргөтгөлийн давхарга

## Зорилго

Fork хийсэн хэрэглэгч core файлд гар хүрэхгүйгээр системээ өргөтгөх боломж.
Хоёр хатуу гэрээ:

1. Хэрэглэгч зөвхөн `custom/` дотор ажиллана
2. Upstream (бид) `custom/` дотор хэзээ ч бичихгүй

Энэ биелвэл: fork хийсэн хүн `git pull`-аар шинэчлэлт авахад conflict
гарахгүй · сургалт заах боломжтой · marketplace-ийн «бараа» = `custom/` багц.

## Одоогийн байдал

*Шинэчилсэн: 2026-08-08*

Дата-driven суурь аль хэдийн байгаа: `costing_account_settings` (одоо FX
олз/гарзын данс ч энд), `costing_item_settings`, `report_line_mappings`,
`segment_configs`, `inventory_issue_types`, `cost_components`, мөн ШИНЭ:
`vat_settings` (НӨАТ данс + хувь), `payroll_settings` (цалингийн 6 данс,
доод цалин, cap, татваргүй босго) — данс, тайлан кодод hardcode хийхийг
CLAUDE.md хориглосон. Гэхдээ нэгдсэн «өргөтгөлийн цэг» байхгүй:
AI tool нэмэх = `lib/ai/tools.ts` засах (одоо 72 tool), column type нэмэх =
`lib/grid/columnTypes.ts` засах гэх мэт — бүгд core файл. Hook-ийн
байгалийн цэгүүд одоо тодорхой: `lib/actions/gl.ts` postVoucher (server
validator + in-tx period guard-ийн ДАРАА), `lib/actions/periods.ts`
closePeriod (ноорог тооллогын ДАРАА).

## Хийх ажил

### Шат 1 — Registry болон бүтэц

Next.js-д дурын хавтас runtime-д dynamic import хийх найдваргүй тул
**build-time registry** хэв маяг ашиглана: `custom/index.ts` гэдэг нэг
entrypoint бүх өргөтгөлөө export хийнэ, core нь зөвхөн энэ файлыг import
хийнэ.

```
custom/
├── index.ts                 ← ЦОРЫН ГАНЦ entrypoint (default: хоосон)
├── README.md                ← хэрэглэгчид зориулсан заавар (монголоор)
└── packages/                ← суулгасан багцууд
    └── <package-name>/
        ├── entry-package.json
        ├── accounts.json            (COA нэмэлт)
        ├── posting-rules.json
        ├── report-mappings.json
        ├── tools/*.ts               (AI/MCP tool)
        ├── columns/*.ts             (grid column type)
        ├── hooks/*.ts
        ├── skills/                  (.claude/skills формат)
        └── theme.css
```

Type тодорхойлолт (`lib/custom/types.ts`):

```ts
export interface EntryCustomization {
  tools?: CustomTool[]           // lib/ai/tools.ts-ийн schema-тай ижил бүтэц
  columnTypes?: Record<string, Partial<ColDef>>
  hooks?: {
    beforeJournalPost?: (ctx: JournalHookCtx) => Promise<HookResult>
    afterJournalPost?: (ctx: JournalHookCtx) => Promise<void>
    beforePeriodClose?: (ctx: PeriodHookCtx) => Promise<HookResult>
  }
  seedFiles?: string[]           // accounts/posting-rules/report-mappings JSON замууд
  themeCss?: boolean             // custom/theme.css-ийг globals-ийн дараа import
}
```

`custom/index.ts` (upstream-ийн ачилдаг default):

```ts
import type { EntryCustomization } from "@/lib/custom/types"
export const customization: EntryCustomization = {}
```

### Шат 2 — Core-ийн залгах цэгүүд

- `lib/custom/loader.ts` — `customization`-ийг уншиж баталгаажуулна
  (давхардсан tool нэр, буруу schema → build үед алдаа)
- `lib/ai/tools.ts` — tool жагсаалтаа core tools + `customization.tools`
  нийлбэрээс бүрдүүлнэ (чат ба MCP хоёуланд автоматаар очно — одоогийн
  «нэг давхарга» зарчим хэвээр)
- `lib/grid/columnTypes.ts` — registry-гээ core + custom нийлбэрээс
- Hook цэгүүд: `lib/actions/gl.ts`-ийн post үйлдэлд `beforeJournalPost`
  (HookResult: `{ok: true}` | `{ok: false, reason: string}` — false бол
  post зогсоно, шалтгаан UI-д монголоор харагдана), `afterJournalPost`;
  `lib/actions/periods.ts`-д `beforePeriodClose`
- `npm run custom:seed` script — `seedFiles`-ийн JSON-уудыг идэвхтэй org-д
  идемпотентээр суулгана (байгаа данс алгасна, шинийг нэмнэ; `--dry-run`
  горимтой)
- `custom/theme.css` byte байвал globals.css-ийн ДАРАА import — `--ea-*`
  токен override хийх зам (ui-kit/tokens.css зарчимтай нийцнэ)

### Шат 3 — `entry-package.json` манифест

```json
{
  "name": "demo-barilga",
  "version": "1.0.0",
  "title": "Барилгын салбарын жишээ багц",
  "author": "Entry",
  "entryCompat": ">=1.0.0",
  "license": "MIT",
  "provides": ["accounts", "posting-rules", "tools"]
}
```

- JSON schema бич (`lib/custom/package-schema.ts`), loader баталгаажуулна
- `entryCompat` — core-ийн package.json version-тай semver харьцуулалт,
  таарахгүй бол build үед ойлгомжтой алдаа (монголоор)

### Шат 4 — Жишээ багц + баримтжуулалт

- `custom/packages/demo-barilga/` — жижиг боловч БҮХ төрлийн өргөтгөл
  агуулсан жишээ: 5–10 данс, 1 posting rule, 1 энгийн AI tool
  (жишээ нь «барилгын объектоор зардлын тайлан»), 1 hook (тайлбаргүй
  журналыг post хийхээс сэргийлэх), theme.css-д нэг өнгө override
- `custom/README.md` — хэрэглэгчийн заавар: бүтэц, index.ts-д хэрхэн
  бүртгэх, seed ажиллуулах, upstream-ээс `git pull` хийх заавар
- Root CLAUDE.md-д «Өргөтгөл хийхдээ зөвхөн custom/, core-д гар бүү хүр»
  хэсэг нэм — fork хийсэн хүний Claude Code энэ дүрмийг уншина.
  `custom/CLAUDE.md` тусдаа үүсгэ: тэнд өргөтгөл бичих дэлгэрэнгүй дүрэм
  (fork хийгчийн Claude Code-ийн гол гарын авлага)

## Хатуу дүрэм

- Core-ийн ямар ч файл `custom/`-ийн тодорхой багцын нэр/зам hardcode
  хийхгүй — зөвхөн `custom/index.ts` interface-ээр
- Хоосон `custom/` (default байдал)-тай build, тест 100% ажиллана
- Hook нь нягтлан бодох guardrail-ийг СУЛРУУЛЖ чадахгүй: journal balance,
  period guard, draft-first шалгалтууд hook-ээс ӨМНӨ ажиллана; hook зөвхөн
  НЭМЭЛТ хориг тавьж чадна, байгаа хоригийг тойрч чадахгүй
- Custom tool-ууд мөн л server action давхаргаар дуудна — client-ээс DB
  шууд хандахгүй зарчим хэвээр

## Хамрахгүй

- Багц татаж суулгах CLI (`npx entry add`) — фаз 06
- Төлбөр, лиценз шалгалт — фаз 06+
- Hot reload / runtime plugin — build-time л хангалттай
- ~~VAT/Payroll модулийн posting template~~ — *2026-08-08: хоёулаа
  хэрэгжсэн; данс нь `vat_settings`/`payroll_settings` тохиргооноос уншдаг
  тул зарчимд нийцсэн. GL posting мөрийн бүтэц нь одоогоор код дотор
  (`lib/vat/return.ts` settlement, `lib/payroll/calc.ts`
  `buildPayrollJournalLines`) — эдгээрийг posting-rules ДАТА руу гаргах нь
  энэ фазын биш, сонголтоор дараагийн шатны ажил*

## Хүлээн авах шалгуур

- [ ] Хоосон custom/-тай build + бүх тест ногоон
- [ ] demo-barilga-г index.ts-д бүртгэхэд: данснууд seed-ээр орж ирнэ,
      custom tool чат БА MCP хоёуланд харагдана, hook нь тайлбаргүй
      журналын post-ыг монгол алдаатай зогсооно, theme өнгө өөрчлөгдөнө
- [ ] Бүртгэлээ буцааж авахад (index.ts хоосон болгох) систем эвдрэлгүй
      ажиллана
- [ ] entryCompat зөрүүтэй багц ойлгомжтой монгол алдаа өгнө
- [ ] Loader-ийн validation тесттэй (давхардсан tool нэр г.м.)
- [ ] custom/README.md, custom/CLAUDE.md бичигдсэн
- [ ] README статус хүснэгт шинэчлэгдсэн
