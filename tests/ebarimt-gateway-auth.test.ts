import test from "node:test";
import assert from "node:assert/strict";

import {
  EBARIMT_GATEWAY_DEFAULT_HEADER,
  gatewayAuthConfigured,
  gatewayHeadersFor,
  parseGatewayHosts,
} from "../lib/ebarimt/gateway-auth";

const env = {
  EBARIMT_GATEWAY_KEY: "s3cret",
  EBARIMT_GATEWAY_HOSTS: "ebarimt.chipmo.mn, Proxy.Example.mn",
};

test("allowlist-д байгаа хост руу л header илгээнэ", () => {
  assert.deepEqual(gatewayHeadersFor("https://ebarimt.chipmo.mn/rest/receipt", env), {
    [EBARIMT_GATEWAY_DEFAULT_HEADER]: "s3cret",
  });
  assert.deepEqual(gatewayHeadersFor("https://proxy.example.mn/teg/getInfo?tin=1", env), {
    [EBARIMT_GATEWAY_DEFAULT_HEADER]: "s3cret",
  });
});

test("харилцагчийн дурын хост руу нууц АЛДАГДАХГҮЙ", () => {
  assert.deepEqual(gatewayHeadersFor("https://attacker.example.com/rest/receipt", env), {});
  assert.deepEqual(gatewayHeadersFor("https://ebarimt.chipmo.mn.attacker.com/rest/info", env), {});
  assert.deepEqual(gatewayHeadersFor("http://localhost:7080/rest/info", env), {});
  assert.deepEqual(gatewayHeadersFor("https://api.ebarimt.mn/api/info/check/getInfo", env), {});
});

test("тохиргоо дутуу бол header огт үгүй", () => {
  assert.deepEqual(gatewayHeadersFor("https://ebarimt.chipmo.mn/rest/info", {}), {});
  assert.deepEqual(gatewayHeadersFor("https://ebarimt.chipmo.mn/rest/info", { EBARIMT_GATEWAY_KEY: "k" }), {});
  assert.deepEqual(
    gatewayHeadersFor("https://ebarimt.chipmo.mn/rest/info", { EBARIMT_GATEWAY_HOSTS: "ebarimt.chipmo.mn" }),
    {}
  );
  assert.deepEqual(
    gatewayHeadersFor("https://ebarimt.chipmo.mn/rest/info", { ...env, EBARIMT_GATEWAY_KEY: "   " }),
    {}
  );
  assert.equal(gatewayAuthConfigured({}), false);
  assert.equal(gatewayAuthConfigured(env), true);
});

test("header-ийн нэр тохируулж болно, буруу нэр татгалзана", () => {
  assert.deepEqual(
    gatewayHeadersFor("https://ebarimt.chipmo.mn/rest/info", { ...env, EBARIMT_GATEWAY_HEADER: "X-Posapi-Key" }),
    { "X-Posapi-Key": "s3cret" }
  );
  assert.deepEqual(
    gatewayHeadersFor("https://ebarimt.chipmo.mn/rest/info", { ...env, EBARIMT_GATEWAY_HEADER: "bad header" }),
    {}
  );
});

test("URL уншигдахгүй бол header үгүй; хостын жагсаалт задлах", () => {
  assert.deepEqual(gatewayHeadersFor("not a url", env), {});
  assert.deepEqual(parseGatewayHosts(" a.mn ,B.mn  c.mn,,"), ["a.mn", "b.mn", "c.mn"]);
  assert.deepEqual(parseGatewayHosts(undefined), []);
});
