// АР/АП баримтын төрлийн цэвэр дүрэм (lib/arap/document-kind.ts).
import assert from "node:assert/strict";
import test from "node:test";

import { documentPosting } from "../lib/arap/document-kind";

test("documentPosting — буцаалтын баримт эх нэхэмжлэхийн талд, сөрөг (улаан сторно)", () => {
  assert.deepEqual(documentPosting("ar_invoice"), { controlDebit: true, sign: 1 });
  assert.deepEqual(documentPosting("ap_bill"), { controlDebit: false, sign: 1 });
  // Кредит нэхэмжлэл: Дт Авлага −X (Кт биш), дебит нэхэмжлэх: Кт Өглөг −X.
  assert.deepEqual(documentPosting("ar_credit_note"), { controlDebit: true, sign: -1 });
  assert.deepEqual(documentPosting("ap_debit_note"), { controlDebit: false, sign: -1 });
});
