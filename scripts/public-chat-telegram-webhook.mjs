// Landing-ийн чатын Telegram bot-ийн webhook-ийг тохируулна (НЭГ удаа, deploy-ийн дараа).
// docs/dev/public-chat.md «Тохиргоо».
//
//   PUBLIC_CHAT_TELEGRAM_BOT_TOKEN=… PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET=… \
//     node scripts/public-chat-telegram-webhook.mjs https://app.entry.mn
//
// Бот нь мэдэгдлийн bot-оос ТУСДАА байна (тэр нь getUpdates ашигладаг тул
// webhook тавибал холболтын код уншигдахаа болино).

import { config } from "dotenv";

config({ path: ".env.local" });

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
const token = process.env.PUBLIC_CHAT_TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET?.trim();

if (!/^https:\/\//.test(base) || !token || !secret) {
  console.error(
    "Хэрэглээ: PUBLIC_CHAT_TELEGRAM_BOT_TOKEN, PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET env-тэй\n" +
      "  node scripts/public-chat-telegram-webhook.mjs https://<апп-ын домэйн>"
  );
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
  console.error("PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET нь 16–256 тэмдэгт, зөвхөн A-Z a-z 0-9 _ - байна (Telegram-ийн шаардлага)");
  process.exit(1);
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${base}/api/public-chat/telegram`,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  }),
});
const json = await response.json();
console.log(json.ok ? `✓ webhook → ${base}/api/public-chat/telegram` : `✗ ${json.description ?? response.status}`);
process.exit(json.ok ? 0 : 1);
