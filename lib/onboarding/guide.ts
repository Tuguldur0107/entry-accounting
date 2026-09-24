// Анхны нэвтрүүлэлтийн туслах — ЦЭВЭР хэсэг (DB/fs хамааралгүй, тесттэй).
//
// Эх сурвалж: docs/deployment/onboarding.md (product owner баталсан, v1.0).
// Tool нь тэр файлын §2 (материал), §3 (зөрүүний дүрэм), §4 (шатууд)-ыг
// толгойгоор нь ЗАДЛАН ҮГЧЛЭН өгдөг — текстийг энд давхар бичихгүй, баримт
// өөрчлөгдөхөд tool автоматаар дагана. Энд зөвхөн:
//   • markdown-аас хэсэг ялгах (`extractSection`)
//   • байгууллагын төлвөөс нэвтрүүлэлтийн ШАТ + дараагийн алхам гаргах
//     (`deriveOnboardingPhase`)
//   • товч танилцуулга + AI-ийн хязгаар (§5-тай ИЖИЛ утга, богино хэлбэр)

/** Нээлтийн зөрүүний дансны СТАНДАРТ дугаар/нэр (OD-ONB-1). Байгууллага
 *  дугаарыг өөрчилж болно — төлөв шалгагч НЭРЭЭР нь олдог тул кодод хатуу биш. */
export const OPENING_DIFFERENCE_ACCOUNT = {
  number: "44000098",
  name: "Нээлтийн үлдэгдлийн зөрүү",
} as const;

/** Хураангуй харилцагчийн нэрс (OD-ONB-2). */
export const OPENING_SUMMARY_COUNTERPARTY = {
  ar: "Нээлтийн үлдэгдэл — задаргаагүй (АР)",
  ap: "Нээлтийн үлдэгдэл — задаргаагүй (АП)",
} as const;

/** externalRef угтварууд (R9). */
export const OPENING_REF = {
  balance: "opening-balance:",
  summary: "opening-summary:",
  diff: "opening-diff:",
  adjustment: "opening-adj:",
} as const;

export type OnboardingSection =
  | "overview"
  | "checklist"
  | "rules"
  | "phases"
  | "status";

export const ONBOARDING_SECTIONS: OnboardingSection[] = [
  "overview",
  "checklist",
  "rules",
  "phases",
  "status",
];

/**
 * Markdown-аас `## <n>.` толгойтой хэсгийг (дараагийн `## ` хүртэл) буцаана.
 * Толгой олдохгүй бол null — дуудагч fallback текст өгнө.
 */
export function extractSection(markdown: string, sectionNumber: number): string | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^## ${sectionNumber}\\.\\s`).test(line)
  );
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) {
      end = index;
      break;
    }
  }
  // Хэсгийн төгсгөлийн "---" хуваагчийг хаяна.
  const body = lines.slice(start, end).join("\n").replace(/\n-{3,}\s*$/, "");
  return body.trim();
}

/** Байгууллагын нэвтрүүлэлттэй холбоотой төлөв — status.ts DB-ээс бөглөнө. */
export interface OnboardingStatus {
  organizationName: string;
  counts: {
    enabledAccounts: number;
    counterparties: number;
    inventoryItems: number;
    warehouses: number;
    cashAccounts: number;
    employees: number;
    fixedAssets: number;
    postedVouchers: number;
  };
  /** `opening-balance:*` журнал — байхгүй бол null. */
  openingVoucher: { date: string; status: string; documentNo: string | null } | null;
  /** `opening-summary:*` АР/АП баримтын тоо (хураангуй бүртгэл, R2). */
  openingSummaryDocs: number;
  /** `opening-diff:*` НООРОГ журналын тоо (R6, шийдэгдээгүй зөрүү). */
  openingDiffDrafts: number;
  /** `opening-adj:*` журналын тоо (R7). */
  openingAdjustments: number;
  /** Нээлтийн зөрүүний данс (нэрээр эсвэл дугаараар олдсон) — байхгүй бол null. */
  differenceAccount: { number: string; name: string } | null;
  /**
   * Зөрүүний дансны БАТЛАГДСАН GL үлдэгдэл (ENT-019: ноорог 0 байхад данс
   * 41 сая ₮ үлдэгдэлтэй атлаа «шат 4, хаахад бэлэн» гэж харагдаж байв).
   */
  differenceBalance?: number;
  /** Нээлтийн журналын сар хаагдсан эсэх (cut-off сар). */
  cutoffPeriodClosed: boolean;
  /** Хамгийн сүүлд хаагдсан сар (YYYY-MM) — байхгүй бол null. */
  latestClosedPeriod: string | null;
}

