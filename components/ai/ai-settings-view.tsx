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
  removeAiOpenAiApiKey,
  saveAiSettings,
  setAiApiKey,
  setAiOpenAiApiKey,
} from "@/lib/actions/ai";
import {
  createApiToken,
  revokeApiToken,
  type ApiTokenView,
} from "@/lib/actions/mcp-tokens";
import { AI_EFFORT_OPTIONS, AI_MODELS, AI_PROVIDER_LABELS } from "@/lib/ai/models";

interface Props {
  model: string;
  effort: string;
  customInstructions: string;
  /** Хадгалсан түлхүүрийн сүүлийн 4 тэмдэгт (байхгүй бол null). */
  keyHint: string | null;
  /** Серверийн орчинд ANTHROPIC_API_KEY байгаа эсэх (fallback). */
  envKeyConfigured: boolean;
  /** OpenAI түлхүүрийн hint + орчны fallback. */
  openaiKeyHint: string | null;
  openaiEnvKeyConfigured: boolean;
  /** MCP холболтын token-ууд. */
  mcpTokens: ApiTokenView[];
}

export function AiSettingsView({
  model: initialModel,
  effort: initialEffort,
  customInstructions: initialInstructions,
  keyHint,
  envKeyConfigured,
  openaiKeyHint,
  openaiEnvKeyConfigured,
  mcpTokens,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [model, setModel] = useState(initialModel);
  const [effort, setEffort] = useState(initialEffort);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [keyInput, setKeyInput] = useState("");
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [tokenName, setTokenName] = useState("");
  // Сая үүссэн token — ЗӨВХӨН энэ render-д бүтнээрээ харагдана.
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const keyStatus = keyHint
    ? `Хадгалсан түлхүүр: sk-ant-••••${keyHint}`
    : envKeyConfigured
      ? "Серверийн орчны түлхүүр (.env.local) ашиглаж байна"
      : "Түлхүүр тохируулаагүй — Claude моделиуд ажиллахгүй";

  const openaiKeyStatus = openaiKeyHint
    ? `Хадгалсан түлхүүр: sk-••••${openaiKeyHint}`
    : openaiEnvKeyConfigured
      ? "Серверийн орчны түлхүүр ашиглаж байна"
      : "Түлхүүр тохируулаагүй — OpenAI моделиуд ажиллахгүй (сонголтоор)";

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

  function saveOpenaiKey() {
    startTransition(async () => {
      try {
        await setAiOpenAiApiKey(openaiKeyInput);
        setOpenaiKeyInput("");
        router.refresh();
        toast.success("OpenAI түлхүүр хадгалагдлаа");
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
        : "Хадгалсан түлхүүр устана — өөр түлхүүр оруулах хүртэл Claude моделиуд ажиллахгүй.",
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

  async function removeOpenaiKey() {
    const ok = await confirm({
      title: "OpenAI түлхүүр устгах",
      description: "Хадгалсан OpenAI түлхүүр устана.",
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await removeAiOpenAiApiKey();
        router.refresh();
        toast.success("Түлхүүр устгагдлаа");
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Устгаж чадсангүй"
        );
      }
    });
  }

  function createToken() {
    startTransition(async () => {
      try {
        const { token } = await createApiToken(tokenName);
        setTokenName("");
        setFreshToken(token);
        router.refresh();
        toast.success("Token үүслээ — доорх утгыг ОДОО хуулж авна уу");
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Үүсгэж чадсангүй"
        );
      }
    });
  }

  async function revokeToken(id: string, name: string) {
    const ok = await confirm({
      title: "Token хүчингүй болгох",
      description: `"${name}" token устаж, түүгээр холбогдсон MCP клиент шууд салгагдана.`,
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await revokeApiToken(id);
        router.refresh();
        toast.success("Token хүчингүй боллоо");
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Устгаж чадсангүй"
        );
      }
    });
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Хуулагдлаа");
    } catch {
      toast.error("Хуулж чадсангүй — гараар сонгож хуулна уу");
    }
  }

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "/api/mcp";
  const claudeCommand = freshToken
    ? `claude mcp add --transport http entry-accounting ${mcpUrl} --header "Authorization: Bearer ${freshToken}"`
    : null;

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

        {/* OpenAI API түлхүүр — сонголтоор */}
        <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
            <Icon name="key" size="sm" />
            OpenAI API түлхүүр (сонголтоор)
          </h2>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            platform.openai.com → API keys хэсгээс түлхүүр үүсгэнэ. GPT
            моделиудыг чатнаас сонгож ашиглах бол шаардлагатай.
          </p>
          <p
            className={
              openaiKeyHint || openaiEnvKeyConfigured
                ? "mt-3 text-xs font-medium text-[var(--ea-success)]"
                : "mt-3 text-xs font-medium text-[var(--ea-text-4)]"
            }
          >
            {openaiKeyStatus}
          </p>
          <div className="mt-3 flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="ai-openai-key">Шинэ түлхүүр</Label>
              <Input
                id="ai-openai-key"
                type="password"
                autoComplete="off"
                placeholder="sk-..."
                value={openaiKeyInput}
                onChange={(event) => setOpenaiKeyInput(event.target.value)}
              />
            </div>
            <Button
              onClick={saveOpenaiKey}
              disabled={isPending || !openaiKeyInput.trim()}
            >
              Хадгалах
            </Button>
            {openaiKeyHint && (
              <Button
                variant="outline"
                onClick={removeOpenaiKey}
                disabled={isPending}
                title="Хадгалсан түлхүүр устгах"
              >
                <Icon name="delete" size="sm" />
              </Button>
            )}
          </div>
        </div>

        {/* MCP холболт — Claude Code зэрэг гадны клиент */}
        <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
            <Icon name="openExternal" size="sm" />
            MCP холболт (Claude Code)
          </h2>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Claude Code-оос энэ системд шууд ажиллах token. Бичилтүүд таны
            сонгосон горимоор (ноорог / шууд бичих) үүснэ. Token нэг л удаа
            харагдана — хуулж аваад Claude Code-д бүртгэнэ.
          </p>

          {mcpTokens.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {mcpTokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center gap-3 rounded-md border border-[var(--ea-border)] px-3 py-2 text-xs"
                >
                  <span className="font-medium text-[var(--ea-text-1)]">
                    {token.name}
                  </span>
                  <span className="font-mono text-[var(--ea-text-4)]">
                    eak_••••{token.tokenHint}
                  </span>
                  <span className="ml-auto text-[var(--ea-text-4)]">
                    {token.lastUsedAt
                      ? `Сүүлд: ${token.lastUsedAt}`
                      : `Үүссэн: ${token.createdAt}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => revokeToken(token.id, token.name)}
                    disabled={isPending}
                    title="Хүчингүй болгох"
                    aria-label={`${token.name} token хүчингүй болгох`}
                    className="text-[var(--ea-text-4)] transition-colors hover:text-[var(--ea-danger)]"
                  >
                    <Icon name="delete" size="sm" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="mcp-token-name">Шинэ token-ий нэр</Label>
              <Input
                id="mcp-token-name"
                placeholder="Жишээ: Claude Code — ажлын компьютер"
                value={tokenName}
                maxLength={60}
                onChange={(event) => setTokenName(event.target.value)}
              />
            </div>
            <Button
              onClick={createToken}
              disabled={isPending || !tokenName.trim()}
            >
              Token үүсгэх
            </Button>
          </div>

          {freshToken && claudeCommand && (
            <div className="mt-3 space-y-2 rounded-md border border-[var(--ea-warning)] bg-[var(--ea-warning)]/5 p-3">
              <p className="text-xs font-medium text-[var(--ea-warning-fg)]">
                Энэ token ДАХИН харагдахгүй — одоо хуулж авна уу.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded bg-[var(--ea-bg-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--ea-text-1)]">
                  {freshToken}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(freshToken)}
                >
                  <Icon name="copy" size="sm" />
                </Button>
              </div>
              <p className="text-xs text-[var(--ea-text-3)]">
                Claude Code-д бүртгэх команд (terminal дээр ажиллуулна):
              </p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded bg-[var(--ea-bg-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--ea-text-1)]">
                  {claudeCommand}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(claudeCommand)}
                >
                  <Icon name="copy" size="sm" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFreshToken(null)}
              >
                Хуулж авсан — хаах
              </Button>
            </div>
          )}
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
                hint: AI_PROVIDER_LABELS[entry.provider],
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
