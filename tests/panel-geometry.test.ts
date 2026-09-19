// Хөвөгч панелийн геометр — анхны байрлал, чирэлт, хэмжээ солилт, хил.

import assert from "node:assert/strict";
import test from "node:test";

import {
  PANEL_KEEP_VISIBLE,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  PANEL_TOP_MIN,
  clampPanelRect,
  defaultPanelRect,
  movePanelRect,
  resizePanelRect,
} from "../lib/ui/panel-geometry";

const VIEW = { width: 1600, height: 900 };

test("анхны байрлал нь хуучин CSS-тэй ИЖИЛ (slot-оор шатална)", () => {
  const first = defaultPanelRect(0, VIEW);
  assert.equal(first.width, 1180);
  assert.equal(first.y, 72);
  assert.equal(first.x, 1600 - 24 - 1180);
  assert.equal(first.height, 900 - 72 - 72);

  const second = defaultPanelRect(1, VIEW);
  assert.equal(second.y, 94); // 72 + 22
  assert.equal(second.x, first.x - 22);
});

test("нарийн дэлгэцэд өргөн нь дэлгэцэд багтана", () => {
  const rect = defaultPanelRect(0, { width: 800, height: 700 });
  assert.equal(rect.width, 800 - 48);
  assert.equal(rect.x, 24);
});

test("чирэхэд панель дэлгэцээс БҮРЭН гарахгүй", () => {
  const rect = defaultPanelRect(0, VIEW);
  const farLeft = movePanelRect(rect, -9000, 0, VIEW);
  assert.equal(farLeft.x, PANEL_KEEP_VISIBLE - rect.width);
  const farRight = movePanelRect(rect, 9000, 0, VIEW);
  assert.equal(farRight.x, VIEW.width - PANEL_KEEP_VISIBLE);
});

test("дээш чирэхэд topbar-ын доогуур орохгүй", () => {
  const rect = defaultPanelRect(0, VIEW);
  assert.equal(movePanelRect(rect, 0, -9000, VIEW).y, PANEL_TOP_MIN);
  assert.equal(movePanelRect(rect, 0, 9000, VIEW).y, VIEW.height - 40);
});

test("баруун/доод ирмэг — зөвхөн хэмжээ өөрчлөгдөнө", () => {
  const rect = { x: 200, y: 100, width: 800, height: 500 };
  const wider = resizePanelRect(rect, "se", 120, 60, VIEW);
  assert.equal(wider.x, 200);
  assert.equal(wider.y, 100);
  assert.equal(wider.width, 920);
  assert.equal(wider.height, 560);
});

test("зүүн/дээд ирмэг — эсрэг тал БАЙРАНДАА үлдэнэ", () => {
  const rect = { x: 200, y: 100, width: 800, height: 500 };
  const out = resizePanelRect(rect, "nw", -100, -50, VIEW);
  assert.equal(out.x, 100);
  assert.equal(out.y, 50 < PANEL_TOP_MIN ? PANEL_TOP_MIN : 50);
  assert.equal(out.x + out.width, 1000); // баруун ирмэг хөдөлсөнгүй
});

test("хамгийн бага хэмжээнээс доош шахагдахгүй", () => {
  const rect = { x: 200, y: 100, width: 800, height: 500 };
  const tiny = resizePanelRect(rect, "se", -9000, -9000, VIEW);
  assert.equal(tiny.width, PANEL_MIN_WIDTH);
  assert.equal(tiny.height, PANEL_MIN_HEIGHT);

  // Зүүн ирмэгээс шахахад баруун ирмэг хөдөлгөөнгүй хэвээр
  const fromLeft = resizePanelRect(rect, "w", 9000, 0, VIEW);
  assert.equal(fromLeft.width, PANEL_MIN_WIDTH);
  assert.equal(fromLeft.x + fromLeft.width, 1000);
});

test("clamp — дэлгэц жижгэрэхэд панель дотогш эргэж орно", () => {
  const rect = { x: 1400, y: 800, width: 1180, height: 700 };
  const small = { width: 900, height: 600 };
  const out = clampPanelRect(rect, small);
  assert.ok(out.x <= small.width - PANEL_KEEP_VISIBLE);
  assert.ok(out.y <= small.height - 40);
  assert.ok(out.width <= small.width);
  assert.ok(out.height <= small.height - PANEL_TOP_MIN);
});