export interface OnboardingPhase {
  /** 0 судалгаа · 1 master data · 2 нээлт · 3 тулгалт · 4 зэрэгцээ сар · 5 хүлээлгэн өгсөн */
  phase: 0 | 1 | 2 | 3 | 4 | 5;
  title: string;
  /** Яагаад энэ шатанд гэж үзсэн бэ. */
  reason: string;
  /** Дараагийн алхмууд — tool нэртэй, дарааллаар. */
  nextSteps: string[];
}

/**
 * Төлвөөс шатыг гаргана (docs §4-ийн "дууссан" шалгуур):
 *   0 → master data огт байхгүй (касс, харилцагч аль нь ч үгүй)
 *   1 → master data эхэлсэн, нээлтийн журнал байхгүй
 *   2 → нээлтийн журнал НООРОГ
 *   3 → нээлт батлагдсан, зөрүүний ноорог үлдсэн (тулгалт дуусаагүй)
 *   4 → нээлт батлагдсан, зөрүү 0, cut-off сар нээлттэй (зэрэгцээ сар)
 *   5 → cut-off сар хаагдсан
 */
export function deriveOnboardingPhase(status: OnboardingStatus): OnboardingPhase {
  const { counts } = status;
  const masterDataStarted =
    counts.cashAccounts > 0 || counts.counterparties > 0 || counts.inventoryItems > 0;

  if (!status.openingVoucher && !masterDataStarted)
    return {
      phase: 0,
      title: "Судалгаа — материал цуглуулах",
      reason: "Касс/банкны данс, харилцагч, бараа аль нь ч бүртгэгдээгүй",
      nextSteps: [
        "Хэрэглэгчийн хавтсыг уншиж get_onboarding_guide section=checklist-ийн 13 материалыг 'байгаа / дутуу / орлуулах арга (R1–R5)' хүснэгтээр тайлагна — ЮУ Ч БИЧИХГҮЙ",
        "Cut-off огноог (нэвтрүүлэлтийн өмнөх өдөр) хэрэглэгчээр батлуул",
        "Дансны mapping: list_gl_accounts → хуучин данс бүрийг стандарт дансанд харгалзуулж батлуул (R1)",
        "Батлагдсан gap тайлангийн дараа 1-р шат: master-data-import дараалал (данс → харилцагч → бараа/агуулах → касс → ажилтан → ҮХ)",
      ],
    };

  if (!status.openingVoucher)
    return {
      phase: 1,
      title: "Master data",
      reason: `Бүртгэл эхэлсэн (касс ${counts.cashAccounts}, харилцагч ${counts.counterparties}, бараа ${counts.inventoryItems}), нээлтийн журнал байхгүй`,
      nextSteps: [
        "Дутуу master data-г batch tool-оор (100 мөр/дуудлага): create_counterparties_batch, create_inventory_items_batch, create_warehouse, create_cash_account, create_employees_batch, create_fixed_assets_batch",
        `Нээлтийн зөрүүний данс: ${status.differenceAccount ? `${status.differenceAccount.number} байна` : `${OPENING_DIFFERENCE_ACCOUNT.number} "${OPENING_DIFFERENCE_ACCOUNT.name}" — стандарт данс sync (/settings/gl) эсвэл create_gl_account`}`,
        "2-р шат: АР/АП, бараа, ҮХ-ийг дэд дэвтрээр (задаргаагүй бол хураангуй R2/R3/R5), дараа нь create_journal_voucher НЭГ ноорог externalRef opening-balance:<cut-off> — дэд дэвтэрт орсон дансыг ДАВХАРДУУЛАХГҮЙ (R8)",
      ],
    };

  if (status.openingVoucher.status === "draft")
    return {
      phase: 2,
      title: "Нээлтийн үлдэгдэл — ноорог",
      reason: `Нээлтийн журнал ${status.openingVoucher.documentNo ?? ""} (${status.openingVoucher.date}) ноорог`,
      nextSteps: [
        `get_trial_balance (${status.openingVoucher.date}) — ΣДт = ΣКт эсэх; хуучин системийн балансын мөр бүртэй тулга`,
        "reconcile_modules (to = cut-off) — касс/АР/АП/бараа дэд дэвтэр GL-тэй тэнцэх эсэх",
        `Зөрүү бол R6: create_journal_voucher externalRef ${OPENING_REF.diff}<огноо>:<n>, тайлбар [ОНБ-ЗӨРҮҮ] …, зөрүүний данс${status.differenceAccount ? ` ${status.differenceAccount.number}` : ` ${OPENING_DIFFERENCE_ACCOUNT.number}`} — НООРОГ`,
        "Тулгалт 0 болсны дараа нягтлан вэб дээрээс нээлтийн журналыг батална (AI post_journal_voucher-ыг ДУУДАХГҮЙ — R9)",
      ],
    };

  const differenceBalance = Math.round((status.differenceBalance ?? 0) * 100) / 100;
  if (status.openingDiffDrafts > 0 || Math.abs(differenceBalance) > 0.005)
    return {
      phase: 3,
      title: "Тулгалт — зөрүү шийдэгдээгүй",
      reason:
        status.openingDiffDrafts > 0
          ? `Нээлт батлагдсан, ${status.openingDiffDrafts} зөрүүний ноорог (${OPENING_REF.diff}*) үлдсэн`
          : `Нээлт батлагдсан, зөрүүний данс ${status.differenceAccount?.number ?? OPENING_DIFFERENCE_ACCOUNT.number} үлдэгдэлтэй (${differenceBalance.toLocaleString("en-US")}₮) — 0 болтол тулгалт дуусаагүй`,
      nextSteps: [
        `list_journal_vouchers status=draft — ${OPENING_REF.diff}* журнал бүрийн шалтгааныг хэрэглэгчтэй тодруул`,
        `Шалтгаан олдсон бол R7: create_journal_voucher externalRef ${OPENING_REF.adjustment}<огноо>:<n> — зөрүүний дансыг эх дансаар нь хаана (ноорог, нягтлан батална)`,
        "Зөрүүний ноорог 0 болтол cut-off сарыг хаахгүй (OD-ONB-4)",
      ],
    };

  if (!status.cutoffPeriodClosed)
    return {
      phase: 4,
      title: "Зэрэгцээ сар — эхний сарын ажиллагаа",
      reason: `Нээлт батлагдсан, зөрүүний ноорог 0; cut-off сар нээлттэй${status.openingSummaryDocs > 0 ? `; ${status.openingSummaryDocs} хураангуй бүртгэл (R2) хэвээр` : ""}`,
      nextSteps: [
        "Эхний сарын гүйлгээг Entry-д бичиж (get_workflow_guide-ийн урсгалуудаар), сарын эцэст хуучин системтэй тулга",
        "get_month_end_checklist → run_fa_depreciation / run_monthly_costing / reconcile_modules",
        ...(status.openingSummaryDocs > 0
          ? [
              `Хураангуй бүртгэлийн задаргаа ирвэл R2: хураангуйг буцааж дэлгэрэнгүйгээр соль (Σ = хураангуй дүн) — ${OPENING_REF.summary}* баримтуудыг list_arap_documents-оор ол`,
            ]
          : []),
        "Бүгд тэнцсэн бол close_period {cut-off сар} (Шууд бичих горим, хэрэглэгч ил хүссэн үед)",
      ],
    };

  return {
    phase: 5,
    title: "Хүлээлгэн өгсөн",
    reason: `Cut-off сар хаагдсан (сүүлийн хаалт ${status.latestClosedPeriod ?? "—"})`,
    nextSteps: [
      status.openingSummaryDocs > 0
        ? `${status.openingSummaryDocs} хураангуй бүртгэл (${OPENING_REF.summary}*) хэвээр — задаргаа ирвэл дараагийн нээлттэй сард R7-оор соль`
        : "Нэвтрүүлэлт дууссан — ердийн ажиллагаа: get_workflow_guide, get_month_end_checklist",
    ],
  };
}

