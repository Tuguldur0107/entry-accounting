// Landing-ийн чат — integration тест (DATABASE_URL шаарддаг). Зочин → нийтийн
// өрөө / хувийн яриа → багийн хариу (Telegram Reply-ийн зам) → нуух, хаах →
// Console-ийн жагсаалт. Төгсгөлд өөрийн үүсгэсэн мөрийг устгана.

import "./helpers/load-env";

import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";

import { db } from "../lib/db";
import { publicChatMessages, publicChatVisitors } from "../lib/db/schema";
import { PublicChatInputError, prepareRoomMessage, prepareThreadStart } from "../lib/public-chat/rules";
import {
  createVisitor,
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

  await setTelegramMessageId(second.message.id, TG + 10);
  const reply = await postTeamReply(TG + 10, "Сайн байна уу! Үнэ 1 суудал …", "Туул");
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

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  if (roomMessageIds.length) await db.delete(publicChatMessages).where(inArray(publicChatMessages.id, roomMessageIds));
  if (visitorIds.length) await db.delete(publicChatVisitors).where(inArray(publicChatVisitors.id, visitorIds));
});
