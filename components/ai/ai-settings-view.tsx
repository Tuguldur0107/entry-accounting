"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  removeAiApiKey,
  saveAiSettings,
  setAiApiKey,
} from "@/lib/actions/ai";
import { AI_EFFORT_OPTIONS, AI_MODELS } from "@/lib/ai/models";

interface Props {
  model: string;
  effort: string;
  customInstructions: string;
  /** Хадгалсан түлхүүрийн сүүлийн 4 тэмдэгт (байхгүй бол null). */
  keyHint: string | null;
  /** Серверийн орчинд ANTHROPIC_API_KEY байгаа эсэх (fallback). */
  envKeyConfigured: boolean;
}

export function AiSettingsView({
  model: initialModel,
  effort: initialEffort,
  customInstructions: initialInstructions,
  keyHint,
  envKeyConfigured,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [model, setModel] = useState(initialModel);
  const [effort, setEffort] = useState(initialEffort);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [keyInput, setKeyInput] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirm();

  const keyStatus = keyHint
    ? `Хадгалсан түлхүүр: sk-ant-••••${keyHint}`
    : envKeyConfigured
      ? "Серверийн орчны түлхүүр (.env.local) ашиглаж байна"
      : "Түлхүүр тохируулаагүй — AI туслах ажиллахгүй";

  function saveKey() {
    startTransition(async () => {
      try {
        await setAiApiKey(keyInput);
        setKeyInput("");
        router.refresh();
        toast.success("API түлхүүр хадгалагдлаа");
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Хадгалж чадсангүй"
        );
      }
    });
  }

  async function removeKey() {
    const ok = await confirm({
      title: "Түлхүүр устгах",
      description: envKeyConfigured
        ? "Хадгалсан түлхүүр устаж, серверийн орчны түлхүүр рүү буцна."
        : "Хадгалсан түлхүүр устана — өөр түлхүүр оруулах хүртэл AI туслах ажиллахгүй.",
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await removeAiApiKey();
        router.refresh();
        toast.success("Түлхүүр устгагдлаа");
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Устгаж чадсангүй"
        );
      }
    });
  }

  function saveSettings() {
    startTransition(async () => {
      try {
        await saveAiSettings({ model, effort, customInstructions: instructions });
        router.refresh();
        toast.success("Тохиргоо хадгалагдлаа");
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Хадгалж чадсангүй"
        );
      }
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          AI туслахын тохиргоо
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          API түлхүүр, модель, хариултын хэв маягийг эндээс тохируулна.
        </p>
      </div>

      <div className="max-w-2xl space-y-4">
        {/* API түлхүүр */}
        <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
            <Icon name="key" size="sm" />
            Anthropic API түлхүүр
          </h2>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            console.anthropic.com → API Keys хэсгээс түлхүүр үүсгэнэ. Түлхүүр
            зөвхөн сервер талд хадгалагдаж, дэлгэцэд бүтнээрээ дахин
            харагдахгүй.
          </p>
          <p
            className={
              keyHint || envKeyConfigured
                ? "mt-3 text-xs font-medium text-[var(--ea-success)]"
                : "mt-3 text-xs font-medium text-[var(--ea-danger)]"
            }
          >
            {keyStatus}
          </p>
          <div className="mt-3 flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="ai-api-key">Шинэ түлхүүр</Label>
              <Input
                id="ai-api-key"
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
              />
            </div>
            <Button
              onClick={saveKey}
              disabled={isPending || !keyInput.trim()}
            >
              Хадгалах
            </Button>
            {keyHint && (
              <Button
                variant="outline"
                onClick={removeKey}
                disabled={isPending}
                title="Хадгалсан түлхүүр устгах"
              >
                <Icon name="delete" size="sm" />
              </Button>
            )}
          </div>
        </div>

        {/* Модель + хариултын гүн + нэмэлт заавар */}
        <div className="space-y-4 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Чатны тохиргоо
          </h2>

          <div className="grid gap-1.5">
            <Label>Модель</Label>
            <SearchableSelect
              value={model}
              onChange={(value) => value && setModel(value)}
              options={AI_MODELS.map((entry) => ({
                value: entry.id,
                label: `${entry.label} — ${entry.description}`,
              }))}
              placeholder="Модель сонгох..."
              hideValue
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Хариултын гүн</Label>
            <SearchableSelect
              value={effort}
              onChange={(value) => value && setEffort(value)}
              options={AI_EFFORT_OPTIONS.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              placeholder="Гүн сонгох..."
              hideValue
            />
            <p className="text-[11px] text-[var(--ea-text-4)]">
              Claude Haiku 4.5 модельд хамаарахгүй — тэр үргэлж хөнгөн горимоор
              ажиллана.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ai-instructions">Нэмэлт заавар</Label>
            <textarea
              id="ai-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Жишээ: Манай компани худалдааны салбарт үйл ажиллагаа явуулдаг, НӨАТ суутгагч. Хариултаа аль болох товч бичээрэй."
              className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <p className="text-[11px] text-[var(--ea-text-4)]">
              Компанийн онцлог, хариултын хэв маягийн хүсэлт — асуулт бүрд AI-д
              дамжина ({instructions.length}/2000).
            </p>
          </div>

          <Button onClick={saveSettings} disabled={isPending}>
            <Icon name="save" size="sm" />
            Тохиргоо хадгалах
          </Button>
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}
