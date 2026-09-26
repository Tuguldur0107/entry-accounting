// Анхны туршилт — «Өөрийн компаниа 15 минутад Entry-д» — ЦЭВЭР, client-safe (DB-гүй).
//
// Хүн бүртгүүлдэг нь ӨӨРИЙН компанийн асуудлыг шийдэхийн тулд — зохиомол демо
// компани үнэ цэнийг хойшлуулж, ChatGPT / Claude-ийн холболт (идэвхтэй
// байгууллагад уягддаг) дахин хийх саад үүсгэдэг байв. Тиймээс гол зам нь
// AI-тай НЭВТРҮҮЛЭЛТ (get_onboarding_guide + create_*_batch + нээлтийн журнал —
// бүгд ноорог-first):
//
//   ① ChatGPT / Claude-даа холбох (өөрийн компанид)
//   ② Хуучин датагаа өгөх — данс, харилцагч, бараа, ажилтан (Excel / экспорт)
//   ③ Нээлтийн үлдэгдэл оруулж, тэнцлийг шалгах
//
// Демо компани нь ТУСЛАХ зам (дата гартаа байхгүй, эсвэл эхлээд үзэх хүнд) —
// картын доод мөрөнд. Алхам бүр ӨГӨГДЛӨӨС автоматаар ✓ болно; гурвуул хийгдмэгц
// эсвэл хэрэглэгч хаамагц карт дахин гарахгүй. Бэлэн асуултууд (`STARTER_PROMPTS`)
// нь нүүрний карт, /ai хуудас, MCP-ийн `prompts/list` гурвын ЦОРЫН ГАНЦ эх —
// ChatGPT / Claude-ийн «+» цэсэнд ч гарна. tests/first-run.test.ts.

/** Демо компанийн нэр — `createDemoCompany` (lib/actions/demo.ts) ба илрүүлэлт нэг эх. */
export const DEMO_ORG_NAME = "Демо худалдааны компани";

/** Бэлэн асуултад хэрэгтэй багцын боломж (`plans.ts` — `accounting` / `knowledge`). */
export type StarterPromptFeature = "accounting" | "knowledge";

export interface StarterPrompt {
  /** MCP prompt-ийн нэр — ^[a-z][a-z0-9_]+$, ХЭЗЭЭ Ч өөрчлөхгүй (клиент кэшилдэг). */
  id: string;
  /** Товч гарчиг (карт, ChatGPT / Claude-ийн цэс). */
  title: string;
  /** Хэрэглэгчийн хуулж асуух бүтэн текст. */
  text: string;
  feature: StarterPromptFeature;
  /** Бичилт (ноорог) үүсгэдэг эсэх — картад «ноорог» тэмдэг, итгэл төрүүлнэ. */
  writes: boolean;
}

/**
 * Эхний гурав нь НЭВТРҮҮЛЭЛТ (картын ②③ алхам) — хэрэглэгч файлаа хавсаргаад
 * асууна; AI нь get_onboarding_guide-ийн дүрмээр ноорог үүсгэнэ. Дараагийнх нь
 * өдөр тутмын ашиглалт (өөрийн ч, демо датад ч бодит хариу) — харилцагч/сарыг
 * нэрлэхгүй, AI өөрөө лавлана.
 */
