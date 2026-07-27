"use client";

// AI туслах — глобал хөвөгч чат панель. Аль ч модульд ажиллаж байхдаа
// хажуудаа нээгээд байлгана. Registry-д keepMounted: true — хураастай ч
// unmount хийгдэхгүй (стрийм үргэлжилж, бичсэн draft хадгалагдана).
//
// Ачаалалтын дүрэм: түүхээ НЭГ Л УДАА татна. Чат нээгдсэнийхээ дараа
// мессежүүд клиент талд нэмэгддэг (сервер талд давхар хадгалагддаг) тул
// сэргээх/дахин нээх бүрд refetch + remount хийвэл явж буй стрийм, бичиж
// буй draft устаж keepMounted-ийн зорилго алдагдана. refreshToken-ийг
// зөвхөн АЛДААНЫ ДАРААХ retry-д ашиглана (voucher-panel-аас энэ л
// зөрүүтэй — чатад dirty/refetch ойлголт хамаарахгүй).

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { AiChatView } from "@/components/ai/ai-chat-view";
import { getAiChatBootstrap, type AiChatBootstrap } from "@/lib/actions/ai";
import { usePanelStore, type PanelInstance } from "@/lib/store/panel-store";

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Өгөгдөл олдсонгүй. Дахин оролдоно уу.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

export function AiChatPanel({
  panel,
}: {
  panel: PanelInstance;
  /** Панелийн хаалт — энэ панельд dirty байхгүй, жаазны ✕ шууд хаана. */
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);

  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: AiChatBootstrap }
  >({ status: "loading" });
  // Амжилттай ачаалснаа тэмдэглэнэ — дараагийн refreshToken bump-ууд
  // (сэргээх, дахин нээх) чатыг дахин ачаалахгүй.
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;

    let cancelled = false;
    getAiChatBootstrap()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        loadedRef.current = true;
        setState({ status: "ready", data: result.data });
        // Док чип дээрээс тохиргоо дутуу нь харагдана.
        setTitle(
          panel.id,
          result.data.configured ? "AI туслах" : "AI туслах · Тохируулаагүй"
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, panel.id, setTitle]);

  if (state.status === "loading")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center gap-2 text-sm text-[var(--ea-text-3)]">
        <Loader2 size={16} className="animate-spin" />
        Ачаалж байна…
      </div>
    );

  if (state.status === "error")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--ea-danger)]">
        {state.message}
      </div>
    );

  return (
    <AiChatView
      embedded
      initialMessages={state.data.initialMessages}
      configured={state.data.configured}
    />
  );
}
