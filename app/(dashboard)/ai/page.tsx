import { asc, eq } from "drizzle-orm";

import { AiChatView, type AiChatMessage } from "@/components/ai/ai-chat-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiMessages, aiSettings } from "@/lib/db/schema";

export default async function AiChatPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [history, settings] = await Promise.all([
    db.query.aiMessages.findMany({
      where: eq(aiMessages.userId, userId),
      orderBy: [asc(aiMessages.createdAt)],
      with: { attachments: { columns: { name: true } } },
    }),
    db.query.aiSettings.findFirst({
      where: eq(aiSettings.userId, userId),
      columns: { apiKey: true },
    }),
  ]);

  const messages: AiChatMessage[] = history.map((entry) => ({
    id: entry.id,
    role: entry.role as "user" | "assistant",
    content: entry.content,
    attachments: entry.attachments.map((attachment) => ({
      name: attachment.name,
    })),
  }));

  return (
    <AiChatView
      initialMessages={messages}
      configured={Boolean(settings?.apiKey || process.env.ANTHROPIC_API_KEY)}
    />
  );
}
