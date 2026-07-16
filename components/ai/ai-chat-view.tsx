"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

interface Props {
  initialMessages: AiChatMessage[];
  /** Сервер талд ANTHROPIC_API_KEY тохируулагдсан эсэх. */
  configured: boolean;
}

const SUGGESTIONS = [
  "Борлуулалтын НӨАТ-тай бичилтийг хэрхэн хийх вэ?",
  "Цалингийн журналын бичилтийг тайлбарлаад өг",
  "Бараа материалын өртөг хэрхэн тооцогддог вэ?",
  "Үндсэн хөрөнгийн элэгдлийг хэзээ бичих ёстой вэ?",
];

export function AiChatView({ initialMessages, configured }: Props) {
  const [messages, setMessages] = useState<AiChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageSeqRef = useRef(0);
  const { confirm, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || isStreaming) return;
    if (!configured) {
      toast.error(
        "AI туслах тохируулагдаагүй — .env.local файлд ANTHROPIC_API_KEY нэмнэ үү."
      );
      return;
    }

    setInput("");
    const seq = ++messageSeqRef.current;
    const assistantId = `pending-${seq}`;
    setMessages((current) => [
      ...current,
      { id: `local-user-${seq}`, role: "user", content: message },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Хүсэлт амжилтгүй боллоо");
      }

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
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        toast.error(
          caught instanceof Error ? caught.message : "Алдаа гарлаа"
        );
        // Хоосон үлдсэн assistant bubble-ийг авч хаяна.
        setMessages((current) =>
          current.filter(
            (entry) => !(entry.id === assistantId && !entry.content)
          )
        );
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
        "Харилцан ярианы бүх түүх устана. AI дараагийн асуултад өмнөх яриаг санахгүй.",
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

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-[var(--ea-text-1)]">
            <Sparkles size={18} className="text-[var(--ea-primary)]" />
            AI туслах
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Нягтлан бодох бүртгэл, татвар, журналын бичилтийн зөвлөгөө. AI
            журналд шууд бичилт хийхгүй — санал болгосон бичилтийг өөрөө шалгаж
            баталгаажуулна.
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearHistory}
            disabled={isStreaming}
          >
            <Trash2 size={14} />
            Түүх цэвэрлэх
          </Button>
        )}
      </div>

      {!configured && (
        <p className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 text-xs text-[var(--ea-danger)]">
          ANTHROPIC_API_KEY тохируулагдаагүй тул AI туслах ажиллахгүй.
          .env.local файлд түлхүүрээ нэмээд серверээ дахин асаана уу.
        </p>
      )}

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-4"
      >
        {messages.length === 0 ? (
          <div className="m-auto flex max-w-md flex-col items-center gap-4 text-center">
            <Sparkles size={28} className="text-[var(--ea-primary)]" />
            <p className="text-sm text-[var(--ea-text-3)]">
              Нягтлан бодох бүртгэлийн асуултаа асуугаарай — журналын бичилт,
              НӨАТ, цалин, өртөг, элэгдэл…
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
                "max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-sm leading-relaxed",
                entry.role === "user"
                  ? "self-end bg-[var(--ea-primary)] text-white"
                  : "self-start border border-[var(--ea-border)] bg-[var(--ea-bg)] text-[var(--ea-text-1)]"
              )}
            >
              {entry.content ||
                (isStreaming && index === messages.length - 1 ? (
                  <span className="inline-flex gap-1 py-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ea-text-3)] [animation-delay:300ms]" />
                  </span>
                ) : null)}
            </div>
          ))
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
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
          rows={2}
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
          <Button type="submit" className="h-12" disabled={!input.trim()}>
            <Send size={14} />
            Илгээх
          </Button>
        )}
      </form>
      {confirmDialog}
    </section>
  );
}
