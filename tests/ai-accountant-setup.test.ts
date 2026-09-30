// «AI нягтлан» — /settings/ai ба skills нүүрний төслийн заавар + төлөв
// (lib/ai/accountant-setup.ts, ЦЭВЭР):
//   • заавар аль ч сонголтод ChatGPT-ийн Custom instructions-ийн 1500 тэмдэгтэд багтана
//   • нягтлан бодох багцад tool + бичилтийн горим; skills багцад бүртгэлгүй
//   • мэдлэгийн сан нягтлан бодох багцад «үнэгүй багтсан»; Console-оор унтарсан,
//     read-only, квот хүрсэн төлөв ИЛ
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACCOUNTANT_INSTRUCTIONS_MAX_CHARS,
  aiAccountantStatus,
  buildAccountantInstructions,
  DEFAULT_ACCOUNTANT_SETUP,
  parseAccountantSetup,
  type AccountantSetup,
} from "../lib/ai/accountant-setup";
import { resolveEntitlements, type SubscriptionRecord } from "../lib/billing/entitlements";
import { KNOWLEDGE_DAILY_READ_LIMIT } from "../lib/knowledge/catalog";

const NOW = new Date("2026-09-30T08:00:00Z");
const DAY = 24 * 60 * 60_000;

function sub(patch: Partial<SubscriptionRecord>): SubscriptionRecord {
  return { planId: "standard", status: "active", seats: null, trialEndsAt: null, currentPeriodEnd: null, overrides: null, ...patch };
}
const saas = (subscription: SubscriptionRecord | null) =>
  resolveEntitlements({ mode: "saas", subscription, orgCreatedAt: new Date(NOW.getTime() - 60 * DAY), now: NOW });

const SETUPS: AccountantSetup[] = [
  { audience: "accountant", detail: "brief" },
  { audience: "accountant", detail: "detailed" },
  { audience: "owner", detail: "brief" },
  { audience: "owner", detail: "detailed" },
];

test("заавар: бүх сонголтод 1500 тэмдэгтэд багтана (урт нэртэй ч)", () => {
  const longName = "Маш урт нэртэй хязгаарлагдмал хариуцлагатай компани ".repeat(6);
  for (const accounting of [true, false]) {
    for (const writeMode of ["draft", "post"] as const) {
      for (const setup of SETUPS) {
        const text = buildAccountantInstructions({ orgName: longName, accounting, writeMode, setup });
        assert.ok(
          text.length <= ACCOUNTANT_INSTRUCTIONS_MAX_CHARS,
          `${accounting}/${writeMode}/${setup.audience}/${setup.detail}: ${text.length}`
        );
      }
    }
  }
});

test("заавар: нягтлан бодох багц — компанийн нэр, мэдлэгийн tool, бичилтийн горим", () => {
  const draft = buildAccountantInstructions({
    orgName: "  Смарт  «ГПС» ХХК ",
    accounting: true,
    writeMode: "draft",
    setup: DEFAULT_ACCOUNTANT_SETUP,
  });
  assert.match(draft, /«Смарт ГПС ХХК»-ийн AI нягтлан/);
  assert.match(draft, /list_knowledge_topics → read_knowledge_section/);
  assert.match(draft, /тоо зохиохгүй/);
  assert.match(draft, /ноорог болж орно/);
  assert.doesNotMatch(draft, /Шууд бичих горим/);

  const post = buildAccountantInstructions({ orgName: null, accounting: true, writeMode: "post", setup: DEFAULT_ACCOUNTANT_SETUP });
  assert.match(post, /манай компанийн AI нягтлан/);
  assert.match(post, /Шууд бичих горим асаалттай ч батлах хязгаараас дээш, хаалт, цалин ноорог үлдэнэ/);
});

test("заавар: skills багц — бүртгэл хийхгүй, компанийн өгөгдлийн tool дурдахгүй", () => {
  const text = buildAccountantInstructions({ orgName: "X ХХК", accounting: false, writeMode: "post", setup: DEFAULT_ACCOUNTANT_SETUP });
  assert.match(text, /бүртгэл хийхгүй/);
  assert.match(text, /read_knowledge_section/);
  assert.doesNotMatch(text, /X ХХК/);
  assert.doesNotMatch(text, /Дт\/Кт, дүн, огноог/);
  assert.doesNotMatch(text, /Шууд бичих/);
});

