// AI туслахад сонгож болох моделиуд + тэдгээрийн API чадварууд.
// adaptive thinking / effort параметрийг дэмждэггүй моделид илгээвэл
// API 400 буцаадаг тул route чадварын дагуу параметрээ угсарна.

export type AiModelId =
  | "claude-opus-4-8"
  | "claude-sonnet-5"
  | "claude-haiku-4-5";

export type AiEffort = "low" | "medium" | "high";

export const AI_MODELS: {
  id: AiModelId;
  label: string;
  description: string;
  adaptive: boolean;
  effort: boolean;
}[] = [
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    description: "Хамгийн чадварлаг — нарийн мэргэжлийн асуултад (санал болгож буй)",
    adaptive: true,
    effort: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Хурдан, хямд — өдөр тутмын асуултад",
    adaptive: true,
    effort: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Хамгийн хурдан — энгийн лавлагаанд",
    adaptive: false,
    effort: false,
  },
];

export const DEFAULT_AI_MODEL: AiModelId = "claude-opus-4-8";
export const DEFAULT_AI_EFFORT: AiEffort = "high";

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
