"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Paperclip,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
  /** API түлхүүр (хэрэглэгчийн эсвэл серверийн) тохируулагдсан эсэх. */
  configured: boolean;
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
  "Борлуулалтын НӨАТ-тай бичилтийг хэрхэн хийх вэ?",
  "Цалингийн журналын бичилтийг тайлбарлаад өг",
  "Бараа материалын өртөг хэрхэн тооцогддог вэ?",
  "Үндсэн хөрөнгийн элэгдлийг хэзээ бичих ёстой вэ?",
];

const MAX_ATTACHMENTS = 4;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.md,application/pdf,image/png,image/jpeg,image/gif,image/webp,text/plain,text/csv,text/markdown";

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
  embedded = false,
  onDirtyChange,
}: Props) {
  const [messages, setMessages] = useState<AiChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageSeqRef = useRef(0);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Нуугдсан (display:none) байхад хэмжээс 0 — scroll тооцоо утгагүй тул
    // алгасна. Хураасан панелийн visibility:hidden үед layout хэвээр тул
    // стрийм үргэлжлэхэд доош гүйлгэлт хэвийн ажиллана.
    if (el.clientHeight === 0) return;
    // Хэрэглэгч дээш гүйлгэсэн байхад стримийн chunk бүрд доош чирэхгүй.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Хаагдвал алдагдах зүйл: бичээд илгээгээгүй асуулт, хавсралт, явж буй
  // стрийм (сервер хариултыг стрийм дуусахад л хадгалдаг).
  const dirty = isStreaming || input.trim() !== "" || pending.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
        <Trash2 size={14} />
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
              <Sparkles size={18} className="text-[var(--ea-primary)]" />
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
            <Settings size={12} />
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
            <Sparkles size={28} className="text-[var(--ea-primary)]" />
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
                  : "self-start border border-[var(--ea-border)] bg-[var(--ea-bg)] text-[var(--ea-text-1)]"
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
                      <FileText size={11} />
                      <span className="max-w-40 truncate">{attachment.name}</span>
                    </span>
                  ))}
                </span>
              )}
              <span className="whitespace-pre-wrap">
                {entry.content ||
                  (isStreaming && index === messages.length - 1 ? (
                    <span className="inline-flex gap-1 py-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:300ms]" />
                    </span>
                  ) : null)}
              </span>
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
              <FileText size={12} />
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
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

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
          <Paperclip size={15} />
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
            <Square size={14} />
            Зогсоох
          </Button>
        ) : (
          <Button
            type="submit"
            className="h-12"
            disabled={!input.trim() && pending.length === 0}
          >
            <Send size={14} />
            Илгээх
          </Button>
        )}
      </form>
      {confirmDialog}
    </section>
  );
}
