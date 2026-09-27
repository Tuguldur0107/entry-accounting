import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_CHAT_DEFAULT_NAME,
  PUBLIC_CHAT_MAX_BODY,
  PublicChatInputError,
  allowedOrigins,
  containsLink,
  isVisitorToken,
  maskPersonalData,
  normalizeBody,
  normalizeName,
  normalizePhone,
  parseTeamUpdate,
  prepareRoomMessage,
  prepareThreadStart,
  relayText,
  telegramRef,
} from "../lib/public-chat/rules";
import { PUBLIC_CHAT_FAQ, faqCallbackData, findFaq } from "../lib/public-chat/faq";
import { PLANS } from "../lib/billing/plans";

test("normalizeBody — хоосон, урт, удирдах тэмдэгт, илүү мөр", () => {
  assert.throws(() => normalizeBody("   "), PublicChatInputError);
  assert.throws(() => normalizeBody(42), PublicChatInputError);
  assert.throws(() => normalizeBody("а".repeat(PUBLIC_CHAT_MAX_BODY + 1)), PublicChatInputError);
  assert.equal(normalizeBody("  сайн​ байна уу\r\n\n\n\nтийм  "), "сайн байна уу\n\nтийм");
  assert.equal(normalizeBody("а".repeat(PUBLIC_CHAT_MAX_BODY)).length, PUBLIC_CHAT_MAX_BODY);
});

test("normalizeName — default, багийн нэр дуурайхыг хориглоно", () => {
  assert.equal(normalizeName(undefined), PUBLIC_CHAT_DEFAULT_NAME);
  assert.equal(normalizeName("   "), PUBLIC_CHAT_DEFAULT_NAME);
  assert.equal(normalizeName("  Бат   Эрдэнэ "), "Бат Эрдэнэ");
  for (const bad of ["Entry баг", "entry", "Админ", "Support", "Дэмжлэг"])
    assert.throws(() => normalizeName(bad), PublicChatInputError, bad);
  assert.throws(() => normalizeName("а".repeat(41)), PublicChatInputError);
});

test("normalizePhone — 8 орон, +976 зөвшөөрнө", () => {
  assert.equal(normalizePhone("+976 9911-2233"), "99112233");
  assert.equal(normalizePhone(""), null);
  assert.throws(() => normalizePhone("12345"), PublicChatInputError);
});

test("containsLink — нийтийн өрөөнд холбоос", () => {
  for (const text of ["https://x.y", "www.example.org", "t.me/spam", "манай site.mn-д", "shop.com"])
    assert.equal(containsLink(text), true, text);
  for (const text of ["НӨАТ 10% уу?", "1.5 сая төгрөг", "e-Balance тайлан"]) assert.equal(containsLink(text), false, text);
});

test("maskPersonalData — утас, и-мэйл, РД, данс нуугдана; дүн хөндөгдөхгүй", () => {
  const cases: [string, string][] = [
    ["утас 99112233 байна", "утас [утас нуусан] байна"],
    ["+976 8811 2233", "[утас нуусан]"],
    ["mail: a.b@c.mn", "mail: [и-мэйл нуусан]"],
    ["РД УБ12345678", "РД [РД нуусан]"],
    ["рд: ТА 01234567", "рд: [РД нуусан]"],
    ["данс 5012345678", "данс [дугаар нуусан]"],
    ["карт 4111 1111 1111 1111", "карт [дугаар нуусан]"],
  ];
  for (const [input, expected] of cases) {
    const result = maskPersonalData(input);
    assert.equal(result.text, expected, input);
    assert.equal(result.masked, true, input);
  }
  for (const text of ["150 000 000₮ борлуулалт", "10000000 төгрөг", "2026-09-27", "12 ажилтан"]) {
    const result = maskPersonalData(text);
    assert.equal(result.text, text, text);
    assert.equal(result.masked, false, text);
  }
});

test("prepareRoomMessage — холбоос татгалзана, хувийн мэдээлэл нуугдана", () => {
  assert.throws(() => prepareRoomMessage({ body: "https://spam.xyz" }), PublicChatInputError);
  const prepared = prepareRoomMessage({ name: "Бат", body: "Над руу 99112233 залгаарай" });
  assert.deepEqual(prepared, { name: "Бат", body: "Над руу [утас нуусан] залгаарай", masked: true });
});

test("prepareThreadStart — хувийн ярианд холбоос, утас зөвшөөрнө", () => {
  const prepared = prepareThreadStart({ body: "https://my.site.mn 99112233", email: "A@B.MN", phone: "99112233" });
  assert.equal(prepared.body, "https://my.site.mn 99112233");
  assert.equal(prepared.email, "a@b.mn");
  assert.throws(() => prepareThreadStart({ body: "x", email: "bad" }), PublicChatInputError);
});

