import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PAGE_OWNED_HOTKEYS, allowsGlobalHotkey, pageOwnsHotkey } from "../lib/ui/hotkeys";

// Хуудас эзэмшдэг товчлол глобал товчлолтой зөрчилдөхгүй:
// F2 = «+ Шинэ» хаа сайгүй, кассын бараа хайлт F3 / «/».

const ROOT = path.join(import.meta.dirname, "..");

test("F2 = глобал «+ Шинэ» — ямар ч хуудас, касс ч эзэмшихгүй", () => {
  for (const entry of PAGE_OWNED_HOTKEYS)
    assert.ok(!entry.keys.includes("F2"), `${entry.path} F2-г эзэмшиж болохгүй`);
  assert.equal(pageOwnsHotkey("/inventory/pos", "F2"), false);
});

test("кассын дэлгэц F3 ба «/»-г эзэмшдэг — дэд замд ч", () => {
  assert.equal(pageOwnsHotkey("/inventory/pos", "F3"), true);
  assert.equal(pageOwnsHotkey("/inventory/pos", "/"), true);
  assert.equal(pageOwnsHotkey("/inventory/pos/anything", "/"), true);
});

test("бусад хуудас эзэмшихгүй — угтвар ижил ч өөр зам", () => {
  assert.equal(pageOwnsHotkey("/inventory/pos-settings", "/"), false);
  assert.equal(pageOwnsHotkey("/inventory/sales", "F3"), false);
  assert.equal(pageOwnsHotkey("/gl/journal", "/"), false);
  assert.equal(pageOwnsHotkey(null, "/"), false);
  assert.equal(pageOwnsHotkey("/inventory/pos", "F10"), false);
});

test("allowsGlobalHotkey — data-global-hotkeys-ийн жагсаалтаар", () => {
  const withKeys = (value: string | null) => ({
    closest: () => (value == null ? null : { getAttribute: () => value }),
  });
  assert.equal(allowsGlobalHotkey(withKeys("F2") as unknown as EventTarget, "F2"), true);
  assert.equal(allowsGlobalHotkey(withKeys("F2 F7") as unknown as EventTarget, "F7"), true);
  assert.equal(allowsGlobalHotkey(withKeys("F2") as unknown as EventTarget, "/"), false);
  assert.equal(allowsGlobalHotkey(withKeys(null) as unknown as EventTarget, "F2"), false);
  assert.equal(allowsGlobalHotkey(null, "F2"), false);
});

test("глобал сонсогчид бүртгэлийг шалгадаг; кассын хайлт F2-г нэвтрүүлдэг", () => {
  const quickCreate = readFileSync(path.join(ROOT, "components/layout/quick-create.tsx"), "utf8");
  const quickNav = readFileSync(path.join(ROOT, "components/layout/quick-nav.tsx"), "utf8");
  const productPanel = readFileSync(path.join(ROOT, "components/pos/checkout/product-panel.tsx"), "utf8");
  assert.match(quickCreate, /pageOwnsHotkey\(pathname, "F2"\)/);
  // F2 нээх ба цэсний 1–9 сонголт хоёулаа кассын хайлтаас ажиллана.
  assert.equal(quickCreate.match(/allowsGlobalHotkey\(target, "F2"\)/g)?.length, 2);
  assert.match(quickNav, /pageOwnsHotkey\(usePathname\(\), "\/"\)/);
  assert.match(productPanel, /data-global-hotkeys="F2"/);
});

test("бүртгэлд байгаа товчлол бүрийг кассын дэлгэц сонсдог, F2-г сонсдоггүй", () => {
  const pos = PAGE_OWNED_HOTKEYS.find((entry) => entry.path === "/inventory/pos");
  assert.ok(pos);
  const source = readFileSync(path.join(ROOT, "components/pos/pos-checkout-view.tsx"), "utf8");
  for (const key of pos.keys)
    assert.ok(source.includes(`event.key === "${key}"`), `pos-checkout-view ${key}-г сонсохгүй байна`);
  assert.ok(!source.includes('event.key === "F2"'), "касс F2-г сонсож болохгүй — глобал «+ Шинэ»");
});
