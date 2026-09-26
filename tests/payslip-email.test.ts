import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPayslipEmailPayload,
  employeeIdOfAuditEntity,
  isValidEmail,
  payslipAuditEntityId,
  payslipEmailBlocker,
  planPayslipRecipients,
} from "../lib/payroll/payslip-email";

describe("payslipEmailBlocker — журнал батлагдсаны дараа л", () => {
  it("журналгүй / ноорог / буцаагдсан → шалтгаан", () => {
    assert.match(payslipEmailBlocker(null)!, /журнал үүсээгүй/);
    assert.match(
      payslipEmailBlocker({ status: "draft", documentNo: "PAY-26-000003" })!,
      /PAY-26-000003 ноорог/
    );
    assert.match(payslipEmailBlocker({ status: "reversed", documentNo: null })!, /буцаагдсан/);
  });
  it("батлагдсан → null", () => {
    assert.equal(payslipEmailBlocker({ status: "posted", documentNo: "PAY-26-000003" }), null);
  });
});

describe("planPayslipRecipients", () => {
  const payslips = [
    { employeeId: "e1", employeeName: "Бат" },
    { employeeId: "e2", employeeName: "Дорж" },
    { employeeId: "e3", employeeName: "Сараа" },
  ];
  const emails = { e1: " bat@example.mn ", e2: null, e3: "буруу" };

  it("бүгд: и-мэйлгүй, буруу хаягийг ИЛ алгасна", () => {
    const plan = planPayslipRecipients({ payslips, emails });
    assert.deepEqual(plan.send, [
      { employeeId: "e1", employeeName: "Бат", email: "bat@example.mn" },
    ]);
    assert.deepEqual(
      plan.skipped.map((row) => [row.employeeId, row.reason]),
      [
        ["e2", "И-мэйл хаяг бүртгэгдээгүй"],
        ["e3", "И-мэйл хаяг буруу: буруу"],
      ]
    );
  });

  it("only: сонгосноос бусдыг хөндөхгүй, хуудасгүй ID-г ил хэлнэ", () => {
    const plan = planPayslipRecipients({ payslips, emails, only: ["e1", "zzz"] });
    assert.equal(plan.send.length, 1);
    assert.deepEqual(plan.skipped, [
      { employeeId: "zzz", employeeName: "—", reason: "Энэ сарын цалингийн хуудас байхгүй" },
    ]);
  });
});

describe("buildPayslipEmailPayload — гарчиг, биед ДҮН БАЙХГҮЙ", () => {
  const payload = buildPayslipEmailPayload({
    companyName: "Тест ХХК",
    periodMonth: "2026-09",
    employeeName: "Бат Дорж",
    to: "bat@example.mn",
    from: "Тест ХХК <noreply@example.mn>",
    replyTo: "hr@example.mn",
    pdf: Buffer.from("%PDF-test"),
  });

  it("гарчиг сар + компани, хавсралт PDF base64", () => {
    assert.equal(payload.subject, "Цалингийн хуудас — 2026 оны 9-р сар — Тест ХХК");
    assert.equal(payload.replyTo, "hr@example.mn");
    assert.equal(payload.attachments[0].filename, "payslip-2026-09.pdf");
    assert.equal(
      Buffer.from(payload.attachments[0].content, "base64").toString(),
      "%PDF-test"
    );
  });

  it("мөнгөн дүн, ₮ тэмдэг гарчиг/биед гарахгүй", () => {
    for (const text of [payload.subject, payload.text]) {
      assert.doesNotMatch(text, /₮|\d{1,3}(,\d{3})+|\d+\.\d{2}\b/);
      // Сар, оноос бусад тоо байхгүй.
      const numbers = text.match(/\d+/g) ?? [];
      assert.ok(numbers.every((n) => n === "2026" || n === "9"), numbers.join(","));
    }
  });
});

describe("аудитын entityId", () => {
  it("сар:ажилтан — зөвхөн тухайн сарынхыг таньна", () => {
    const id = payslipAuditEntityId("2026-09", "e1");
    assert.equal(employeeIdOfAuditEntity("2026-09", id), "e1");
    assert.equal(employeeIdOfAuditEntity("2026-08", id), null);
    assert.equal(employeeIdOfAuditEntity("2026-09", "2026-09:"), null);
  });
  it("isValidEmail", () => {
    assert.ok(isValidEmail("a@b.mn"));
    assert.ok(!isValidEmail("a@b"));
    assert.ok(!isValidEmail(null));
  });
});
