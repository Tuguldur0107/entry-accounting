// Landing-ийн чат — Entry багийн Telegram группын webhook (docs/dev/public-chat.md).
//
//   POST /api/public-chat/telegram   (Telegram → X-Telegram-Bot-Api-Secret-Token)
//
// Зөвхөн PUBLIC_CHAT_TELEGRAM_CHAT_ID группаас: relay мессеж дээр Reply →
// тухайн зочин/өрөөнд «Entry баг» нэрээр хариу; `/room <текст>` → нийтийн
// өрөөнд; [Нуух]/[Сэргээх]/[Зочныг хаах] товч → модерац. Бусад update-ийг
// үл тоомсорлож 200 буцаана (Telegram дахин илгээхгүй).
import { NextResponse } from "next/server";

import { chatGate } from "@/lib/public-chat/http";
import { PublicChatInputError, TEAM_HELP_TEXT, escapeHtml, parseTeamUpdate, type TelegramUpdate } from "@/lib/public-chat/rules";
import {
  findMessage,
  findMessageByTelegramId,
  postTeamMessage,
  postTeamReply,
  setMessageHidden,
  setVisitorBlocked,
} from "@/lib/public-chat/store";
import {
  answerCallback,
  publicChatTelegramConfig,
  sendTeamText,
  updateModerationButtons,
  webhookAuthorized,
} from "@/lib/public-chat/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OK = () => NextResponse.json({ ok: true });

export async function POST(request: Request) {
  const blocked = chatGate(request);
  if (blocked) return blocked;
  const config = publicChatTelegramConfig();
  if (!config) return NextResponse.json({ ok: false, error: "not configured" }, { status: 404 });
  if (!webhookAuthorized(config, request.headers.get("x-telegram-bot-api-secret-token")))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return OK();
  }
  const command = parseTeamUpdate(update, config.chatId);

  try {
    switch (command.kind) {
      case "ignore":
        return OK();
      case "help":
        await sendTeamText(config, escapeHtml(TEAM_HELP_TEXT));
        return OK();
      case "reply": {
        // Webhook дахин ирсэн (өмнөх оролдлого 5xx) — аль хэдийн бичигдсэн.
        if (await findMessageByTelegramId(command.telegramMessageId)) return OK();
        const row = await postTeamReply(command.replyToTelegramId, command.body, command.staff, command.telegramMessageId);
        if (!row)
          await sendTeamText(config, "Энэ мессеж зочны чатын relay биш — зочны мессеж дээр Reply хийнэ үү.", command.telegramMessageId);
        return OK();
      }
      case "room_post": {
        if (await findMessageByTelegramId(command.telegramMessageId)) return OK();
        await postTeamMessage({ scope: "room" }, command.body, command.staff, command.telegramMessageId);
        return OK();
      }
      case "moderate": {
        const message = await findMessage(command.messageId);
        if (!message || message.scope !== "room") {
          await answerCallback(config, command.callbackId, "Мессеж олдсонгүй");
          return OK();
        }
        if (command.action === "block") {
          if (!message.visitorId) {
            await answerCallback(config, command.callbackId, "Зочин олдсонгүй");
            return OK();
          }
          await setVisitorBlocked(message.visitorId, true, command.staff);
          await answerCallback(config, command.callbackId, "Зочныг хаалаа — нийтийн мессежүүд нь нуугдлаа");
        } else {
          const hidden = command.action === "hide";
          await setMessageHidden(message.id, hidden, command.staff);
          await answerCallback(config, command.callbackId, hidden ? "Нуулаа" : "Сэргээлээ");
        }
        if (message.telegramMessageId)
          await updateModerationButtons(config, Number(message.telegramMessageId), message.id, command.action !== "unhide");
        return OK();
      }
    }
  } catch (caught) {
    if (caught instanceof PublicChatInputError) {
      await sendTeamText(config, escapeHtml(caught.message)).catch(() => undefined);
      return OK();
    }
    console.error("[public-chat] telegram webhook:", caught);
    // 5xx → Telegram дахин илгээнэ (DB түр унасан г.м.)
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