export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    id: "import_master_data",
    title: "Хуучин датагаа оруулах",
    text: "Хавсаргасан файлаас (хуучин програмын экспорт эсвэл Excel) дансны жагсаалт, харилцагч, бараа, ажилтнуудаа Entry-д оруул. Эхлээд Entry-ийн нэвтрүүлэлтийн зааврыг уншаад юу дутуу байгааг хэлж, оруулахаасаа өмнө надаар батлуул.",
    feature: "accounting",
    writes: true,
  },
  {
    id: "import_opening_balances",
    title: "Нээлтийн үлдэгдэл оруулах",
    text: "Хавсаргасан эцсийн балансаас (гүйлгээ баланс эсвэл санхүүгийн байдлын тайлан) нээлтийн үлдэгдлийг Entry-д ноорог журнал болгож оруул — касс, авлага, өглөг, бараа, үндсэн хөрөнгийн задаргаатай нь. Дебет, кредит тэнцсэн эсэхийг шалга.",
    feature: "accounting",
    writes: true,
  },
  {
    id: "onboarding_check",
    title: "Оруулсан датаг шалгах",
    text: "Entry-д оруулсан датаг шалгаад: баланс тэнцсэн үү, касс, авлага, өглөг, бараа ерөнхий журналтайгаа тулж байна уу, юу дутуу байгааг дарааллаар нь хэлээч.",
    feature: "accounting",
    writes: false,
  },
  {
    id: "month_overview",
    title: "Өнгөрсөн сарын тойм",
    text: "Өнгөрсөн сарын орлого, зардал, цэвэр ашиг, мөнгөн хөрөнгийн үлдэгдлийг товч тайлбарлаад анхаарах 3 зүйлийг хэлээч.",
    feature: "accounting",
    writes: false,
  },
  {
    id: "receivables_followup",
    title: "Хэнээс мөнгө нэхэх вэ",
    text: "Төлөгдөөгүй авлагатай харилцагчдыг дүн, хугацаагаар нь жагсаагаад хэнээс эхэлж нэхэхийг зөвлө.",
    feature: "accounting",
    writes: false,
  },
  {
    id: "vat_due",
    title: "НӨАТ хэд төлөх вэ",
    text: "Өнгөрсөн сарын НӨАТ-ын тайланг гаргаад хэдэн төгрөг төлөх, хэзээ хүртэл төлөхийг хэлээч.",
    feature: "accounting",
    writes: false,
  },
  {
    id: "draft_invoice",
    title: "Нэхэмжлэх ноорог үүсгэх",
    text: "Хамгийн их худалдан авалт хийдэг харилцагчид 1,100,000₮-ийн (НӨАТ орсон) үйлчилгээний нэхэмжлэхийн ноорог үүсгэ.",
    feature: "accounting",
    writes: true,
  },
  {
    id: "month_close_check",
    title: "Сар хаахад юу дутуу вэ",
    text: "Өнгөрсөн сарыг хаахад юу дутуу байгааг шалгаад, хийх ажлыг дарааллаар нь зааж өгөөч.",
    feature: "accounting",
    writes: false,
  },
  {
    id: "balance_sheet_explain",
    title: "Балансыг энгийнээр",
    text: "Балансын тайланг гаргаад компанийн санхүүгийн байдлыг нягтлан биш хүнд ойлгомжтойгоор тайлбарла.",
    feature: "accounting",
    writes: false,
  },
  {
    id: "tax_question",
    title: "Татварын асуулт",
    text: "2026 онд цалингийн ХАОАТ-ын шатлал хэрхэн өөрчлөгдсөн бэ? Хуулийн эх сурвалжтайгаар тайлбарла.",
    feature: "knowledge",
    writes: false,
  },
  {
    id: "vat_registration",
    title: "НӨАТ-д хэзээ бүртгүүлэх вэ",
    text: "Ямар нөхцөлд НӨАТ төлөгчөөр заавал бүртгүүлэх вэ, бүртгүүлэхгүй бол ямар хариуцлагатай вэ? Хуулийн заалттай нь.",
    feature: "knowledge",
    writes: false,
  },
  {
    id: "depreciation_tax_vs_ifrs",
    title: "Элэгдэл: IFRS ба татвар",
    text: "Үндсэн хөрөнгийн санхүүгийн (IAS 16) ба татварын элэгдэл ямар ялгаатай вэ, хойшлогдсон татвар яаж үүсэх вэ? Жишээгээр тайлбарла.",
    feature: "knowledge",
    writes: false,
  },
];

/** Багцын боломжоор шүүсэн асуултууд — «AI нягтлан» (skills) багцад зөвхөн мэдлэгийнх. */
export function startersFor(features: Partial<Record<StarterPromptFeature, boolean>>): StarterPrompt[] {
  return STARTER_PROMPTS.filter((prompt) => features[prompt.feature] === true);
}

export function starterPromptById(id: string): StarterPrompt | null {
  return STARTER_PROMPTS.find((prompt) => prompt.id === id) ?? null;
}

// ── Алхмын илрүүлэлт ─────────────────────────────────────────────────────────

export interface FirstRunSignals {
  /** Одоогийн байгууллага демо компани мөн (тэнд карт гарахгүй — жишээ дата). */
  isDemoOrg: boolean;
  /** Хэрэглэгч ChatGPT / Claude-д холбосон (OAuth эсвэл token — аль ч байгууллагад). */
  connected: boolean;
  /** Одоогийн байгууллагад мастер дата бий — харилцагч, бараа эсвэл ажилтан. */
  orgHasMasterData: boolean;
  /** Одоогийн байгууллагад журнал бий (нээлтийн үлдэгдэл эсвэл анхны гүйлгээ). */
  orgHasActivity: boolean;
  /** Туршилтын хугацаанд (багцын `trialing`). */
  isTrial: boolean;
  /** Хэрэглэгч картыг хаасан (`users.welcome_dismissed_at`). */
  dismissed: boolean;
}

