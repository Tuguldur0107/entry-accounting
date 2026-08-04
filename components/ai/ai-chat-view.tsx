"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { saveAiChatPrefs } from "@/lib/actions/ai";
import {
  parseAiContent,
  stripPartialMarker,
  type AiAction,
} from "@/lib/ai/action-markers";
import {
  AI_MODELS,
  AI_PROVIDER_LABELS,
  modelInfo,
  type AiModelId,
  type AiWriteMode,
} from "@/lib/ai/models";
import {
  openArapDocPanel,
  openCashDocPanel,
  openFaAssetPanel,
  openVoucherPanel,
} from "@/lib/store/panel-store";
import { cn } from "@/lib/utils";

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: { name: string }[];
};

type PendingAttachment = {
  name: string;
  mediaType: string;
  data: string; // base64
  size: number;
};

interface Props {
  initialMessages: AiChatMessage[];
  /** Идэвхтэй provider-т түлхүүр тохируулагдсан эсэх. */
  configured: boolean;
  /** Provider бүрийн түлхүүрийн төлөв — модель сонгогчийн анхааруулгад. */
  anthropicConfigured?: boolean;
  openaiConfigured?: boolean;
  /** Сүүлд хадгалсан модель + бичилтийн горим (aiSettings). */
  initialModel?: AiModelId;
  initialWriteMode?: AiWriteMode;
  /**
   * Панель дотор — хуудасны гарчгийг (панелийн жаазны гарчигтай давхардана)
   * нууж, flex эцгээ дүүргэсэн нягт байрлалтай render хийнэ.
   */
  embedded?: boolean;
  /**
   * "Алдагдах юмтай" төлвийн мэдэгдэл — бичээд илгээгээгүй асуулт,
   * хавсралт, явж буй стрийм байвал true. Панель үүнийг dirty болгож
   * хаахын өмнө баталгаажуулалт асуудаг.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

const SUGGESTIONS = [
  "500,000₮-ийн түрээсийн зардлын журналын ноорог бэлдээд өгөөч",
  "Борлуулалтын НӨАТ-тай бичилтийг хэрхэн хийх вэ?",
  "Цалингийн журналын бичилтийг тайлбарлаад өг",
  "Системд шинэ данс хаанаас нээх вэ?",
];

/** Action картын төрөл бүрийн икон, шошго, нээх үйлдэл. */
const ACTION_META: Record<
  AiAction["kind"],
  { icon: IconName; label: string }
> = {
  voucher: { icon: "journal", label: "Журнал" },
  arap: { icon: "document", label: "Нэхэмжлэх" },
  cash: { icon: "cash", label: "Мөнгөн хөрөнгө" },
  inventory: { icon: "inventory", label: "Бараа материал" },
  fa: { icon: "fixedAsset", label: "Үндсэн хөрөнгө" },
};

const ACTION_STATUS: Record<
  AiAction["status"],
  { label: string; className: string }
> = {
  draft: {
    label: "Ноорог",
    className: "text-[var(--ea-warning-fg)] border-[var(--ea-warning)]",
  },
  posted: {
    label: "Батлагдсан",
    className: "text-[var(--ea-success-fg)] border-[var(--ea-success)]",
  },
  confirmed: {
    label: "Баталгаажсан",
    className: "text-[var(--ea-success-fg)] border-[var(--ea-success)]",
  },
  active: {
    label: "Идэвхтэй",
    className: "text-[var(--ea-success-fg)] border-[var(--ea-success)]",
  },
};

/** AI-ийн үүсгэсэн объектын карт — дарахад панель/хуудас нээнэ. */
function ActionCard({ action }: { action: AiAction }) {
  const meta = ACTION_META[action.kind];
  const status = ACTION_STATUS[action.status] ?? ACTION_STATUS.draft;

  function open() {
    if (action.kind === "voucher") openVoucherPanel(action.id, action.title);
    else if (action.kind === "arap")
      openArapDocPanel({
        documentId: action.id,
        mode: "combined",
        title: action.title,
      });
    else if (action.kind === "cash") openCashDocPanel(action.id, action.title);
    else if (action.kind === "fa") openFaAssetPanel(action.id, action.title);
  }

  const body = (
    <>
      <Icon name={meta.icon} size="sm" className="shrink-0 text-[var(--ea-primary)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-[var(--ea-text-1)]">
          {action.title}
        </span>
        <span className="text-[10px] text-[var(--ea-text-4)]">{meta.label}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
          status.className
        )}
      >
        {status.label}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--ea-primary)]">
        Нээх
        <Icon name="openDetail" size="xs" />
      </span>
    </>
  );

  const className =
    "my-1.5 flex w-full items-center gap-2.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 text-left transition-colors hover:border-[var(--ea-primary)]";

  // Бараа материалын хөдөлгөөнд панель байхгүй — жагсаалт руу нь холбоно.
  if (action.kind === "inventory")
    return (
      <Link href="/inventory/movements" className={className}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={open} className={className}>
      {body}
    </button>
  );
}

