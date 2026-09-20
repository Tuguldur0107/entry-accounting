// Схемээс ХАСАГДСАН хүснэгт / багана — `drizzle-kit push`-ийн ИНТЕРАКТИВ
// асуултыг үүсгэдэг цорын ганц эх сурвалж (ЦЭВЭР дата, DB хөндөхгүй).
//
// ШАЛТГААН: push-ийн diff-д УСТГАГДАХ ба ҮҮСЭХ объект ЗЭРЭГ байвал drizzle-kit
// «энэ нь нэр солигдсон уу, эсвэл тус тусдаа үүсээд устсан уу?» гэж асуудаг
// (`tablesResolver` → `promptNamedWithSchemasConflict`, `columnsResolver` →
// `promptColumnsConflicts`). `--force` энэ асуултыг ХАМРАХГҮЙ — тэр нь зөвхөн
// өгөгдөл алдах STATEMENT-ийг зөвшөөрдөг. Улмаар Railway-ийн non-TTY
// preDeploy дээр
//   "Error: Interactive prompts require a TTY terminal"
// гэж унаж, схемийн БҮХ өөрчлөлт DB-д ОРОХГҮЙ үлддэг.
//
// 2026-09-19: v1.5.0 нь 8 хүснэгт хасаж 15 шинийг нэмсэн тул v1.4.0-ийн DB-тэй
// харилцагчийн deploy яг ингэж унасан (эхлээд хүснэгтийн, зассаны дараа
// баганын асуулт дээр).
//
// ⚠️ ДҮРЭМ: схемээс хүснэгт эсвэл багана ХАСАХ бүрд ЭНД бүртгэнэ — эс бөгөөс
// тэр хувилбарт шинэ объект нэмэгдсэн харилцагч бүрийн deploy унана.
// `tests/removed-schema-objects.test.ts` нь энд бичигдсэн нэр схемд ДАХИН
// амилаагүй эсэхийг шалгана (амьд хүснэгтийг санамсаргүй архивлахаас сэргийлнэ).

/**
 * Хасагдсан хүснэгтүүд. preDeploy эдгээрийг `archive` схем рүү ЗӨӨНӨ —
 * push-ийн харах талбарт (public) устгагдах хүснэгт үлдэхгүй тул асуулт
 * гарахгүй, өгөгдөл нь ХЭВЭЭР хадгалагдана (drop ХИЙХГҮЙ).
 */
export const REMOVED_TABLES = [
  // v1.5.0 — үйлдвэрлэлийн өртгийн модуль хасагдсан (CLAUDE.md §5a:
  // «Өртөг/Хангамж: үйлдвэрлэлийн өртөг хасагдаж…»)
  "production_run_inputs",
  "production_run_outputs",
  "production_run_pools",
  "production_run_stages",
  "production_runs",
  "production_stages",
  "cost_pool_rules",
  "cost_pools",
];

/**
 * Хасагдсан баганууд. push эдгээрийг ЯМАР Ч БАЙСАН устгах тул preDeploy нь
 * зөвхөн УРЬДЧИЛЖ — дээрээс нь утгыг шинэ талбар руу ХӨРВҮҮЛСНИЙ дараа —
 * устгана (push бол хөрвүүлэхгүй шууд устгах байсан).
 *
 * `migrate` нь баганыг хасахаас ӨМНӨ дарааллаар ажиллах SQL-үүд. push
 * хараахан ажиллаагүй тул шинэ баганыг ӨӨРӨӨ нэмэх шаардлагатай байж болно
 * (схемтэй ЯГ ижил тодорхойлолтоор — эс бөгөөс push-д diff үлдэнэ).
 */
export const REMOVED_COLUMNS = [
  {
    // v1.5.0 — ҮОМШӨ тусад нь задрахаа больж, ажилтан бүрд АО-НДШ нэгдсэн %
    // болсон (CLAUDE.md §7). Хуучин ҮОМШӨ = АО-НДШ − суурь 11.7; жишиг:
    // оффис 0.8 → 12.5 · барилга 1.5 → 13.2 · уул уурхай 3.0 → 14.7.
    table: "employees",
    column: "accident_rate_percent",
    migrate: [
      `alter table public.employees add column if not exists
         employer_si_percent numeric(5, 2) not null default '12.5'`,
      // Зөвхөн хөндөгдөөгүй (default) мөрийг хөрвүүлнэ — хэрэглэгчийн
      // гараар тогтоосон хувийг дарж бичихгүй.
      `update public.employees
          set employer_si_percent = 11.7 + accident_rate_percent
        where accident_rate_percent is not null
          and employer_si_percent = 12.5`,
    ],
  },
];