test("заавар: сонголт хариултын хэлбэрт тусна", () => {
  const owner = buildAccountantInstructions({
    orgName: null,
    accounting: true,
    writeMode: "draft",
    setup: { audience: "owner", detail: "detailed" },
  });
  assert.match(owner, /Нягтлан биш хүнд ойлгомжтойгоор/);
  assert.match(owner, /журналын бичилт \(Дт\/Кт\)/);
  const accountant = buildAccountantInstructions({ orgName: null, accounting: true, writeMode: "draft", setup: DEFAULT_ACCOUNTANT_SETUP });
  assert.match(accountant, /мэргэжлийн нэр томьёогоор/);
  assert.match(accountant, /Хариулт: Товч — гол дүгнэлт эхэнд/);
});

test("хадгалсан сонголт: гажиг, хоосон, хуучин утга → анхдагч", () => {
  assert.deepEqual(parseAccountantSetup(null), DEFAULT_ACCOUNTANT_SETUP);
  assert.deepEqual(parseAccountantSetup("not json"), DEFAULT_ACCOUNTANT_SETUP);
  assert.deepEqual(parseAccountantSetup("[1]"), DEFAULT_ACCOUNTANT_SETUP);
  assert.deepEqual(parseAccountantSetup('{"audience":"owner","detail":"huge"}'), { audience: "owner", detail: "brief" });
  assert.deepEqual(parseAccountantSetup('{"audience":"owner","detail":"detailed"}'), { audience: "owner", detail: "detailed" });
});

test("төлөв: нягтлан бодох багцад үнэгүй багтсан", () => {
  const status = aiAccountantStatus({ ent: saas(sub({})), readsToday: 12, dailyLimit: KNOWLEDGE_DAILY_READ_LIMIT, sections: 372 });
  assert.equal(status.included, true);
  assert.equal(status.usable, true);
  assert.equal(status.tone, "success");
  assert.equal(status.badge, "Үнэгүй · багцад багтсан");
  assert.match(status.message, /үнэгүй багтсан/);
});

test("төлөв: Console-оор унтарсан бол идэвхгүй — өөрөө асаах зам санал болгохгүй", () => {
  const status = aiAccountantStatus({
    ent: saas(sub({ overrides: { features: { knowledge: false } } })),
    readsToday: 0,
    dailyLimit: KNOWLEDGE_DAILY_READ_LIMIT,
    sections: 372,
  });
  assert.equal(status.included, false);
  assert.equal(status.usable, false);
  assert.equal(status.tone, "danger");
  assert.match(status.message, /Entry багтай холбогдоно уу/);
});

test("төлөв: read-only (төлбөр хоцорсон) үед хаалттай + шалтгаан", () => {
  const status = aiAccountantStatus({
    ent: saas(sub({ status: "past_due", currentPeriodEnd: new Date(NOW.getTime() - 60 * DAY) })),
    readsToday: 0,
    dailyLimit: KNOWLEDGE_DAILY_READ_LIMIT,
    sections: 372,
  });
  assert.equal(status.included, true);
  assert.equal(status.usable, false);
  assert.equal(status.badge, "Хаалттай");
  assert.match(status.message, /Төлбөр хоцорсон/);
});

test("төлөв: өдрийн квот хүрвэл анхааруулга, ашиглах боломж хэвээр", () => {
  const status = aiAccountantStatus({
    ent: saas(sub({})),
    readsToday: KNOWLEDGE_DAILY_READ_LIMIT,
    dailyLimit: KNOWLEDGE_DAILY_READ_LIMIT,
    sections: 372,
  });
  assert.equal(status.tone, "warning");
  assert.equal(status.usable, true);
});

test("төлөв: skills багцад «үнэгүй багтсан» гэж хэлэхгүй", () => {
  const status = aiAccountantStatus({
    ent: saas(sub({ planId: "skills" })),
    readsToday: 0,
    dailyLimit: KNOWLEDGE_DAILY_READ_LIMIT,
    sections: 372,
  });
  assert.equal(status.badge, "Идэвхтэй");
  assert.doesNotMatch(status.message, /үнэгүй/);
});

test("хуудас: /settings/ai-д «AI нягтлан» хэсэг, skills нүүрэнд заавар", () => {
  const view = readFileSync("components/ai/ai-connect-view.tsx", "utf8");
  assert.match(view, /id="ai-accountant"/);
  assert.match(view, /<AiAccountantSetup/);
  const skills = readFileSync("components/skills/skills-home.tsx", "utf8");
  assert.match(skills, /<AiAccountantSetup[^>]*accounting=\{false\}/);
});
