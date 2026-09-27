// Landing-ийн чат — integration тест (DATABASE_URL шаарддаг). Зочин → нийтийн
// өрөө / хувийн яриа → багийн хариу (Telegram Reply-ийн зам) → нуух, хаах →
// Console-ийн жагсаалт. Төгсгөлд өөрийн үүсгэсэн мөрийг устгана.

import "./helpers/load-env";

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { eq, inArray } from "drizzle-orm";

import { db } from "../lib/db";
import { publicChatMessages, publicChatVisitors } from "../lib/db/schema";
import { requestAiReply } from "../lib/public-chat/assistant";
import { PublicChatInputError, prepareRoomMessage, prepareThreadStart, telegramRef } from "../lib/public-chat/rules";
import {
  createVisitor,
  findMessageByTelegramId,
  findVisitor,
  getThreadForConsole,
  ipRecentlyBlocked,
  listRoom,
  listThreadMessages,
  listThreadsForConsole,
  postPrivateMessage,
  postRoomMessage,
  postTeamMessage,
  postTeamReply,
  setMessageHidden,
  setTelegramMessageId,
  setVisitorBlocked,
} from "../lib/public-chat/store";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const visitorIds: string[] = [];
const roomMessageIds: string[] = [];
// Telegram message_id — бусад тесттэй давхцахгүй том тоо
const TG = 900_000_000 + Math.floor(Math.random() * 1_000_000);

test("нийтийн өрөө — зочин бичнэ, давхардал татгалзана, mine, багийн Reply", { skip: !DB_READY }, async () => {
  const { token, visitor } = await createVisitor(`iphash-${STAMP}`);
  visitorIds.push(visitor.id);
  assert.equal((await findVisitor(token))?.id, visitor.id);

  const body = `Сайн уу ${STAMP}, утас 99112233`;
  const row = await postRoomMessage(visitor, prepareRoomMessage({ name: "Бат", body }), null);
  roomMessageIds.push(row.id);
  assert.equal(row.masked, true);
  assert.ok(!row.body.includes("99112233"));
  await assert.rejects(
    postRoomMessage(visitor, prepareRoomMessage({ name: "Бат", body }), null),
    PublicChatInputError
  );

  const page = await listRoom({ after: null, visitorId: visitor.id });
  const mine = page.messages.find((m) => m.id === row.id);
  assert.equal(mine?.mine, true);
  assert.equal(mine?.name, "Бат");

  // Relay → Reply (Telegram-ийн зам): багийн хариу өрөөнд, анхны мессежийг иш татна
  await setTelegramMessageId(row.id, TG);
  const reply = await postTeamReply(TG, "Сайн байна уу, Entry баг байна", "Туул", TG + 1);
  assert.ok(reply);
  roomMessageIds.push(reply.id);
  assert.equal(reply.scope, "room");
  assert.equal(reply.replyToId, row.id);
  // Багийн хариу дээр дахин Reply — мөн анхны зочны мессежийг иш татна
  const again = await postTeamReply(TG + 1, "Нэмэлт", "Туул");
  assert.ok(again);
  roomMessageIds.push(again.id);
  assert.equal(again.replyToId, row.id);
  const dto = (await listRoom({ after: null, visitorId: null })).messages.find((m) => m.id === reply.id);
  assert.equal(dto?.name, "Entry баг");
  assert.equal(dto?.mine, false);
  assert.equal(await postTeamReply(TG + 999, "x", "Туул"), null, "танихгүй relay → null");
});

test("нуух → polling-д hiddenIds; зочныг хаах → бичих эрхгүй, мессеж нь нуугдана", { skip: !DB_READY }, async () => {
  const [visitorId] = visitorIds;
  const visitor = (await db.select().from(publicChatVisitors).where(eq(publicChatVisitors.id, visitorId)))[0];
  const since = new Date(Date.now() - 1000);
  const second = await postRoomMessage(visitor, prepareRoomMessage({ body: `Хоёр дахь ${STAMP}` }), null);
  roomMessageIds.push(second.id);

  await setMessageHidden(second.id, true, "Туул");
  const page = await listRoom({ after: since, visitorId: null });
  assert.ok(page.hiddenIds.includes(second.id));
  assert.ok(!page.messages.some((m) => m.id === second.id));
  await setMessageHidden(second.id, false, "Туул");

  assert.equal(await ipRecentlyBlocked(`iphash-${STAMP}`), false);
  assert.equal(await setVisitorBlocked(visitorId, true, "Туул"), true);
  assert.equal(await ipRecentlyBlocked(`iphash-${STAMP}`), true, "ижил IP-гээс шинэ сесс олгохгүй");
  const blocked = (await db.select().from(publicChatVisitors).where(eq(publicChatVisitors.id, visitorId)))[0];
  await assert.rejects(
    postRoomMessage(blocked, prepareRoomMessage({ body: `Гурав ${STAMP}` }), null),
    /хаасан/
  );
  const visible = (await listRoom({ after: null, visitorId: null })).messages.map((m) => m.id);
  assert.ok(!visible.includes(second.id), "хаагдсан зочны нийтийн мессеж нуугдана");
  // Багийн мессеж хөндөгдөхгүй
  assert.ok(visible.includes(roomMessageIds[1]));
});