test("isVisitorToken / allowedOrigins", () => {
  assert.equal(isVisitorToken("a".repeat(43)), true);
  assert.equal(isVisitorToken("a".repeat(42)), false);
  assert.equal(isVisitorToken("a".repeat(42) + "="), false);
  assert.deepEqual(allowedOrigins(undefined), ["https://entry.mn", "https://www.entry.mn"]);
  assert.deepEqual(allowedOrigins(" https://a.mn/ , http://localhost:3001"), ["https://a.mn", "http://localhost:3001"]);
});

const TEAM = "-100500";

test("parseTeamUpdate — Reply, /room, модерац; өөр chat, bot үл тоомсорлоно", () => {
  const from = { first_name: "Туул" };
  assert.deepEqual(
    parseTeamUpdate(
      { message: { message_id: 9, chat: { id: -100500 }, from, text: "Сайн байна уу", reply_to_message: { message_id: 7 } } },
      TEAM
    ),
    { kind: "reply", replyToTelegramId: 7, body: "Сайн байна уу", staff: "Туул", telegramMessageId: 9, chat: "team", fromId: null }
  );
  assert.deepEqual(parseTeamUpdate({ message: { message_id: 10, chat: { id: TEAM }, from, text: "/room@EntryBot НӨАТ 10%" } }, TEAM), {
    kind: "room_post",
    body: "НӨАТ 10%",
    staff: "Туул",
    telegramMessageId: 10,
    chat: "team",
    fromId: null,
  });
  assert.deepEqual(parseTeamUpdate({ message: { message_id: 11, chat: { id: TEAM }, from, text: "/room" } }, TEAM), { kind: "help", chat: "team", fromId: null });
  const id = "0b7a2c1e-1111-4222-8333-444455556666";
  assert.deepEqual(
    parseTeamUpdate({ callback_query: { id: "cb", from, data: `block:${id}`, message: { message_id: 3, chat: { id: TEAM } } } }, TEAM),
    { kind: "moderate", action: "block", messageId: id, staff: "Туул", callbackId: "cb", chat: "team", fromId: null }
  );
  // Өөр chat, bot-ийн мессеж, Reply-гүй энгийн яриа, танихгүй callback
  assert.equal(parseTeamUpdate({ message: { message_id: 1, chat: { id: 1 }, text: "x", reply_to_message: { message_id: 7 } } }, TEAM).kind, "ignore");
  assert.equal(
    parseTeamUpdate({ message: { message_id: 1, chat: { id: TEAM }, from: { is_bot: true }, text: "/room x" } }, TEAM).kind,
    "ignore"
  );
  assert.equal(parseTeamUpdate({ message: { message_id: 1, chat: { id: TEAM }, from, text: "өөр хоорондоо" } }, TEAM).kind, "ignore");
  assert.equal(
    parseTeamUpdate({ callback_query: { id: "cb", data: "drop:x", message: { message_id: 3, chat: { id: TEAM } } } }, TEAM).kind,
    "ignore"
  );
});

test("parseTeamUpdate — хувийн chat (нээлттэй групп горим), илгээгчийн id; telegramRef", () => {
  const PRIVATE = "7160304495";
  const admin = { id: 42, first_name: "Туул" };
  // Хувийн chat — тохируулсан үед л танигдана
  const dm = { message: { message_id: 5, chat: { id: 7160304495 }, from: admin, text: "За", reply_to_message: { message_id: 4 } } };
  assert.equal(parseTeamUpdate(dm, TEAM).kind, "ignore");
  assert.deepEqual(parseTeamUpdate(dm, TEAM, { privateChatId: PRIVATE }), {
    kind: "reply",
    replyToTelegramId: 4,
    body: "За",
    staff: "Туул",
    telegramMessageId: 5,
    chat: "private",
    fromId: 42,
  });
  // Группаас — илгээгчийн id (админ эсэхийг webhook шалгана)
  const group = parseTeamUpdate({ message: { message_id: 6, chat: { id: TEAM }, from: { id: 99 }, text: "/help" } }, TEAM, { privateChatId: PRIVATE });
  assert.deepEqual(group, { kind: "help", chat: "team", fromId: 99 });
  const id = "0b7a2c1e-1111-4222-8333-444455556666";
  const cb = parseTeamUpdate(
    { callback_query: { id: "cb", from: { id: 99 }, data: `hide:${id}`, message: { message_id: 3, chat: { id: TEAM } } } },
    TEAM,
    { privateChatId: PRIVATE }
  );
  assert.equal(cb.kind === "moderate" && cb.fromId, 99);
  // message_id chat бүрт тусдаа — хувийн chat-ийнх угтвартай
  assert.equal(telegramRef("team", 7), "7");
  assert.equal(telegramRef("private", 7), "p:7");
});

