import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MAX_REPLY,
  AI_REPLIES_GLOBAL_DAILY,
  AI_REPLIES_PER_THREAD_DAILY,
  aiSkipReason,
  buildAiTurns,
  parseAiReply,
} from "../lib/public-chat/assistant-rules";

const NOW = new Date("2026-09-27T12:00:00Z");
const base = { configured: true, lastTeamAt: null, aiRepliesInThread24h: 0, aiRepliesGlobal24h: 0, now: NOW };

test("aiSkipReason — тохиргоо, Entry баг оролцсон, хязгаар", () => {
  assert.equal(aiSkipReason(base), null);
  assert.equal(aiSkipReason({ ...base, configured: false }), "disabled");
  assert.equal(aiSkipReason({ ...base, lastTeamAt: new Date(NOW.getTime() - 3_600_000) }), "team_active");
  assert.equal(aiSkipReason({ ...base, lastTeamAt: new Date(NOW.getTime() - 25 * 3_600_000) }), null);
  assert.equal(aiSkipReason({ ...base, aiRepliesInThread24h: AI_REPLIES_PER_THREAD_DAILY }), "thread_limit");
  assert.equal(aiSkipReason({ ...base, aiRepliesGlobal24h: AI_REPLIES_GLOBAL_DAILY }), "global_limit");
});

test("buildAiTurns — зочин=user, AI/баг=assistant, нэгтгэх, эхэнд user", () => {
  assert.deepEqual(
    buildAiTurns([
      { author: "ai", body: "өмнөх" },
      { author: "visitor", body: "Сайн уу" },
      { author: "visitor", body: "Үнэ хэд вэ?" },
      { author: "ai", body: "29,000₮" },
      { author: "team", body: "Би туслая" },
      { author: "visitor", body: "Баярлалаа" },
    ]),
    [
      { role: "user", content: "Сайн уу\n\nҮнэ хэд вэ?" },
      { role: "assistant", content: "29,000₮\n\n[Entry баг] Би туслая" },
      { role: "user", content: "Баярлалаа" },
    ]
  );
  assert.deepEqual(buildAiTurns([]), []);
});

test("parseAiReply — хэлбэр шалгана, удирдах тэмдэгт, урт тайрна", () => {
  assert.equal(parseAiReply(null), null);
  assert.equal(parseAiReply({ reply: "x" }), null);
  assert.equal(parseAiReply({ reply: "   ", handoff: false }), null);
  assert.deepEqual(parseAiReply({ reply: " Сайн​ уу\r\n\n\n\nтийм ", handoff: true }), { reply: "Сайн уу\n\nтийм", handoff: true });
  const long = parseAiReply({ reply: "а".repeat(AI_MAX_REPLY + 50), handoff: false });
  assert.equal(long?.reply.length, AI_MAX_REPLY);
  assert.ok(long?.reply.endsWith("…"));
});
