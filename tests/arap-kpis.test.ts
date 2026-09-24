import test from "node:test";
import assert from "node:assert/strict";

import { arapKpis } from "../lib/arap/kpis";

test("ENT-017: АП KPI ноорог нэхэмжлэхийг тоолохгүй", () => {
  const kpi = arapKpis(
    [
      { documentType: "ap_bill", status: "draft", dueDate: "2025-01-10", date: "2024-12-31", baseBalance: 80_196_400 },
      { documentType: "ap_bill", status: "posted", dueDate: "2025-01-10", date: "2024-12-31", baseBalance: 20_000_000 },
      { documentType: "ap_bill", status: "partially_paid", dueDate: "2026-01-10", date: "2025-12-01", baseBalance: 1_500_000 },
      { documentType: "ap_bill", status: "paid", dueDate: "2025-01-10", date: "2024-12-31", baseBalance: 0 },
      { documentType: "ap_bill", status: "reversed", dueDate: "2025-01-10", date: "2024-12-31", baseBalance: 5_000 },
    ],
    "2025-06-30"
  );
  assert.deepEqual(kpi, {
    arBalance: 0,
    apBalance: 21_500_000,
    openBalance: 21_500_000,
    overdueBalance: 20_000_000,
    overdueCount: 1,
    draftCount: 1,
    draftAmount: 80_196_400,
  });
});
