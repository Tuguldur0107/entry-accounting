import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { parsePosApiBody, posApiSendData } from "../lib/ebarimt/client";

const URL = "https://ebarimt.example.mn/rest/info";

test("PosAPI-ийн JSON хариуг уншина, хоосон бол {}", () => {
  assert.deepEqual(parsePosApiBody(200, '{"operatorName":"X"}', URL), { operatorName: "X" });
  assert.deepEqual(parsePosApiBody(200, "  ", URL), {});
  // PosAPI-ийн JSON алдаа (4xx) — дуудагч өөрөө шийднэ, шидэхгүй
  assert.deepEqual(parsePosApiBody(400, '{"status":"ERROR","message":"bad"}', URL), { status: "ERROR", message: "bad" });
});

test("Cloudflare WAF-ын 403 HTML — амжилт биш, шалтгааныг нэрлэж шидэнэ", () => {
  assert.throws(
    () => parsePosApiBody(403, '<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie">', URL),
    (error: Error) => error.message.includes("[EBARIMT_POSAPI]") && error.message.includes("EBARIMT_GATEWAY_KEY")
  );
});

test("200 боловч HTML (вэб консол / буруу URL) — шидэнэ", () => {
  assert.throws(
    () => parsePosApiBody(200, "<!doctype html><title>PosAPI 3.0</title>", URL),
    (error: Error) => error.message.includes("HTTP 200") && error.message.includes("URL")
  );
});

/** Хуурамч PosAPI — `paths`-д байгаа замд л JSON хариулна, бусад нь 404 HTML. */
async function withFakePosApi(paths: string[], run: (base: string, hits: string[]) => Promise<void>) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    if (paths.includes(req.url ?? "")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ lastSentDate: "2026-10-01 23:30:00" }));
      return;
    }
    res.statusCode = 404;
    res.end("<html>Not Found</html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("sendData: портал `/rest/sendData`-г таньдаг PosAPI — нэг л дуудлага", async () => {
  await withFakePosApi(["/rest/sendData"], async (base, hits) => {
    assert.deepEqual(await posApiSendData(base), { lastSentDate: "2026-10-01 23:30:00" });
    assert.deepEqual(hits, ["/rest/sendData"]);
  });
});

test("sendData: 404 бол PDF 3.0.1 §8-ийн `/rest/send` руу шилжинэ", async () => {
  await withFakePosApi(["/rest/send"], async (base, hits) => {
    assert.deepEqual(await posApiSendData(`${base}/`), { lastSentDate: "2026-10-01 23:30:00" });
    assert.deepEqual(hits, ["/rest/sendData", "/rest/send"]);
  });
});

test("sendData: хоёр зам хоёулаа 404 — ойлгомжтой [EBARIMT_POSAPI] алдаа", async () => {
  await withFakePosApi([], async (base) => {
    await assert.rejects(
      () => posApiSendData(base),
      (error: Error) => error.message.includes("[EBARIMT_POSAPI]") && error.message.includes("/rest/send") && error.message.includes("404")
    );
  });
});
