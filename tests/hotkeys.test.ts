import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PAGE_OWNED_HOTKEYS, pageOwnsHotkey } from "../lib/ui/hotkeys";

// Хуудас эзэмшдэг товчлол глобал товчлолтой зөрчилдөхгүй (кассын F2 / «/»).

const ROOT = path.join(import.meta.dirname, "..");

test("кассын дэлгэц F2 ба «/»-г эзэмшдэг — дэд замд ч", () => {
  assert.equal(pageOwnsHotkey("/inventory/pos", "F2"), true);
  assert.equal(pageOwnsHotkey("/inventory/pos", "/"), true);
  assert.equal(pageOwnsHotkey("/inventory/pos/anything", "F2"), true);
});

test("бусад хуудас эзэмшихгүй — угтвар ижил ч өөр зам", () => {
  assert.equal(pageOwnsHotkey("/inventory/pos-settings", "F2"), false);
  assert.equal(pageOwnsHotkey("/inventory/sales", "F2"), false);
  assert.equal(pageOwnsHotkey("/gl/journal", "/"), false);
  assert.equal(pageOwnsHotkey(null, "F2"), false);
  assert.equal(pageOwnsHotkey("/inventory/pos", "F10"), false);
});

test("глобал сонсогчид бүртгэлийг шалгадаг", () => {
  const quickCreate = readFileSync(path.join(ROOT, "components/layout/quick-create.tsx"), "utf8");
  const quickNav = readFileSync(path.join(ROOT, "components/layout/quick-nav.tsx"), "utf8");
  assert.match(quickCreate, /pageOwnsHotkey\(pathname, "F2"\)/);
  assert.match(quickNav, /pageOwnsHotkey\(usePathname\(\), "\/"\)/);
});

test("бүртгэлд байгаа товчлол бүрийг кассын дэлгэц үнэхээр сонсдог", () => {
  const pos = PAGE_OWNED_HOTKEYS.find((entry) => entry.path === "/inventory/pos");
  assert.ok(pos);
  const source = readFileSync(path.join(ROOT, "components/pos/pos-checkout-view.tsx"), "utf8");
  for (const key of pos.keys)
    assert.ok(source.includes(`event.key === "${key}"`), `pos-checkout-view ${key}-г сонсохгүй байна`);
});
