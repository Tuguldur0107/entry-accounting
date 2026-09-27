// Landing-ийн чатын БЭЛЭН ХАРИУЛТ — Entry баг Telegram-д `/faq` гэж товч
// сонгоход зочинд (эсвэл нийтийн өрөөнд) «Entry баг» нэрээр очно. ЦЭВЭР.
//
// Үнэ, туршилтын хугацааг `lib/billing/plans.ts`-ээс авна (тусдаа хуулбар
// БАЙХГҮЙ). Бусад баримт entry-landing `src/assistant/knowledge.ts`-тэй ИЖИЛ
// байх ёстой — боломж, холболт өөрчлөгдвөл ХОЁУЛАНГ нь шинэчилнэ.

import { PLANS, SKILLS_TRIAL_HOURS, TRIAL_DAYS } from "@/lib/billing/plans";

export type PublicChatFaq = { key: string; title: string; body: string };

function mnt(value: number | null): string {
  return value == null ? "тохиролцоно" : `${value.toLocaleString("en-US")}₮`;
}

export const PUBLIC_CHAT_FAQ: readonly PublicChatFaq[] = [
  {
    key: "what",
    title: "Entry гэж юу вэ",
    body:
      "Entry Accounting бол Монголын бизнесүүдэд зориулсан AI нягтлан бодох бүртгэлийн систем. " +
      "Та өөрийн ChatGPT эсвэл Claude-оос Entry-гээ удирдана — AI бүртгэл, тооцоо, тайланг бэлтгэж, " +
      "та Entry дээр шалгаж баталгаажуулна. Журнал, авлага / өглөг, бараа материал, цалин, НӨАТ, " +
      "үндсэн хөрөнгө, POS, eBarimt, QPay бүгд нэг дор.",
  },
  {
    key: "price",
    title: "Үнэ, багц",
    body:
      `• Standard — ${mnt(PLANS.standard.pricePerSeatMnt)} / хэрэглэгч / сар (1 компани, бүх модуль)\n` +
      `• Platform — ${mnt(PLANS.platform.pricePerSeatMnt)} / хэрэглэгч / сар (10 хүртэл компани, REST API)\n` +
      "• Enterprise, тусдаа сервер — үнийг тохиролцоно\n" +
      `Эхний ${TRIAL_DAYS} хоног үнэгүй. Төлбөрийг системээс QPay-ээр 1, 3, 6, 12 сараар төлнө.`,
  },
  {
    key: "trial",
    title: "Үнэгүй турших",
    body:
      `app.entry.mn/register хаягаар бүртгүүлбэл ${TRIAL_DAYS} хоног бүх боломжийг үнэгүй туршина ` +
      "(3 хүртэл хэрэглэгч, 1 компани). Туршилт дуусахад өгөгдөл устахгүй.",
  },
  {
    key: "connect",
    title: "ChatGPT / Claude холбох",
    body:
      "Бүртгүүлсний дараа системийн «Тохиргоо → AI холболт» хэсэгт «Хаягийг хуулаад … тохиргоог нээх» " +
      "товч бий. Claude: Settings → Connectors → Add custom connector; ChatGPT: Settings → Apps & " +
      "Connectors → Developer mode. Хаяг: app.entry.mn/api/mcp — Entry-ийн и-мэйл, нууц үгээрээ " +
      "нэвтэрч зөвшөөрнө. Юу ч суулгахгүй.",
  },
  {
    key: "skills",
    title: "«AI нягтлан» багц",
    body:
      "Entry систем ашиглахгүйгээр Entry-ийн нягтлан бодох, IFRS, татвар, цалингийн мэргэжлийн " +
      `мэдлэгийг өөрийн ChatGPT / Claude-д холбоно. ${SKILLS_TRIAL_HOURS} цаг үнэгүй, дараа нь ` +
      `${mnt(PLANS.skills.pricePerSeatMnt)} / сар. Entry Accounting хэрэглэгчдэд үнэгүй дагалдана. ` +
      "Бүртгүүлэх: app.entry.mn/register?plan=skills",
  },
  {
    key: "migrate",
    title: "Хуучин системээс шилжих",
    body:
      "Данс, харилцагч, бараа, ажилтан, үндсэн хөрөнгө, нээлтийн үлдэгдлээ Excel загвараар эсвэл " +
      "AI-гаар оруулна. Том байгууллагын шилжилтэд Entry баг туслана — утас, и-мэйлээ «Хувийн асуулт»-д " +
      "үлдээвэл холбогдоно.",
  },
  {
    key: "pos",
    title: "POS, eBarimt, QPay",
    body:
      "Борлуулалтын цэг (POS) нь кассын дэлгэц, хөнгөлөлт, ээлжтэй; борлуулалт бүр eBarimt баримтыг " +
      "автоматаар олгож, QPay QR-ээр төлбөр авна. Борлуулалт авлага, касс, бараа, өртөгт шууд бүртгэгдэнэ.",
  },
  {
    key: "contact",
    title: "Холбогдох / демо",
    body:
      "Демо үзэх, тусгай үнэ, гэрээний талаар Entry баг танд холбогдоно. Утас эсвэл и-мэйлээ чатын " +
      "«Хувийн асуулт» хэсэгт үлдээгээрэй — нийтэд харагдахгүй.",
  },
];

export function findFaq(key: string): PublicChatFaq | null {
  return PUBLIC_CHAT_FAQ.find((faq) => faq.key === key) ?? null;
}

/** `/faq`-ийн товч — callback_data ≤ 64 байт: `faq:<key>:<messageId|room>`. */
export function faqCallbackData(key: string, target: string | null): string {
  return `faq:${key}:${target ?? "room"}`;
}
