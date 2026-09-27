import test from "node:test";
import assert from "node:assert/strict";

import { parsePosApiBody } from "../lib/ebarimt/client";

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
