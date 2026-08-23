"use client";

// AI туслах — глобал хөвөгч чат панель. Аль ч модульд ажиллаж байхдаа
// хажуудаа нээгээд байлгана. Registry-д keepMounted: true — хураастай ч
// unmount хийгдэхгүй (стрийм үргэлжилж, бичсэн draft хадгалагдана).
//
// Dirty = явж буй стрийм / бичээд илгээгээгүй асуулт / хавсралт — чатны
// view өөрөө onDirtyChange-ээр мэдэгдэнэ. Ингэснээр (1) хаахын өмнө
// баталгаажуулалт асууна (стрийм таслах нь хариултыг сервер талд ч
// алдагдуулдаг), (2) сэргээх/дахин нээх үеийн refetch зөвхөн ЦЭВЭР үед
// хийгдэж /ai хуудастай зөрөх түүхийг тэгшилнэ, бичиж буй draft-ыг хэзээ ч
// арчихгүй.

import { useEffect, useState } from "react";

import { AiChatView } from "@/components/ai/ai-chat-view";
import { getAiChatBootstrap, type AiChatBootstrap } from "@/lib/actions/ai";
import { usePanelStore, type PanelInstance } from "@/lib/store/panel-store";
import { PanelError, PanelLoading } from "@/components/panel/panel-states";

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Өгөгдөл олдсонгүй. Дахин оролдоно уу.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

export function AiChatPanel({
  panel,
}: {
  panel: PanelInstance;
  /** Панелийн хаалт — dirty бол баталгаажуулалттай (PanelHost эзэмшинэ). */
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);
  const setDirty = usePanelStore((state) => state.setDirty);

  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: AiChatBootstrap; loadedToken: number }
  >({ status: "loading" });

  // Эхний ачаалалт + сэргээх/дахин нээх бүрд түүхээ дахин татна — /ai
  // хуудсан дээр бичсэн мессежүүд панельд мөн харагдана. Стрийм явж байгаа
  // эсвэл draft бичсэн (dirty) үед алгасна — remount тэднийг устгах байсан.
  useEffect(() => {
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getAiChatBootstrap()
      .then((result) => {
        if (cancelled) return;
        // Fetch явж байх зуур стрийм эхэлсэн/draft бичигдсэн бол хаяна.
        const now = usePanelStore
          .getState()
          .panels.find((entry) => entry.id === panel.id);
        if (now?.dirty) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        setState({
          status: "ready",
          data: result.data,
          loadedToken: refreshToken,
        });
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
      <PanelLoading />
    );

  if (state.status === "error")
    return (
      <PanelError message={state.message} />
    );

  return (
    <AiChatView
      // Шинэ түүх татагдмагц цэвэрхэн remount — зөвхөн цэвэр үед татдаг
      // тул стрийм/draft-д халдахгүй.
      key={state.loadedToken}
      embedded
      initialMessages={state.data.initialMessages}
      configured={state.data.configured}
      anthropicConfigured={state.data.anthropicConfigured}
      openaiConfigured={state.data.openaiConfigured}
      initialModel={state.data.model}
      initialWriteMode={state.data.writeMode}
      onDirtyChange={(dirty) => setDirty(panel.id, dirty)}
    />
  );
}
