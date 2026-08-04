import { redirect } from "next/navigation";

import { AiChatView } from "@/components/ai/ai-chat-view";
import { getAiChatBootstrap } from "@/lib/actions/ai";

export default async function AiChatPage() {
  // Хуудас болон глобал чат панель хоёул НЭГ ачаалагчийг хэрэглэнэ —
  // query давхардахгүй (lib/actions/ai.ts).
  const result = await getAiChatBootstrap();
  if (!result.ok) redirect("/login");

  return (
    <AiChatView
      initialMessages={result.data.initialMessages}
      configured={result.data.configured}
      anthropicConfigured={result.data.anthropicConfigured}
      openaiConfigured={result.data.openaiConfigured}
      initialModel={result.data.model}
      initialWriteMode={result.data.writeMode}
    />
  );
}
