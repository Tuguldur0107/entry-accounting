// Анхны туршилт («Entry-г 5 минутад мэдэр») — ЦЭВЭР, client-safe (DB-гүй).
//
// Шинэ хэрэглэгч бүртгүүлмэгц систем ЧАДВАРТАЙ ч «юунаас эхлэх вэ» гэдгийг
// өөрөө олох ёстой байв (самбарын checklist, «Демо компани» товч, /ai-ийн
// холбох заавар тархай). Энд НЭГ зам:
//
//   ① Бэлэн дататай туршиж үзэх (демо компани) — эсвэл өөрийн дата аль хэдийн бий
//   ② ChatGPT / Claude-даа холбох (OAuth / token)
//   ③ Эхний асуултаа асуух (MCP-ээр анхны tool дуудлага)
//
// Алхам бүр ӨГӨГДЛӨӨС автоматаар ✓ болно (заавар уншуулахгүй); гурвуул
// хийгдмэгц эсвэл хэрэглэгч хаамагц карт ХЭЗЭЭ Ч дахин гарахгүй.
// Бэлэн асуултууд (`STARTER_PROMPTS`) нь нүүрний карт, /ai хуудас, MCP-ийн
// `prompts/list` гурвын ЦОРЫН ГАНЦ эх — ChatGPT / Claude-ийн «+» цэсэнд ч гарна.
// tests/first-run.test.ts.

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
 * Демо компанийн датад (өнгөрсөн 2 сарын борлуулалт, худалдан авалт, төлбөр,
 * цалин, НӨАТ) шууд бодит хариу өгөхөөр сонгосон асуултууд. Хэрэглэгчийн өөрийн
 * датад ч адил ажиллана — харилцагч/сарыг нэрлэхгүй, AI өөрөө лавлана.
 */
export const STARTER_PROMPTS: readonly StarterPrompt[] = [
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
  /** Хэрэглэгч «Демо худалдааны компани»-ийн гишүүн. */
  hasDemoOrg: boolean;
  /** Одоогийн байгууллага демо компани мөн. */
  isDemoOrg: boolean;
  /** Одоогийн байгууллагад журнал бий (өөрийн датагаа оруулж эхэлсэн). */
  orgHasActivity: boolean;
  /** Хэрэглэгч ChatGPT / Claude-д холбосон (OAuth эсвэл token — аль ч байгууллагад). */
  connected: boolean;
  /** MCP-ээр дор хаяж нэг дуудлага хийгдсэн (token-ий `lastUsedAt`). */
  toolUsed: boolean;
  /** Туршилтын хугацаанд (багцын `trialing`). */
  isTrial: boolean;
  /** Хэрэглэгч картыг хаасан (`users.welcome_dismissed_at`). */
  dismissed: boolean;
}

export type FirstRunStepKey = "try" | "connect" | "ask";

export interface FirstRunStep {
  key: FirstRunStepKey;
  title: string;
  hint: string;
  done: boolean;
}

export function firstRunSteps(signals: FirstRunSignals): FirstRunStep[] {
  return [
    {
      key: "try",
      title: "Бэлэн дататай туршиж үзэх",
      hint: "2 сарын борлуулалт, худалдан авалт, цалинтай демо компани — өөрийн датаг хөндөхгүй",
      // Өөрийн дата аль хэдийн бий бол демо шаардлагагүй.
      done: signals.hasDemoOrg || (signals.orgHasActivity && !signals.isDemoOrg),
    },
    {
      key: "connect",
      title: "ChatGPT / Claude-даа холбох",
      hint: "Өөрийн AI-аасаа Entry-д хандана — API түлхүүр хуулахгүй, нэмэлт төлбөргүй",
      done: signals.connected,
    },
    {
      key: "ask",
      title: "Эхний асуултаа асуух",
      hint: "Доорх асуултын аль нэгийг хуулж ChatGPT / Claude-даа асуугаарай",
      done: signals.toolUsed,
    },
  ];
}

/**
 * Карт харагдах эсэх: хаагаагүй, гурвуул хийгдээгүй, мөн туршилт / демо /
 * хоосон байгууллага (идэвхтэй ажиллаж буй харилцагчид ХЭЗЭЭ Ч гарахгүй).
 */
export function shouldShowWelcome(signals: FirstRunSignals): boolean {
  if (signals.dismissed) return false;
  if (firstRunSteps(signals).every((step) => step.done)) return false;
  return signals.isTrial || signals.isDemoOrg || !signals.orgHasActivity;
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
