"use client";

// Толгой мөрний AI товч — глобал хөвөгч чат панелийг нээнэ. NewJournalButton-
// оос ялгаатай нь бүх модульд харагдана (чат хаана ч хэрэгтэй).

import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";

import { openAiChatPanel } from "@/lib/store/panel-store";

export function AiChatButton() {
  const pathname = usePathname();
  // /ai хуудсан дээр чат аль хэдийн дэлгэцээр нээлттэй — давхар панель
  // нээвэл нэг ярианы хоёр хуулбар зөрж явна.
  if (pathname === "/ai" || pathname.startsWith("/ai/")) return null;
  return (
    <button
      type="button"
      onClick={() => openAiChatPanel()}
      title="AI туслах нээх"
      className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--ea-border)] px-3 text-xs font-medium text-[var(--ea-text-2)] transition-colors hover:border-[var(--ea-border-strong)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
    >
      <Sparkles size={14} className="text-[var(--ea-primary)]" />
      AI
    </button>
  );
}