test("хувийн яриа — зочин бүрд нэг, багийн хариу, Console-ийн жагсаалт", { skip: !DB_READY }, async () => {
  const { visitor } = await createVisitor(null);
  visitorIds.push(visitor.id);
  const first = await postPrivateMessage(
    visitor,
    prepareThreadStart({ name: "Сараа", email: `chat-${STAMP}@test.local`, body: "Үнэ хэд вэ? https://my.mn" }),
    null
  );
  assert.equal(first.isNewThread, true);
  const second = await postPrivateMessage(visitor, prepareThreadStart({ body: "Бас демо үзмээр байна" }), null);
  assert.equal(second.isNewThread, false);
  assert.equal(second.thread.id, first.thread.id);
  assert.equal(second.thread.email, `chat-${STAMP}@test.local`, "хоосон и-мэйл өмнөхийг арилгахгүй");

  let [summary] = await listThreadsForConsole({ limit: 1, threadId: first.thread.id });
  assert.equal(summary.awaitingReply, true);
  assert.equal(summary.messageCount, 2);

  // Нээлттэй групп горим: хувийн relay тусдаа chat-д — түлхүүр нь `p:` угтвартай,
  // группын ижил дугаартай мессежтэй давхцахгүй
  await setTelegramMessageId(second.message.id, telegramRef("private", TG + 10));
  assert.equal(await findMessageByTelegramId(TG + 10), null, "группын ижил message_id → өөр мессеж");
  const reply = await postTeamReply(telegramRef("private", TG + 10), "Сайн байна уу! Үнэ 1 суудал …", "Туул", telegramRef("private", TG + 11));
  assert.equal(reply?.scope, "private");
  assert.equal(reply?.threadId, first.thread.id);

  [summary] = await listThreadsForConsole({ limit: 1, threadId: first.thread.id });
  assert.equal(summary.awaitingReply, false);
  const detail = await getThreadForConsole(first.thread.id);
  assert.equal(detail?.messages.at(-1)?.staffName, "Туул");

  const visitorView = await listThreadMessages({ threadId: first.thread.id, after: null, visitorId: visitor.id });
  assert.deepEqual(
    visitorView.map((m) => [m.author, m.mine]),
    [
      ["visitor", true],
      ["visitor", true],
      ["team", false],
    ]
  );
  assert.equal(visitorView[2].name, "Entry баг");
  assert.ok(!("staffName" in visitorView[2]), "ажилтны нэр зочинд очихгүй");

  // Console-оос шууд
  const fromConsole = await postTeamMessage({ scope: "private", threadId: first.thread.id }, "Демо линк И-мэйлээр явууллаа", "Entry Console · op");
  assert.equal(fromConsole.author, "team");
});

test("AI туслах — landing руу дамжуулж хадгална; давхар, хуучирсан, баг оролцсон үед үгүй", { skip: !DB_READY }, async () => {
  const received: unknown[] = [];
  let reply = { reply: "Entry бол AI нягтлан бодох систем.", handoff: false };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      assert.equal(req.headers.authorization, "Bearer test-ai-secret");
      received.push(JSON.parse(raw));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.PUBLIC_CHAT_AI_URL = `http://127.0.0.1:${port}/api/chat-assistant`;
  process.env.PUBLIC_CHAT_AI_SECRET = "test-ai-secret";
  try {
    const { visitor } = await createVisitor(null);
    visitorIds.push(visitor.id);
    const first = await postPrivateMessage(visitor, prepareThreadStart({ name: "AI", body: `Entry гэж юу вэ? ${STAMP}` }), null);
    await requestAiReply(first.thread.id, first.message.id);
    let view = await listThreadMessages({ threadId: first.thread.id, after: null, visitorId: visitor.id });
    assert.deepEqual(view.map((m) => [m.author, m.name]), [["visitor", "AI"], ["ai", "AI туслах"]]);
    assert.deepEqual((received[0] as { messages: unknown }).messages, [{ role: "user", content: `Entry гэж юу вэ? ${STAMP}` }]);

    // Ижил мессежид дахин дуудвал (after давтагдсан) — хоёр дахь хариу үгүй
    await requestAiReply(first.thread.id, first.message.id);
    view = await listThreadMessages({ threadId: first.thread.id, after: null, visitorId: visitor.id });
    assert.equal(view.filter((m) => m.author === "ai").length, 1);

    // Хуучирсан: зочин шинэ мессеж бичсэн бол өмнөх мессежийн хариу хадгалагдахгүй
    const second = await postPrivateMessage(visitor, prepareThreadStart({ body: "Үнэ хэд вэ?" }), null);
    await postPrivateMessage(visitor, prepareThreadStart({ body: "Бас демо?" }), null);
    const before = received.length;
    await requestAiReply(first.thread.id, second.message.id);
    assert.equal(received.length, before, "хуучирсан мессежид landing дуудахгүй");

    // Entry баг оролцсон бол AI зогсоно
    await postTeamMessage({ scope: "private", threadId: first.thread.id }, "Би хариулъя", "Туул");
    const third = await postPrivateMessage(visitor, prepareThreadStart({ body: "За баярлалаа" }), null);
    await requestAiReply(first.thread.id, third.message.id);
    assert.equal(received.length, before, "баг оролцсон ярианд AI хариулахгүй");

    // landing буруу хэлбэр буцаавал хадгалахгүй
    const { visitor: other } = await createVisitor(null);
    visitorIds.push(other.id);
    const lone = await postPrivateMessage(other, prepareThreadStart({ body: `Асуулт ${STAMP}` }), null);
    reply = { reply: "", handoff: false };
    await requestAiReply(lone.thread.id, lone.message.id);
    view = await listThreadMessages({ threadId: lone.thread.id, after: null, visitorId: other.id });
    assert.equal(view.length, 1);
  } finally {
    delete process.env.PUBLIC_CHAT_AI_URL;
    delete process.env.PUBLIC_CHAT_AI_SECRET;
    server.close();
  }
});

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  if (roomMessageIds.length) await db.delete(publicChatMessages).where(inArray(publicChatMessages.id, roomMessageIds));
  if (visitorIds.length) await db.delete(publicChatVisitors).where(inArray(publicChatVisitors.id, visitorIds));
});
