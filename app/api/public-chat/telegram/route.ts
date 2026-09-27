// Landing-ийн чат — Entry багийн Telegram группын webhook (docs/dev/public-chat.md).
//
//   POST /api/public-chat/telegram   (Telegram → X-Telegram-Bot-Api-Secret-Token)
//
// Зөвхөн PUBLIC_CHAT_TELEGRAM_CHAT_ID группаас (ба тохируулсан бол
// PUBLIC_CHAT_TELEGRAM_PRIVATE_CHAT_ID-аас): relay мессеж дээр Reply →
// тухайн зочин/өрөөнд «Entry баг» нэрээр хариу; `/room <текст>` → нийтийн
// өрөөнд; [Нуух]/[Сэргээх]/[Зочныг хаах] товч → модерац. Групп НЭЭЛТТЭЙ
// (хувийн chat тусдаа) үед группаас ЗӨВХӨН админ — бусдын Reply бол энгийн
// яриа. Бусад update-ийг үл тоомсорлож 200 буцаана (Telegram дахин илгээхгүй).
import { NextResponse } from "next/server";

import { chatGate } from "@/lib/public-chat/http";
import {
  PublicChatInputError,
  TEAM_HELP_TEXT,
  escapeHtml,
  parseTeamUpdate,
  telegramRef,
  type TelegramUpdate,
} from "@/lib/public-chat/rules";
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
  isTeamChatAdmin,
  publicChatTelegramConfig,
  sendTeamText,
  teamGroupIsPublic,
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
  const command = parseTeamUpdate(update, config.chatId, config.privateChatId);
  if (command.kind === "ignore") return OK();
  const chat = command.chat;

  // Нээлттэй группт хэн ч «Entry баг» нэрээр бичиж, зочныг хааж чадахгүй.
  if (chat === "team" && teamGroupIsPublic(config) && !(await isTeamChatAdmin(config, command.fromId))) {
    if (command.kind === "moderate") await answerCallback(config, command.callbackId, "Зөвхөн группын админ");
    return OK();
  }

  try {
    switch (command.kind) {
      case "help":
        await sendTeamText(config, escapeHtml(TEAM_HELP_TEXT), undefined, chat);
        return OK();
      case "reply": {
        const ownRef = telegramRef(chat, command.telegramMessageId);
        // Webhook дахин ирсэн (өмнөх оролдлого 5xx) — аль хэдийн бичигдсэн.
        if (await findMessageByTelegramId(ownRef)) return OK();
        const row = await postTeamReply(telegramRef(chat, command.replyToTelegramId), command.body, command.staff, ownRef);
        // Нээлттэй группт энгийн яриа ч Reply-тэй байдаг — тэнд чимээгүй.
        if (!row && !(chat === "team" && teamGroupIsPublic(config)))
          await sendTeamText(
            config,
            "Энэ мессеж зочны чатын relay биш — зочны мессеж дээр Reply хийнэ үү.",
            command.telegramMessageId,
            chat
          );
        return OK();
      }
      case "room_post": {
        const ownRef = telegramRef(chat, command.telegramMessageId);
        if (await findMessageByTelegramId(ownRef)) return OK();
        await postTeamMessage({ scope: "room" }, command.body, command.staff, ownRef);
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
      await sendTeamText(config, escapeHtml(caught.message), undefined, chat).catch(() => undefined);
      return OK();
    }
    console.error("[public-chat] telegram webhook:", caught);
    // 5xx → Telegram дахин илгээнэ (DB түр унасан г.м.)
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
