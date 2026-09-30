"use client";

// «AI нягтлан» — хэрэглэгчийн ChatGPT / Claude-ийг Entry-ийн мэдлэгийн сантай
// «нягтлан» болгох хэсэг: ① төлөв (багцад үнэгүй багтсан эсэх, өнөөдрийн
// уншилт) → ② сонголт (хэнд, ямар дэлгэрэнгүй) → ③ төслийн заавар хуулах.
// Заавар бүтээгч ЦЭВЭР: lib/ai/accountant-setup.ts. Сонголт зөвхөн энэ хөтчид
// (localStorage) — хэрэглэгч бүрийн тав тух, DB-д хадгалахгүй.
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips, PageTabs } from "@/components/ui/tabs";
import {
  ACCOUNTANT_AUDIENCE_LABELS,
  ACCOUNTANT_DETAIL_LABELS,
  ACCOUNTANT_PASTE_STEPS,
  buildAccountantInstructions,
  parseAccountantSetup,
  type AccountantAudience,
  type AccountantDetail,
  type AccountantSetup,
  type AiAccountantStatus,
} from "@/lib/ai/accountant-setup";
import { CONNECTOR_TARGETS, type ConnectorClient } from "@/lib/ai/connector-clients";
import type { AiWriteMode } from "@/lib/ai/write-mode";
import { useCopyFlash } from "@/lib/hooks/use-copy-flash";

const STORAGE_KEY = "ea:ai-accountant-setup";

// Хөтчийн сонголт — useSyncExternalStore (SSR snapshot = анхдагч, hydration зөрөхгүй).
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const AUDIENCE_OPTIONS = (Object.keys(ACCOUNTANT_AUDIENCE_LABELS) as AccountantAudience[]).map((value) => ({
  value,
  label: ACCOUNTANT_AUDIENCE_LABELS[value],
}));
const DETAIL_OPTIONS = (Object.keys(ACCOUNTANT_DETAIL_LABELS) as AccountantDetail[]).map((value) => ({
  value,
  label: ACCOUNTANT_DETAIL_LABELS[value],
}));

export function AiAccountantSetup({
  status,
  orgName,
  accounting,
  writeMode,
  showStatus = true,
}: {
  status: AiAccountantStatus;
  orgName: string | null;
  /** Байгууллага нягтлан бодох системийг ашигладаг эсэх (бичилт, тайлан MCP-ээр). */
  accounting: boolean;
  writeMode: AiWriteMode;
  /**
   * Төлөвийн мөрийг харуулах эсэх — «AI нягтлан» (skills) нүүрэнд төлбөрийн
   * алхам төлөвийг аль хэдийн харуулдаг тул нуух (хаалттай үед шалтгаан л гарна).
   */
  showStatus?: boolean;
}) {
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  // Storage хаалттай (хувийн цонх) үед энэ хуудсанд л санах нөөц.
  const [memory, setMemory] = useState<string | null>(null);
  const setup = parseAccountantSetup(memory ?? stored);
  const [client, setClient] = useState<ConnectorClient>("claude");
  const { copiedKey, copy } = useCopyFlash("Хуулагдлаа — төслийн Instructions-д буулгана уу");

  function update(next: Partial<AccountantSetup>) {
    const raw = JSON.stringify({ ...setup, ...next });
    setMemory(raw);
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      // Хадгалж чадаагүй ч энэ хуудсанд сонголт ажиллана.
    }
    listeners.forEach((listener) => listener());
  }

  const instructions = buildAccountantInstructions({ orgName, accounting, writeMode, setup });
  const copied = copiedKey === "instructions";

  return (
    <div className="space-y-3">
      {showStatus ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={status.tone} size="sm">
            {status.badge}
          </StatusBadge>
          {status.usable ? (
            <span className="text-xs text-[var(--ea-text-3)]">
              Өнөөдөр {status.readsToday} / {status.dailyLimit} хэсэг уншсан
              {status.sections > 0 ? ` · санд ${status.sections} хэсэг` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      {showStatus || !status.usable ? (
        <p
          className="text-xs leading-relaxed"
          style={{ color: status.usable ? "var(--ea-text-2)" : "var(--ea-danger-fg)" }}
        >
          {status.message}
        </p>
      ) : null}

      {status.usable ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-[var(--ea-text-2)]">Хэнд зориулж хариулах</p>
              <FilterChips options={AUDIENCE_OPTIONS} value={setup.audience} onChange={(audience) => update({ audience })} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-[var(--ea-text-2)]">Хариултын хэлбэр</p>
              <FilterChips options={DETAIL_OPTIONS} value={setup.detail} onChange={(detail) => update({ detail })} />
            </div>
          </div>

          <PageTabs<ConnectorClient>
            tabs={(["claude", "chatgpt"] as const).map((value) => ({ value, label: CONNECTOR_TARGETS[value].label }))}
            value={client}
            onChange={setClient}
          />
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[var(--ea-text-2)]">
            {ACCOUNTANT_PASTE_STEPS[client].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <div className="space-y-2">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[var(--ea-r-sm)] border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 font-sans text-xs leading-relaxed text-[var(--ea-text-1)]">
              {instructions}
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={copied ? "outline" : "default"}
                onClick={() => void copy("instructions", instructions)}
                aria-live="polite"
              >
                <Icon name={copied ? "approve" : "copy"} size="xs" className={copied ? "ea-pop" : undefined} />
                {copied ? "Хуулагдлаа" : "Зааврыг хуулах"}
              </Button>
              <span className="text-[11px] text-[var(--ea-text-4)]">{instructions.length} тэмдэгт</span>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--ea-text-4)]">
            Заавар таны {CONNECTOR_TARGETS[client].label}-ийн төсөлд хадгалагдана — Entry юу ч суулгахгүй, нэмэлт төлбөргүй.
            {accounting ? " Бичилтийн горимыг сольсон бол зааврыг дахин хуулж шинэчилнэ." : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