/** §5-ийн AI хязгаар — tool-ийн overview-д (баримттай ИЖИЛ утга, богино). */
export const ONBOARDING_LIMITS = [
  "Бичилт default-оор НООРОГ; 'Шууд бичих' горимд тэнцсэн ≤10 сая ₮ бичилт шууд батлагдана — нээлт, зөрүү, залруулгын журнал үүнд ХАМААРАХГҮЙ (үргэлж хүний баталгаа)",
  "Период хаалт, цалингийн журнал, >10 сая ₮ — үргэлж хүний баталгаа",
  "Batch 100 мөр/дуудлага; алдаатай мөр чимээгүй алгасагдахгүй — жагсаалтаар буцаана",
  "Данс/харилцагч/бараа нэрээр олдохгүй эсвэл олон таарвал таамаглахгүй — list_* tool-оор шалгаж асууна",
  "Файл бүрийг урьдчилан харуулж 'оруулах уу?' гэж батлуулна; батлаагүй бол юу ч бичихгүй",
  "Дүн, ханш, үнэ ЗОХИОХГҮЙ; externalRef-тэй тул дахин ажиллуулахад давхардахгүй",
] as const;

/** Системийн товч танилцуулга (анх холбогдсон хэрэглэгчид). */
export const ONBOARDING_INTRO = `ENTRY ACCOUNTING — Монголын нягтлан бодох бүртгэлийн систем (IFRS + Монголын татвар).
Модулиуд: Ерөнхий журнал (GL, ноорог → батлах → буцаалт) · Мөнгөн хөрөнгө (касс/банк, хуулгын тулгалт, ханшийн тэгшитгэл) · Авлага/Өглөг (нэхэмжлэх, төлөлт, суутган тооцоо) · Бараа материал (тоо хэмжээ) + Өртөг (сарын жигнэсэн дундаж, COGS) · Хангамж (PO, хүлээн авалт, импортын нэмэлт зардал) · Үндсэн хөрөнгө (элэгдэл) · НӨАТ · Цалин (НДШ, ХАОАТ) · Сар хаалт · Аудитын мөр.
Та MCP-ээр НЭГ tool давхаргаар (чат, Cowork, ChatGPT, REST бүгд ижил) бүх модульд ажиллана.

НЭВТРҮҮЛЭЛТ 5 шаттай: 0 судалгаа (материал, gap тайлан) → 1 master data → 2 нээлтийн үлдэгдэл → 3 тулгалт → 4 зэрэгцээ сар → 5 хүлээлгэн өгөх.
Дэлгэрэнгүй: get_onboarding_guide section=checklist (материал), section=rules (зөрүү шийдвэрлэх дүрэм R0–R9), section=phases (шатууд), section=status (энэ байгууллагын төлөв). Master data оруулах техник дараалал: get_workflow_guide workflow=new_company_setup.`;