export type FirstRunStepKey = "connect" | "import" | "opening";

export interface FirstRunStep {
  key: FirstRunStepKey;
  title: string;
  hint: string;
  done: boolean;
  /** Энэ алхамд хуулж асуух бэлэн асуултууд (`STARTER_PROMPTS`-ийн id). */
  promptIds: string[];
}

export function firstRunSteps(signals: FirstRunSignals): FirstRunStep[] {
  return [
    {
      key: "connect",
      title: "ChatGPT / Claude-даа холбох",
      hint: "Өөрийн AI-аасаа Entry-д хандана — API түлхүүр хуулахгүй, нэмэлт төлбөргүй",
      done: signals.connected,
      promptIds: [],
    },
    {
      key: "import",
      title: "Хуучин датагаа өгөх",
      hint: "Хуучин програмын экспорт эсвэл Excel-ээ хавсаргаад доорх асуултыг асуу — данс, харилцагч, бараа, ажилтан",
      done: signals.orgHasMasterData,
      promptIds: ["import_master_data"],
    },
    {
      key: "opening",
      title: "Нээлтийн үлдэгдэл, тэнцэл",
      hint: "Эцсийн балансаа өгөөд нээлтийн журнал ноороглуулна, дараа нь бүгд тулж байгааг шалгуулна",
      done: signals.orgHasActivity,
      promptIds: ["import_opening_balances", "onboarding_check"],
    },
  ];
}

/**
 * Одоо хийх алхам — дараалалд ХИЙГДЭЭГҮЙ эхнийх (картад тэр багана өргөн,
 * хүрээ нь зөөлөн пульстэй; түүнээс хойшхи хийгдээгүй алхмууд бүдэг).
 * Бүгд хийгдсэн бол null. Дараалал заавал биш — 2-р алхам 1-ээс өмнө хийгдэж
 * болох тул «эхний хийгдээгүй» гэдгээр л шийднэ.
 */
export function activeStepKey(steps: readonly FirstRunStep[]): FirstRunStepKey | null {
  return steps.find((step) => !step.done)?.key ?? null;
}

/**
 * Карт харагдах эсэх: хаагаагүй, демо компани биш, гурвуул хийгдээгүй, мөн
 * туршилт эсвэл журналгүй байгууллага (идэвхтэй ажиллаж буй харилцагчид ХЭЗЭЭ Ч
 * гарахгүй).
 */
export function shouldShowWelcome(signals: FirstRunSignals): boolean {
  if (signals.dismissed || signals.isDemoOrg) return false;
  if (firstRunSteps(signals).every((step) => step.done)) return false;
  return signals.isTrial || !signals.orgHasActivity;
}

// ── MCP (prompts/list, prompts/get) ──────────────────────────────────────────

export interface McpPromptDescriptor {
  name: string;
  title: string;
  description: string;
  arguments: [];
}

export function mcpPromptList(features: Partial<Record<StarterPromptFeature, boolean>>): McpPromptDescriptor[] {
  return startersFor(features).map((prompt) => ({
    name: prompt.id,
    title: prompt.title,
    description: prompt.writes ? `${prompt.text} (ноорог үүснэ — Entry-д та батална)` : prompt.text,
    arguments: [],
  }));
}

/** prompts/get — багцад ороогүй эсвэл үл мэдэгдэх нэр бол null (дуудагч -32602 буцаана). */
export function mcpPromptMessages(
  name: string,
  features: Partial<Record<StarterPromptFeature, boolean>>
): { description: string; messages: { role: "user"; content: { type: "text"; text: string } }[] } | null {
  const prompt = startersFor(features).find((entry) => entry.id === name);
  if (!prompt) return null;
  return {
    description: prompt.title,
    messages: [{ role: "user", content: { type: "text", text: prompt.text } }],
  };
}

/**
 * MCP `instructions`-ийн сүүлд — хэрэглэгч юу асуухаа мэдэхгүй бол AI өөрөө
 * санал болгоно (гарчгуудаас 3-ыг).
 */
export function starterInstructionHint(features: Partial<Record<StarterPromptFeature, boolean>>): string {
  const titles = startersFor(features)
    .slice(0, 4)
    .map((prompt) => `«${prompt.title}»`);
  if (titles.length === 0) return "";
  return ` Хэрэглэгч юу хийлгэхээ мэдэхгүй байвал жишээ санал болго: ${titles.join(", ")}.`;
}
