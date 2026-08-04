import { eq } from "drizzle-orm";

import { AiSettingsView } from "@/components/ai/ai-settings-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/ai/crypto";
import { DEFAULT_AI_EFFORT, DEFAULT_AI_MODEL } from "@/lib/ai/models";

export default async function AiSettingsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const settings = await db.query.aiSettings.findFirst({
    where: eq(aiSettings.userId, userId),
  });

  // Түлхүүр шифрлэгдсэн хадгалагддаг — hint-д сүүлийн 4 тэмдэгтийг л
  // тайлж үзүүлнэ (тайлагдахгүй бол •••• — AUTH_SECRET солигдсон гэх мэт).
  const storedKey = settings?.apiKey ? decryptSecret(settings.apiKey) : null;
  const keyHint = settings?.apiKey ? (storedKey?.slice(-4) ?? "····") : null;
  const storedOpenaiKey = settings?.openaiApiKey
    ? decryptSecret(settings.openaiApiKey)
    : null;
  const openaiKeyHint = settings?.openaiApiKey
    ? (storedOpenaiKey?.slice(-4) ?? "····")
    : null;

  return (
    <AiSettingsView
      model={settings?.model ?? DEFAULT_AI_MODEL}
      effort={settings?.effort ?? DEFAULT_AI_EFFORT}
      customInstructions={settings?.customInstructions ?? ""}
      keyHint={keyHint}
      envKeyConfigured={Boolean(process.env.ANTHROPIC_API_KEY)}
      openaiKeyHint={openaiKeyHint}
      openaiEnvKeyConfigured={Boolean(process.env.OPENAI_API_KEY)}
    />
  );
}
