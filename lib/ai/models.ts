// AI туслахад сонгож болох provider + моделиуд, тэдгээрийн API чадварууд.
// adaptive thinking / effort параметрийг дэмждэггүй моделид илгээвэл
// API 400 буцаадаг тул route чадварын дагуу параметрээ угсарна.

export type AiProvider = "anthropic" | "openai";

export type AiModelId =
  | "claude-fable-5"
  | "claude-opus-4-8"
  | "claude-sonnet-5"
  | "claude-haiku-4-5"
  | "gpt-5.1"
  | "gpt-5"
  | "gpt-5-mini";

export type AiEffort = "low" | "medium" | "high";

export interface AiModelInfo {
  id: AiModelId;
  provider: AiProvider;
  label: string;
  description: string;
  /** thinking: {type:"adaptive"} дэмждэг эсэх (Anthropic 4.6+). */
  adaptive: boolean;
  /** output_config.effort дэмждэг эсэх. */
  effort: boolean;
}

export const AI_MODELS: AiModelInfo[] = [
  {
    id: "claude-fable-5",
    provider: "anthropic",
    label: "Claude Fable 5",
    description: "Anthropic-ийн хамгийн чадварлаг — хамгийн нарийн асуултад",
    adaptive: true,
    effort: false,
  },
  {
    id: "claude-opus-4-8",
    provider: "anthropic",
    label: "Claude Opus 4.8",
    description: "Маш чадварлаг — мэргэжлийн асуултад (санал болгож буй)",
    adaptive: true,
    effort: true,
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    label: "Claude Sonnet 5",
    description: "Хурдан, хямд — өдөр тутмын асуултад",
    adaptive: true,
    effort: true,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    description: "Хамгийн хурдан — энгийн лавлагаанд",
    adaptive: false,
    effort: false,
  },
  {
    id: "gpt-5.1",
    provider: "openai",
    label: "GPT-5.1",
    description: "OpenAI-ийн үндсэн модель",
    adaptive: false,
    effort: false,
  },
  {
    id: "gpt-5",
    provider: "openai",
    label: "GPT-5",
    description: "OpenAI — өмнөх үеийн үндсэн модель",
    adaptive: false,
    effort: false,
  },
  {
    id: "gpt-5-mini",
    provider: "openai",
    label: "GPT-5 mini",
    description: "OpenAI — хурдан, хямд",
    adaptive: false,
    effort: false,
  },
];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
};

export const DEFAULT_AI_MODEL: AiModelId = "claude-opus-4-8";
export const DEFAULT_AI_EFFORT: AiEffort = "high";

/** AI бичилт хийх горим — draft = зөвхөн ноорог (§9), post = шууд батлана. */
export type AiWriteMode = "draft" | "post";
export const DEFAULT_AI_WRITE_MODE: AiWriteMode = "draft";

export const AI_EFFORT_OPTIONS: { id: AiEffort; label: string }[] = [
  { id: "high", label: "Гүн (санал болгож буй) — нарийн асуултад сайн" },
  { id: "medium", label: "Дунд — тэнцвэртэй хурд, чанар" },
  { id: "low", label: "Хөнгөн — хурдан, товч хариулт" },
];

export function isAiModelId(value: string): value is AiModelId {
  return AI_MODELS.some((model) => model.id === value);
}

export function isAiEffort(value: string): value is AiEffort {
  return AI_EFFORT_OPTIONS.some((option) => option.id === value);
}

export function isAiWriteMode(value: string): value is AiWriteMode {
  return value === "draft" || value === "post";
}

export function modelInfo(id: AiModelId): AiModelInfo {
  return AI_MODELS.find((model) => model.id === id)!;
}

/** Тухайн provider-ийн default модель. */
export function defaultModelFor(provider: AiProvider): AiModelId {
  return provider === "openai" ? "gpt-5.1" : DEFAULT_AI_MODEL;
}
