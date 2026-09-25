"use client";

// /ai — «AI холболт»: ChatGPT / Claude-даа Entry-г MCP-ээр холбох ЦОРЫН ГАНЦ
// хуудас. Апп доторх чат ХАСАГДСАН (2026-09-25) — хэрэглэгч өөрийн ChatGPT /
// Claude-оос ижил tool давхаргаар (lib/ai/tools.ts) ажиллана.
//
//   ① Холбох — OAuth (token хэрэггүй): хаяг + 3 алхам (components/skills/connect-guide)
//   ② Бичилтийн горим — ноорог / шууд бичих (lib/ai/write-mode.ts, MCP + REST-д нэг)
//   ③ Token — Claude Code, Codex зэрэг OAuth-гүй клиентэд (eak_…, ≤5)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ConnectGuide } from "@/components/skills/connect-guide";
import { CopyValue } from "@/components/skills/copy-value";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SwitchField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAiWriteMode } from "@/lib/actions/ai-write-mode";
import { createApiToken, revokeApiToken, type ApiTokenView } from "@/lib/actions/mcp-tokens";
import type { AiWriteMode } from "@/lib/ai/write-mode";
import { MAX_TOKENS_PER_USER } from "@/lib/mcp/constants";

/** Token-ий хугацааны сонголтууд — "" нь хугацаагүй (default). */
const TOKEN_EXPIRY_OPTIONS = [
  { value: "", label: "Хугацаагүй" },
  { value: "30", label: "30 хоног" },
  { value: "90", label: "90 хоног" },
  { value: "365", label: "365 хоног" },
] as const;

const card = "space-y-3 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4";

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className={card}>
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--ea-primary-50)] text-xs font-semibold text-[var(--ea-primary)]">
          {n}
        </span>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">{title}</h2>
      </div>
      {hint ? <p className="text-xs text-[var(--ea-text-3)]">{hint}</p> : null}
      {children}
    </section>
  );
}