/** Төлвийг хүн уншихаар форматлана. */
export function formatOnboardingStatus(status: OnboardingStatus): string {
  const phase = deriveOnboardingPhase(status);
  const c = status.counts;
  return [
    `БАЙГУУЛЛАГА: ${status.organizationName}`,
    `ШАТ ${phase.phase}/5 — ${phase.title}`,
    `Шалтгаан: ${phase.reason}`,
    "",
    "Бүртгэл: " +
      [
        `данс ${c.enabledAccounts}`,
        `харилцагч ${c.counterparties}`,
        `бараа ${c.inventoryItems}`,
        `агуулах ${c.warehouses}`,
        `касс/банк ${c.cashAccounts}`,
        `ажилтан ${c.employees}`,
        `ҮХ ${c.fixedAssets}`,
        `батлагдсан журнал ${c.postedVouchers}`,
      ].join(" · "),
    `Нээлтийн журнал: ${
      status.openingVoucher
        ? `${status.openingVoucher.documentNo ?? "(дугааргүй)"} · ${status.openingVoucher.date} · ${status.openingVoucher.status}`
        : "байхгүй"
    }`,
    `Хураангуй бүртгэл (R2): ${status.openingSummaryDocs} · Зөрүүний ноорог (R6): ${status.openingDiffDrafts} · Залруулга (R7): ${status.openingAdjustments}`,
    `Нээлтийн зөрүүний данс: ${
      status.differenceAccount
        ? `${status.differenceAccount.number} ${status.differenceAccount.name} · үлдэгдэл ${(status.differenceBalance ?? 0).toLocaleString("en-US")}₮${Math.abs(status.differenceBalance ?? 0) > 0.005 ? " — 0 болтол cut-off сарыг хаахгүй (R6)" : ""}`
        : `байхгүй — ${OPENING_DIFFERENCE_ACCOUNT.number} "${OPENING_DIFFERENCE_ACCOUNT.name}" үүсгэнэ (стандарт данс sync)`
    }`,
    `Сүүлийн хаагдсан сар: ${status.latestClosedPeriod ?? "—"}${status.openingVoucher ? ` · cut-off сар ${status.cutoffPeriodClosed ? "ХААГДСАН" : "нээлттэй"}` : ""}`,
    "",
    "ДАРААГИЙН АЛХАМ:",
    ...phase.nextSteps.map((step, index) => `${index + 1}. ${step}`),
  ].join("\n");
}
