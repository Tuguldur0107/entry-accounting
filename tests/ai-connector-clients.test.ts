import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONNECTOR_TARGETS,
  classifyOAuthClient,
  parseRedirectUris,
  relativeTimeMn,
  summarizeAiConnections,
} from "../lib/ai/connector-clients";

test("ангилал: redirect_uri-ийн хост нэрээс түрүүлнэ", () => {
  assert.equal(classifyOAuthClient("MCP клиент", ["https://claude.ai/api/mcp/auth_callback"]), "claude");
  assert.equal(classifyOAuthClient("Claude", ["https://chatgpt.com/connector_platform_oauth_redirect"]), "chatgpt");
  assert.equal(classifyOAuthClient("x", ["https://evilclaude.ai/cb"]), null);
  assert.equal(classifyOAuthClient("ChatGPT", []), "chatgpt");
  assert.equal(classifyOAuthClient("Claude Code", ["http://localhost:3333/callback"]), "claude");
  assert.equal(classifyOAuthClient("Cursor", ["http://localhost:1/cb"]), null);
});

test("redirect_uris JSON гажиг бол хоосон", () => {
  assert.deepEqual(parseRedirectUris('["https://a.b/c", 1]'), ["https://a.b/c"]);
  assert.deepEqual(parseRedirectUris("not json"), []);
  assert.deepEqual(parseRedirectUris(null), []);
});

test("нэгтгэл: клиент бүрд анх холбогдсон + сүүлд ашигласан, танигдахгүйг хаяна", () => {
  const views = summarizeAiConnections([
    { clientName: "ChatGPT", redirectUris: null, createdAt: "2026-09-20T00:00:00Z", lastUsedAt: null },
    { clientName: "ChatGPT", redirectUris: null, createdAt: "2026-09-22T00:00:00Z", lastUsedAt: "2026-09-26T10:00:00Z" },
    { clientName: "claude", redirectUris: null, createdAt: "2026-09-21T00:00:00Z", lastUsedAt: null },
    { clientName: "Cursor", redirectUris: null, createdAt: "2026-09-21T00:00:00Z", lastUsedAt: "2026-09-27T00:00:00Z" },
  ]);
  assert.deepEqual(views, [
    { client: "claude", label: "Claude", connectedAt: "2026-09-21T00:00:00Z", lastUsedAt: null },
    { client: "chatgpt", label: "ChatGPT", connectedAt: "2026-09-20T00:00:00Z", lastUsedAt: "2026-09-26T10:00:00Z" },
  ]);
  assert.deepEqual(summarizeAiConnections([]), []);
});

test("харьцангуй хугацаа", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  assert.equal(relativeTimeMn(null, now), null);
  assert.equal(relativeTimeMn("2026-09-27T11:59:40Z", now), "дөнгөж сая");
  assert.equal(relativeTimeMn("2026-09-27T11:15:00Z", now), "45 минутын өмнө");
  assert.equal(relativeTimeMn("2026-09-27T09:00:00Z", now), "3 цагийн өмнө");
  assert.equal(relativeTimeMn("2026-09-25T12:00:00Z", now), "2 хоногийн өмнө");
  assert.equal(relativeTimeMn("garbage", now), null);
});

test("тохиргооны хаяг https", () => {
  for (const target of Object.values(CONNECTOR_TARGETS)) {
    assert.match(target.settingsUrl, /^https:\/\//);
    assert.match(target.requirement, /төлбөртэй/, `${target.label}: төлбөртэй хувилбарын шаардлага харагдана`);
  }
  assert.match(CONNECTOR_TARGETS.chatgpt.requirement, /Developer mode/);
});

test("«Хаягийг хуулаад … нээх» товч MCP хаягийг хуулна (useCopyFlash: key, text)", () => {
  // 2026-09-30: аргументын дараалал урвуу байсан тул clipboard-д хаягийн оронд
  // «open:claude» ордог байв.
  const source = readFileSync("components/skills/connect-guide.tsx", "utf8");
  assert.match(source, /copy\(`open:\$\{client\}`, mcpUrl\)/);
  assert.doesNotMatch(source, /copy\(mcpUrl,/);
});