export function AiConnectView({
  mcpUrl,
  writeMode: initialWriteMode,
  canWrite,
  postLimitMnt,
  mcpTokens,
}: {
  mcpUrl: string;
  writeMode: AiWriteMode;
  /** `ai:write` эрхгүй (үзэгч) гишүүн горимоо солихгүй. */
  canWrite: boolean;
  /** §9 батлах хязгаар — «Шууд бичих» тайлбарт. */
  postLimitMnt: number;
  mcpTokens: ApiTokenView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [writeMode, setWriteMode] = useState<AiWriteMode>(initialWriteMode);
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiry, setTokenExpiry] = useState("");
  // Сая үүссэн token — ЗӨВХӨН энэ render-д бүтнээрээ харагдана.
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const claudeCommand = freshToken
    ? `claude mcp add --transport http --scope user entry-accounting ${mcpUrl} --header "Authorization: Bearer ${freshToken}"`
    : null;
  // claude.ai / Cowork-ийн custom connector header дэмждэггүй — token-URL.
  const connectorUrl = freshToken ? `${mcpUrl}/${freshToken}` : null;

  function changeWriteMode(post: boolean) {
    const next: AiWriteMode = post ? "post" : "draft";
    const previous = writeMode;
    setWriteMode(next);
    startTransition(async () => {
      const result = await saveAiWriteMode(next);
      if (result.error !== undefined) {
        setWriteMode(previous);
        toast.error(result.error);
        return;
      }
      router.refresh();
      toast.success(next === "post" ? "Шууд бичих горим асаалттай" : "Ноорог горим — бичилт бүрийг вэбээс батална");
    });
  }

  function createToken() {
    startTransition(async () => {
      // Алдаа нь action-аас утгаар ирдэг (production дээр шидсэн алдааны
      // мессежийг Next нуудаг тул throw-д найдаж болохгүй).
      const result = await createApiToken(tokenName, tokenExpiry === "" ? null : Number(tokenExpiry));
      if (!result.token) {
        toast.error(result.error ?? "Үүсгэж чадсангүй");
        return;
      }
      setTokenName("");
      setFreshToken(result.token);
      router.refresh();
      toast.success("Token үүслээ — доорх утгыг ОДОО хуулж авна уу");
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
      const result = await revokeApiToken(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      toast.success("Token хүчингүй боллоо");
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

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">AI холболт</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Өөрийн {"ChatGPT"} эсвэл {"Claude"}-даа Entry-г холбоно: нягтлан бодох бүртгэл, татвар, цалингийн мэдлэгийн сан +
          энэ байгууллагын бүх модуль (журнал, нэхэмжлэх, тайлан, тулгалт) тэндээс шууд ажиллана. Юу ч суулгахгүй,
          түлхүүр хуулахгүй — багцад багтсан.
        </p>
      </div>

      <div className="max-w-2xl space-y-4">
        <Step n={1} title={`${"ChatGPT"} / ${"Claude"}-д холбох`} hint="Хаягийг нэмээд «Connect» дарахад Entry-ийн и-мэйл, нууц үгээрээ нэвтэрч зөвшөөрнө.">
          <CopyValue value={mcpUrl} />
          <ConnectGuide />
        </Step>

        <Step
          n={2}
          title="Бичилтийн горим"
          hint="AI-ийн үүсгэсэн журнал, нэхэмжлэх, кассын баримт ямар төлөвтэй орох вэ. Батлах хязгаар, том дүн, сар хаалт, цалин үргэлж ноорог үлдэнэ (§9 human-in-the-loop)."
        >
          <SwitchField
            label={writeMode === "post" ? "Шууд бичих — тэнцсэн бичилт шууд батлагдана" : "Ноорог — бичилт бүрийг вэбээс шалгаад батална"}
            hint={
              writeMode === "post"
                ? `${postLimitMnt.toLocaleString("en-US")}₮ хүртэлх тэнцсэн бичилт AI-ийн хүсэлтээр шууд GL-д орно. Хязгаараас их, ирээдүйн сар, хаалт — ноорог хэвээр.`
                : "Анхдагч, аюулгүй горим. AI зөвхөн ноорог үүсгэж, та Entry дээр батална."
            }
            checked={writeMode === "post"}
            disabled={!canWrite || isPending}
            onChange={changeWriteMode}
          />
          {!canWrite ? <p className="text-xs text-[var(--ea-text-4)]">Горимыг бичих эрхтэй гишүүн л солино.</p> : null}
        </Step>

        <Step n={3} title="Token (Claude Code, Codex)" hint="OAuth дэмждэггүй клиентэд — token нь нэг л удаа харагдана, дээд тал нь 5.">
          {mcpTokens.length > 0 && (
            <div className="space-y-1.5">
              {mcpTokens.map((token) => (
                <div key={token.id} className="flex items-center gap-3 rounded-md border border-[var(--ea-border)] px-3 py-2 text-xs">
                  <span className="font-medium text-[var(--ea-text-1)]">{token.name}</span>
                  <span className="font-mono text-[var(--ea-text-4)]">eak_••••{token.tokenHint}</span>
                  {token.expired ? (
                    <span className="font-medium text-[var(--ea-danger-fg)]">хугацаа дууссан</span>
                  ) : (
                    <span className="text-[var(--ea-text-4)]">{token.expiresAt ? `Дуусах: ${token.expiresAt}` : "Хугацаагүй"}</span>
                  )}
                  <span className="ml-auto text-[var(--ea-text-4)]">
                    {token.lastUsedAt ? `Сүүлд: ${token.lastUsedAt}` : `Үүссэн: ${token.createdAt}`}
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

          {/* Хязгаарт хүрсэн бол урьдчилан хааж, шалтгааныг ил хэлнэ. */}
          {mcpTokens.length >= MAX_TOKENS_PER_USER && (
            <p className="rounded-md bg-[var(--ea-warning)]/10 px-3 py-2 text-xs text-[var(--ea-warning-fg)]">
              Дээд тал нь {MAX_TOKENS_PER_USER} token байж болно — шинийг үүсгэхийн тулд ашиглахаа больсон token-оо эхлээд устгана уу.
            </p>
          )}
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="mcp-token-name">Шинэ token</Label>
              <Input
                id="mcp-token-name"
                placeholder="Жишээ: Codex — ажлын компьютер"
                value={tokenName}
                maxLength={60}
                disabled={mcpTokens.length >= MAX_TOKENS_PER_USER}
                onChange={(event) => setTokenName(event.target.value)}
              />
            </div>
            <div className="grid w-32 shrink-0 gap-1.5">
              <Label htmlFor="mcp-token-expiry">Хугацаа</Label>
              <select
                id="mcp-token-expiry"
                className="h-9 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg)] px-2 text-sm text-[var(--ea-text-1)]"
                value={tokenExpiry}
                onChange={(event) => setTokenExpiry(event.target.value)}
              >
                {TOKEN_EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={createToken} disabled={isPending || !tokenName.trim() || mcpTokens.length >= MAX_TOKENS_PER_USER}>
              Token үүсгэх
            </Button>
          </div>

          {freshToken && claudeCommand && (
            <div className="space-y-2 rounded-md border border-[var(--ea-warning)] bg-[var(--ea-warning)]/5 p-3">
              <p className="text-xs font-medium text-[var(--ea-warning-fg)]">Энэ token ДАХИН харагдахгүй — одоо хуулж авна уу.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded bg-[var(--ea-bg-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--ea-text-1)]">
                  {freshToken}
                </code>
                <Button variant="outline" size="sm" onClick={() => copyText(freshToken)}>
                  <Icon name="copy" size="sm" />
                </Button>
              </div>
              <p className="text-xs text-[var(--ea-text-3)]">Claude Code — terminal дээр:</p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded bg-[var(--ea-bg-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--ea-text-1)]">
                  {claudeCommand}
                </code>
                <Button variant="outline" size="sm" onClick={() => copyText(claudeCommand)}>
                  <Icon name="copy" size="sm" />
                </Button>
              </div>
              <p className="text-xs text-[var(--ea-text-3)]">
                Codex / бусад клиент — Server URL-д доорхыг (эсвэл Authorization header-т token-оо) өгнө. Token нь URL дотроо тул
                холбоосыг нууц мэт хадгална:
              </p>
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 select-all break-all rounded bg-[var(--ea-bg-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--ea-text-1)]">
                  {connectorUrl}
                </code>
                <Button variant="outline" size="sm" onClick={() => connectorUrl && copyText(connectorUrl)}>
                  <Icon name="copy" size="sm" />
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setFreshToken(null)}>
                Хуулж авсан — хаах
              </Button>
            </div>
          )}
          <p className="text-xs text-[var(--ea-text-4)]">
            Ижил token-оор REST API ч ажиллана: <code className="font-mono">POST /api/v1/tools/&lt;name&gt;</code> (жагсаалт:{" "}
            <code className="font-mono">GET /api/v1/tools</code>).
          </p>
        </Step>
      </div>
      {confirmDialog}
    </section>
  );
}
