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
      className="ea-interactive flex h-8 items-center gap-1.5 rounded-md border border-[var(--ea-accent-border)] bg-[var(--ea-accent-bg)] px-3 text-xs font-medium text-[var(--ea-interactive)]"
    >
      <Sparkles size={14} className="text-[var(--ea-interactive)]" />
      AI
    </button>
  );
}