test("parseTeamUpdate — нээлттэй группт энгийн текст → өрөө, /faq, бэлэн хариултын товч", () => {
  const from = { id: 42, first_name: "Туул" };
  const plain = { message: { message_id: 20, chat: { id: TEAM }, from, text: "Шинэ хувилбар гарлаа" } };
  // Хаалттай багийн группт энгийн яриа хэвээр — өрөөнд очихгүй
  assert.equal(parseTeamUpdate(plain, TEAM).kind, "ignore");
  assert.deepEqual(parseTeamUpdate(plain, TEAM, { plainToRoom: true }), {
    kind: "room_post",
    body: "Шинэ хувилбар гарлаа",
    staff: "Туул",
    telegramMessageId: 20,
    chat: "team",
    fromId: 42,
  });
  // Хувийн chat-ийн энгийн текст өрөөнд ХЭЗЭЭ Ч очихгүй
  assert.equal(
    parseTeamUpdate({ message: { message_id: 3, chat: { id: 555 }, from, text: "тэмдэглэл" } }, TEAM, { privateChatId: "555", plainToRoom: true }).kind,
    "ignore"
  );
  assert.deepEqual(
    parseTeamUpdate({ message: { message_id: 21, chat: { id: TEAM }, from, text: "/faq", reply_to_message: { message_id: 7 } } }, TEAM),
    { kind: "faq_menu", replyToTelegramId: 7, telegramMessageId: 21, chat: "team", fromId: 42 }
  );
  assert.deepEqual(parseTeamUpdate({ message: { message_id: 22, chat: { id: TEAM }, from, text: "/faq@EntryMnChatBot" } }, TEAM), {
    kind: "faq_menu",
    replyToTelegramId: null,
    telegramMessageId: 22,
    chat: "team",
    fromId: 42,
  });
  const id = "0b7a2c1e-1111-4222-8333-444455556666";
  assert.deepEqual(
    parseTeamUpdate({ callback_query: { id: "cb", from, data: faqCallbackData("price", id), message: { message_id: 30, chat: { id: TEAM } } } }, TEAM),
    { kind: "faq_send", key: "price", targetMessageId: id, staff: "Туул", callbackId: "cb", buttonMessageId: 30, chat: "team", fromId: 42 }
  );
  const room = parseTeamUpdate(
    { callback_query: { id: "cb", from, data: faqCallbackData("trial", null), message: { message_id: 31, chat: { id: TEAM } } } },
    TEAM
  );
  assert.equal(room.kind === "faq_send" && room.targetMessageId, null);
  assert.equal(
    parseTeamUpdate({ callback_query: { id: "cb", from, data: "faq:price:nope", message: { message_id: 31, chat: { id: TEAM } } } }, TEAM).kind,
    "ignore"
  );
});

test("бэлэн хариулт — товчны өгөгдөл ≤ 64 байт, текст хязгаартаа, үнэ plans.ts-ээс", () => {
  const keys = new Set<string>();
  for (const faq of PUBLIC_CHAT_FAQ) {
    assert.ok(!keys.has(faq.key), `давхар түлхүүр ${faq.key}`);
    keys.add(faq.key);
    assert.match(faq.key, /^[a-z]{1,16}$/);
    assert.ok(Buffer.byteLength(faqCallbackData(faq.key, "0b7a2c1e-1111-4222-8333-444455556666")) <= 64, faq.key);
    assert.ok(faq.body.length <= PUBLIC_CHAT_MAX_BODY, faq.key);
    assert.equal(normalizeBody(faq.body), faq.body, `${faq.key} normalizeBody-оор өөрчлөгдөхгүй`);
  }
  const price = findFaq("price")?.body ?? "";
  assert.ok(price.includes(`${PLANS.standard.pricePerSeatMnt?.toLocaleString("en-US")}₮`));
  assert.ok(price.includes(`${PLANS.platform.pricePerSeatMnt?.toLocaleString("en-US")}₮`));
  assert.equal(findFaq("nope"), null);
});

test("relayText — HTML escape, холбоо барих мэдээлэл, нуусан тэмдэглэгээ", () => {
  const text = relayText({ scope: "private", name: "<b>x</b>", body: "a & b", email: "a@b.mn", phone: "99112233", threadId: "12345678-aaaa", isNewThread: true });
  assert.match(text, /Шинэ хувийн асуулт/);
  assert.match(text, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(text, /a &amp; b/);
  assert.match(text, /99112233 · a@b\.mn/);
  assert.match(relayText({ scope: "room", name: "Бат", body: "x", masked: true }), /автоматаар нуугдсан/);
});
