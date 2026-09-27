// Landing-ийн чат — Entry багийн Telegram группын webhook (docs/dev/public-chat.md).
//
//   POST /api/public-chat/telegram   (Telegram → X-Telegram-Bot-Api-Secret-Token)
//
// Зөвхөн PUBLIC_CHAT_TELEGRAM_CHAT_ID группаас (ба тохируулсан бол
// PUBLIC_CHAT_TELEGRAM_PRIVATE_CHAT_ID-аас): relay мессеж дээр Reply →
// тухайн зочин/өрөөнд «Entry баг» нэрээр хариу; `/room <текст>` → нийтийн
// өрөөнд; `/faq` → бэлэн хариултын товч; [Нуух]/[Сэргээх]/[Зочныг хаах] товч →
// модерац. Групп НЭЭЛТТЭЙ (хувийн chat тусдаа) үед группаас ЗӨВХӨН админ —
// админы Reply-гүй энгийн мессеж нийтийн өрөөнд очно, бусдынх бол энгийн яриа. Бусад update-ийг үл тоомсорлож 200 буцаана (Telegram дахин илгээхгүй).
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
import { findFaq } from "@/lib/public-chat/faq";
import {
  findMessage,
  findMessageByTelegramId,
  postTeamMessage,
  postTeamReply,
  postTeamReplyTo,
  setMessageHidden,
  setVisitorBlocked,
} from "@/lib/public-chat/store";
import {
  answerCallback,
  answerFaqInGroup,
  isTeamChatAdmin,
  markFaqSent,
  publicChatTelegramConfig,
  sendFaqMenu,
  sendTeamText,
  sendWelcome,
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
  const command = parseTeamUpdate(update, config.chatId, {
    privateChatId: config.privateChatId,
    plainToRoom: teamGroupIsPublic(config),
  });
  if (command.kind === "ignore") return OK();
  const chat = command.chat;

  // Нээлттэй группын олон нийтийн хэсэг — шинэ гишүүнийг угтах, угтах мессежийн
  // товч (дурын гишүүн). Хаалттай багийн группт хэрэггүй.
  if (command.kind === "welcome" || command.kind === "faq_public") {
    if (chat !== "team" || !teamGroupIsPublic(config)) return OK();
    if (command.kind === "welcome") {
      await sendWelcome(config, command.names);
      return OK();
    }
    const sent = await answerFaqInGroup(config, command.key, command.buttonMessageId).catch((error) => {
      console.error("[public-chat] faq answer:", error);
      return false;
    });
    await answerCallback(config, command.callbackId, sent ? "Хариуллаа" : "Дээр хариулсан — группаас харна уу");
    return OK();
  }

  // Нээлттэй группт хэн ч «Entry баг» нэрээр бичиж, зочныг хааж чадахгүй.
  if (chat === "team" && teamGroupIsPublic(config) && !(await isTeamChatAdmin(config, command.fromId))) {
    if (command.kind === "moderate" || command.kind === "faq_send")
      await answerCallback(config, command.callbackId, "Зөвхөн группын админ");
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
      case "faq_menu": {
        let target: string | null = null;
        if (command.replyToTelegramId != null) {
          const original = await findMessageByTelegramId(telegramRef(chat, command.replyToTelegramId));
          if (!original) {
            await sendTeamText(config, "Энэ мессеж зочны чатын relay биш — зочны мессеж дээр Reply хийж /faq бичнэ үү.", command.telegramMessageId, chat);
            return OK();
          }
          target = original.id;
        }
        await sendFaqMenu(config, chat, target, command.telegramMessageId);
        return OK();
      }
      case "faq_send": {
        const buttonRef = telegramRef(chat, command.buttonMessageId);
        // Нэг товчийг хоёр удаа дарсан / webhook дахин ирсэн — нэг л удаа.
        if (await findMessageByTelegramId(buttonRef)) {
          await answerCallback(config, command.callbackId, "Аль хэдийн илгээсэн");
          return OK();
        }
        const faq = findFaq(command.key);
        const original = command.targetMessageId ? await findMessage(command.targetMessageId) : null;
        if (!faq || (command.targetMessageId && !original)) {
          await answerCallback(config, command.callbackId, "Олдсонгүй");
          return OK();
        }
        const row = original
          ? await postTeamReplyTo(original, faq.body, command.staff, buttonRef)
          : await postTeamMessage({ scope: "room" }, faq.body, command.staff, buttonRef);
        const where = row.scope === "room" ? "нийтийн өрөө" : `хувийн <code>${(row.threadId ?? "").slice(0, 8)}</code>`;
        await markFaqSent(
          config,
          chat,
          command.buttonMessageId,
          `✅ <b>Entry баг</b> → ${where} · ${escapeHtml(faq.title)} (${escapeHtml(command.staff)})\n\n${escapeHtml(faq.body)}`
        );
        await answerCallback(config, command.callbackId, "Илгээлээ");
        return OK();
      }
      case "hide_reply": {
        const original = await findMessageByTelegramId(telegramRef(chat, command.replyToTelegramId));
        const hidden =
          original?.scope === "room" ? await setMessageHidden(original.id, true, command.staff) : null;
        await sendTeamText(
          config,
          hidden ? "🙈 Нийтийн өрөөнөөс нуулаа." : "Энэ мессеж нийтийн өрөөнд харагдаагүй — нуух зүйл алга.",
          command.telegramMessageId,
          chat
        );
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