const MAX_ATTACHMENTS = 4;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,application/pdf,image/png,image/jpeg,image/gif,image/webp,text/plain,text/csv,text/markdown";

/**
 * Стрийм текстийг ТОГТМОЛ хурдтай, бичигдэж буй мэт задална. Сүлжээний
 * chunk-ууд жигд бус, бөөнөөрөө ирдэг тул шууд үзүүлбэл текст "үсэрч"
 * харагддаг — оронд нь бүрэн ирсэн текстийг буфер гэж үзээд rAF-аар
 * тэгш хурдаар нээнэ. Хоцрол ихсэх тусам хурд пропорциональ нэмэгддэг
 * (адаптив) тул стрийм дууссаны дараа хормын дотор гүйцдэг, хэзээ ч
 * хоцорч "чирэгдэхгүй". Түүхийн мессеж (streaming=false mount) шууд
 * бүтнээрээ гарна.
 */
function SmoothStreamText({
  text,
  streaming,
  onReveal,
}: {
  text: string;
  streaming: boolean;
  /** Тэмдэгт нэмэгдэж өндөр өсөх бүрд — эцэг доош гүйлгэлтээ дагуулна. */
  onReveal?: () => void;
}) {
  const [shown, setShown] = useState(() => (streaming ? 0 : text.length));
  const shownRef = useRef(shown);

  useEffect(() => {
    if (shownRef.current >= text.length) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Tab идэвхгүй байгаад эргэж ирэхэд dt хэт томрохоос хамгаална.
      const dt = Math.min(now - last, 100);
      last = now;
      const backlog = text.length - shownRef.current;
      if (backlog > 0) {
        // Суурь ~90 тэмдэгт/сек; хоцрол ихэдвэл хурдасна (0.2 секундэд гүйцнэ).
        const speed = Math.max(90, backlog * 5);
        shownRef.current = Math.min(
          text.length,
          shownRef.current + Math.max(1, Math.round((speed * dt) / 1000))
        );
        setShown(shownRef.current);
        onReveal?.();
      }
      if (shownRef.current < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, onReveal]);

  return (
    <>
      {text.slice(0, shown)}
      {/* Анивчих caret — стрийм явж байгаа (дараагийн chunk хүлээж буй
          завсарлагад ч) эсвэл задаргаа гүйцээгүй үед харагдана. */}
      {(streaming || shown < text.length) && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] animate-pulse rounded-[1px] bg-[var(--ea-primary)]"
        />
      )}
    </>
  );
}

// Зарим OS .md/.csv-д хоосон MIME өгдөг — өргөтгөлөөс нь тодорхойлно.
function resolveMediaType(file: File): string | null {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "md") return "text/markdown";
  if (ext === "csv") return "text/csv";
  if (ext === "txt") return "text/plain";
  return null;
}

function fmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function AiChatView({
  initialMessages,
  configured,
  anthropicConfigured = true,
  openaiConfigured = false,
  initialModel = "claude-opus-4-8",
  initialWriteMode = "draft",
  embedded = false,
  onDirtyChange,
}: Props) {
  const [messages, setMessages] = useState<AiChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [model, setModel] = useState<AiModelId>(initialModel);
  const [writeMode, setWriteMode] = useState<AiWriteMode>(initialWriteMode);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageSeqRef = useRef(0);
  const { confirm, dialog: confirmDialog } = useConfirm();
  // Эхний render-д байсан мессежүүд fade-in хийхгүй — зөвхөн ШИНЭЭР
  // нэмэгдсэн bubble mount дээрээ нэг удаа зөөлөн орж ирнэ.
  const [initialCount] = useState(initialMessages.length);

  // Хэрэглэгч дээш гүйлгэсэн байхад доош чирэхгүй; нуугдсан (display:none,
  // clientHeight=0) байхад scroll тооцоо утгагүй тул алгасна. Мессеж
  // нэмэгдэхэд ч, стрийм задаргааны frame бүрд ч (SmoothStreamText.onReveal)
  // энэ л логик ажиллана.
  function followScroll() {
    const el = scrollRef.current;
    if (!el || el.clientHeight === 0) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight });
  }

  useEffect(() => {
    followScroll();
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Хаагдвал алдагдах зүйл: бичээд илгээгээгүй асуулт, хавсралт, явж буй
  // стрийм (сервер хариултыг стрийм дуусахад л хадгалдаг).
  const dirty = isStreaming || input.trim() !== "" || pending.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Модель/горимын сонголт серверт хадгалагдана — дараагийн нээлтэд сэргэнэ.
  function applyPrefs(nextModel: AiModelId, nextMode: AiWriteMode) {
    setModel(nextModel);
    setWriteMode(nextMode);
    saveAiChatPrefs({ model: nextModel, writeMode: nextMode }).catch(() => {
      // Хадгалалт амжилтгүй ч сонголт энэ session-д хүчинтэй хэвээр.
    });
  }

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const next: PendingAttachment[] = [];
    for (const file of list) {
      if (pending.length + next.length >= MAX_ATTACHMENTS) {
        toast.error(`Дээд тал нь ${MAX_ATTACHMENTS} файл хавсаргана`);
        break;
      }
      const mediaType = resolveMediaType(file);
      if (!mediaType) {
        toast.error(`"${file.name}" — дэмжигдэхгүй төрөл`);
        continue;
      }
      if (file.size === 0) {
        toast.error(`"${file.name}" — хоосон файл байна`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`"${file.name}" — 5MB-с том байна`);
        continue;
      }
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      }).catch(() => null);
      if (!data) {
        toast.error(`"${file.name}" — уншиж чадсангүй`);
        continue;
      }
      next.push({ name: file.name, mediaType, data, size: file.size });
    }
    // Зэрэг хоёр удаа дуудагдсан ч (сонгох + paste) дээд хязгаарыг
    // functional updater дотор баталгаажуулна.
    if (next.length > 0)
      setPending((current) =>
        [...current, ...next].slice(0, MAX_ATTACHMENTS)
      );
  }

  async function send(text: string) {
    const message = text.trim();
    if ((!message && pending.length === 0) || isStreaming) return;
    if (!configured) {
      toast.error(
        "AI туслах тохируулагдаагүй — Тохиргоо хэсэгт API түлхүүрээ оруулна уу."
      );
      return;
    }

    const attachments = pending;
    setInput("");
    setPending([]);
    const seq = ++messageSeqRef.current;
    const userLocalId = `local-user-${seq}`;
    const assistantId = `pending-${seq}`;
    setMessages((current) => [
      ...current,
      {
        id: userLocalId,
        role: "user",
        content: message,
        attachments: attachments.map((entry) => ({ name: entry.name })),
      },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // Сервер хүсэлтийг хүлээж авсан (headers OK) эсэх — үгүй бол мессеж
    // хадгалагдаагүй тул composer-ийг сэргээнэ.
    let accepted = false;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          model,
          mode: writeMode,
          attachments: attachments.map((entry) => ({
            name: entry.name,
            mediaType: entry.mediaType,
            data: entry.data,
          })),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Хүсэлт амжилтгүй боллоо");
      }
      accepted = true;

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Хариу уншиж чадсангүй");
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantId
              ? { ...entry, content: entry.content + chunk }
              : entry
          )
        );
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        // Зогсоосон — хагас хариулт сервер дээр хадгалагдаагүйг тэмдэглэнэ.
        setMessages((current) =>
          current
            .map((entry) =>
              entry.id === assistantId && entry.content
                ? {
                    ...entry,
                    content:
                      entry.content + "\n\n⏹ Зогсоосон — түүхэнд хадгалагдаагүй.",
                  }
                : entry
            )
            .filter((entry) => !(entry.id === assistantId && !entry.content))
        );
      } else {
        toast.error(
          caught instanceof Error ? caught.message : "Алдаа гарлаа"
        );
        if (!accepted) {
          // Сервер хүлээж аваагүй — бичсэн зүйлийг нь буцааж өгнө.
          setMessages((current) =>
            current.filter(
              (entry) => entry.id !== assistantId && entry.id !== userLocalId
            )
          );
          setInput(message);
          setPending(attachments);
        } else {
          // Стрим дундаа тасарсан — хоосон assistant bubble-ийг л хасна.
          setMessages((current) =>
            current.filter(
              (entry) => !(entry.id === assistantId && !entry.content)
            )
          );
        }
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }

  async function clearHistory() {
    const ok = await confirm({
      title: "Түүх цэвэрлэх",
      description:
        "Харилцан ярианы бүх түүх, хавсралтууд устана. AI дараагийн асуултад өмнөх яриаг санахгүй.",
      confirmText: "Цэвэрлэх",
      danger: true,
    });
    if (!ok) return;
    const response = await fetch("/api/ai/chat", { method: "DELETE" });
    if (response.ok) {
      setMessages([]);
      toast.success("Түүх цэвэрлэгдлээ");
    } else {
      toast.error("Цэвэрлэж чадсангүй");
    }
  }

  const clearHistoryButton =
    messages.length > 0 ? (
      <Button
        variant="outline"
        size="sm"
        onClick={clearHistory}
        disabled={isStreaming}
      >
        <Icon name="delete" size="sm" />
        Түүх цэвэрлэх
      </Button>
    ) : null;

  return (
    <section
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        embedded ? "gap-2 p-3" : "gap-3"
      )}
    >
      {embedded ? (
        // Панелийн жааз өөрөө "AI туслах" гарчигтай — хуудасны толгойг
        // давхардуулахгүй, зөвхөн түүх цэвэрлэх товчийг үлдээнэ.
        clearHistoryButton && (
          <div className="flex justify-end">{clearHistoryButton}</div>
        )
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-[var(--ea-text-1)]">
              <Icon name="ai" size="lg" className="text-[var(--ea-primary)]" />
              AI туслах
            </h1>
            <p className="mt-1 text-xs text-[var(--ea-text-3)]">
              Нягтлан бодох бүртгэл, татвар, журналын бичилтийн зөвлөгөө. AI
              журналд шууд бичилт хийхгүй — санал болгосон бичилтийг өөрөө
              шалгаж баталгаажуулна.
            </p>
          </div>
          {clearHistoryButton}
        </div>
      )}

      {!configured && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 text-xs text-[var(--ea-danger)]">
          API түлхүүр тохируулагдаагүй тул AI туслах ажиллахгүй.
          <Link
            href="/ai/settings"
            className="inline-flex items-center gap-1 font-medium underline"
          >
            <Icon name="settings" size="xs" />
            Тохиргоо руу очих
          </Link>
        </p>
      )}

      <div
        ref={scrollRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)]",
          embedded ? "p-3" : "p-4"
        )}
      >
        {messages.length === 0 ? (
          <div className="m-auto flex max-w-md flex-col items-center gap-4 text-center">
            <Icon name="ai" size="2xl" className="text-[var(--ea-primary)]" />
            <p className="text-sm text-[var(--ea-text-3)]">
              Нягтлан бодох бүртгэлийн асуултаа асуугаарай — журналын бичилт,
              НӨАТ, цалин, өртөг, элэгдэл… Нэхэмжлэх, хуулгын зураг/PDF
              хавсаргаж болно.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  disabled={isStreaming || !configured}
                  className="rounded-full border border-[var(--ea-border)] px-3 py-1.5 text-xs text-[var(--ea-text-2)] transition hover:border-[var(--ea-primary)] hover:text-[var(--ea-primary)] disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((entry, index) => (
            <div
              key={entry.id}
              className={cn(
                "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed",
                entry.role === "user"
                  ? "self-end bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
                  : "self-start border border-[var(--ea-border)] bg-[var(--ea-bg)] text-[var(--ea-text-1)]",
                // Шинэ bubble зөөлөн орж ирнэ (түүхийнх шууд харагдана).
                index >= initialCount &&
                  "animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
              )}
            >
              {entry.attachments && entry.attachments.length > 0 && (
                <span className="mb-1.5 flex flex-wrap gap-1.5">
                  {entry.attachments.map((attachment, attachmentIndex) => (
                    <span
                      key={`${attachment.name}-${attachmentIndex}`}
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                        entry.role === "user"
                          ? "bg-[var(--ea-surface)]/20"
                          : "bg-[var(--ea-surface)]"
                      )}
                    >
                      <Icon name="file" size="xs" />
                      <span className="max-w-40 truncate">{attachment.name}</span>
                    </span>
                  ))}
                </span>
              )}
              {entry.content ? (
                entry.role === "assistant" ? (
                  (() => {
                    const streaming = isStreaming && index === messages.length - 1;
                    // Стрийм үед хагас ирсэн action маркерыг нууна.
                    const segments = parseAiContent(
                      streaming
                        ? stripPartialMarker(entry.content)
                        : entry.content
                    );
                    const lastTextIndex = segments.reduce(
                      (last, segment, segmentIndex) =>
                        segment.type === "text" ? segmentIndex : last,
                      -1
                    );
                    return segments.map((segment, segmentIndex) =>
                      segment.type === "action" ? (
                        <ActionCard key={segmentIndex} action={segment.action} />
                      ) : (
                        <span key={segmentIndex} className="whitespace-pre-wrap">
                          {streaming && segmentIndex === lastTextIndex ? (
                            <SmoothStreamText
                              text={segment.text}
                              streaming
                              onReveal={followScroll}
                            />
                          ) : (
                            segment.text
                          )}
                        </span>
                      )
                    );
                  })()
                ) : (
                  <span className="whitespace-pre-wrap">{entry.content}</span>
                )
              ) : isStreaming && index === messages.length - 1 ? (
                <span className="inline-flex gap-1 py-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:300ms]" />
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>

      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pending.map((attachment, index) => (
            <span
              key={`${attachment.name}-${index}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 py-1 text-xs text-[var(--ea-text-2)]"
            >
              <Icon name="file" size="xs" />
              <span className="max-w-44 truncate">{attachment.name}</span>
              <span className="text-[var(--ea-text-4)]">
                {fmtSize(attachment.size)}
              </span>
              <button
                type="button"
                aria-label={`${attachment.name} хасах`}
                onClick={() =>
                  setPending((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index)
                  )
                }
                className="text-[var(--ea-text-4)] transition hover:text-[var(--ea-danger)]"
              >
                <Icon name="close" size="xs" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Модель + бичилтийн горим — сонголт серверт хадгалагдана */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModelPicker
          model={model}
          anthropicConfigured={anthropicConfigured}
          openaiConfigured={openaiConfigured}
          disabled={isStreaming}
          onChange={(next) => applyPrefs(next, writeMode)}
        />
        <div
          role="radiogroup"
          aria-label="Бичилтийн горим"
          className="flex h-7 items-center gap-0.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={writeMode === "draft"}
            disabled={isStreaming}
            onClick={() => applyPrefs(model, "draft")}
            title="AI бичилт бүр ноорог үүсгэнэ — та шалгаад өөрөө батална"
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              writeMode === "draft"
                ? "bg-[var(--ea-primary)] text-white"
                : "text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]"
            )}
          >
            Ноорог
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={writeMode === "post"}
            disabled={isStreaming}
            onClick={() => applyPrefs(model, "post")}
            title="Тэнцсэн, 10 сая ₮ хүртэлх бичилт шууд батлагдана — бусад нь ноорог үлдэнэ"
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
              writeMode === "post"
                ? "bg-[var(--ea-warning)] text-black"
                : "text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]"
            )}
          >
            <Icon name="warning" size="xs" className="mr-1 inline-block" />
            Шууд бичих
          </button>
        </div>
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-12 px-3"
          title="Файл хавсаргах (зураг, PDF, TXT/CSV)"
          aria-label="Файл хавсаргах"
          disabled={isStreaming || pending.length >= MAX_ATTACHMENTS}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="attach" size="sm" />
        </Button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(input);
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length > 0) {
              event.preventDefault();
              addFiles(files);
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Асуултаа бичээд Enter дарна уу… (Shift+Enter — шинэ мөр)"
          className="min-h-[3rem] flex-1 resize-none rounded-lg border border-input bg-transparent px-2.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button
            type="button"
            variant="outline"
            className="h-12"
            onClick={() => abortRef.current?.abort()}
          >
            <Icon name="stop" size="sm" />
            Зогсоох
          </Button>
        ) : (
          <Button
            type="submit"
            className="h-12"
            disabled={!input.trim() && pending.length === 0}
          >
            <Icon name="send" size="sm" />
            Илгээх
          </Button>
        )}
      </form>
      {confirmDialog}
    </section>
  );
}

/**
 * Модель сонгогч — composer-ийн дээр provider-оор бүлэглэсэн жагсаалт
 * (дээшээ нээгдэнэ). Түлхүүргүй provider-ийн моделиуд идэвхгүй, шалтгаан нь
 * бүлгийн гарчигт харагдана.
 */
function ModelPicker({
  model,
  onChange,
  anthropicConfigured,
  openaiConfigured,
  disabled,
}: {
  model: AiModelId;
  onChange: (model: AiModelId) => void;
  anthropicConfigured: boolean;
  openaiConfigured: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const info = modelInfo(model);
  const providerReady = (provider: "anthropic" | "openai") =>
    provider === "openai" ? openaiConfigured : anthropicConfigured;

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${AI_PROVIDER_LABELS[info.provider]} · ${info.description}`}
        className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-[11px] font-medium text-[var(--ea-text-2)] transition-colors hover:text-[var(--ea-text-1)] disabled:opacity-50"
      >
        <Icon name="ai" size="xs" className="text-[var(--ea-primary)]" />
        {info.label}
        <Icon
          name="chevronDown"
          size="xs"
          className={cn(
            "text-[var(--ea-text-4)] transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Модель сонгох"
          className="absolute bottom-full left-0 z-[90] mb-1 w-80 rounded-md border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] p-1"
          style={{ boxShadow: "var(--ea-shadow-3)" }}
        >
          {(["anthropic", "openai"] as const).map((provider) => (
            <div key={provider}>
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--ea-text-4)]">
                {AI_PROVIDER_LABELS[provider]}
                {!providerReady(provider) && (
                  <span className="ml-1.5 font-normal normal-case">
                    · түлхүүр тохируулаагүй (Тохиргоо)
                  </span>
                )}
              </div>
              {AI_MODELS.filter((entry) => entry.provider === provider).map(
                (entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={entry.id === model}
                    disabled={!providerReady(provider)}
                    onClick={() => {
                      onChange(entry.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition-colors disabled:opacity-40",
                      entry.id === model
                        ? "bg-[var(--ea-primary)] text-white"
                        : "text-[var(--ea-text-1)] hover:bg-[var(--ea-bg-2)]"
                    )}
                  >
                    <span className="text-xs font-medium">{entry.label}</span>
                    <span
                      className={cn(
                        "text-[10px]",
                        entry.id === model
                          ? "text-white/80"
                          : "text-[var(--ea-text-4)]"
                      )}
                    >
                      {entry.description}
                    </span>
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
