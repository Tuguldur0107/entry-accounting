import { asc, eq } from "drizzle-orm";

import { AiChatView, type AiChatMessage } from "@/components/ai/ai-chat-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiMessages } from "@/lib/db/schema";

export default async function AiChatPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const history = await db.query.aiMessages.findMany({
    where: eq(aiMessages.userId, userId),
    orderBy: [asc(aiMessages.createdAt)],
  });

  const messages: AiChatMessage[] = history.map((entry) => ({
    id: entry.id,
    role: entry.role as "user" | "assistant",
    content: entry.content,
  }));

  return (
    <AiChatView
      initialMessages={messages}
      configured={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
