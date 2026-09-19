# Session 4 — Extension SDK (хөгжүүлэгчийн зам)

> Гаралт: `PLAN-extension-sdk.md` · Branch: `plan/extension-sdk` · Хамаарал: Session 1, 2

---

# Даалгавар: хэрэглэгчид vibe coding-оор extension бичих Extension SDK-ийн төлөвлөгөө

**ЭХЛЭЭД** `PLAN.md` (архитектурын төлөвлөгөө) болон `PLAN-ai-layer.md`-г бүтнээр нь унш. Тэнд тодорхойлсон event механизм, API давхарга, хавтасны бүтэцтэй зөрчилдөхгүй байх ёстой.

Зорилго: хэрэглэгч (эсвэл түүний нягтлан, эсвэл түүний хөлсөлсөн хөгжүүлэгч) entry-ийн цөмийн кодонд огт хүрэлгүй, Claude Code / Cursor ашиглан өөрийн хэрэгцээний extension (импорт, тайлан, автоматжуулалт, гадаад системтэй холбох) бичиж чаддаг болгох.

> Тайлбар: кодын мэдлэггүй хэрэглэгчийн зам бол Session 7 (Entry Studio). Энэ session нь **хөгжүүлэгчийн зам** — SDK нь Entry Studio-ийн суурь болно.

**Ажлын горим:** судалж `PLAN-extension-sdk.md` бичнэ. Код засахгүй. Тусдаа branch.

## 1. Судалгаа

а) **REST API-ийн одоогийн байдал**: endpoint жагсаалт, auth (API key/tenant), versioning байгаа эсэх, OpenAPI spec гарч байгаа эсэх. MCP tool-ууд болон REST endpoint-ууд ижил service давхаргыг дуудаж байгаа эсэх.

б) Webhook/event гадагш илгээх механизм байгаа эсэх.

в) Tenant-д sandbox/test хуулбар үүсгэх боломж, өгөгдлийг хуулах/цэвэрлэх арга.

г) Extension-д өгч болох эрхийн түвшин: одоо API key бүх tool-д хандах эрхтэй юу, scope хязгаарлах боломж байна уу?

## 2. Санал

1. **Public API contract**: OpenAPI spec автоматаар гарах, `/v1/` versioning, breaking change-ийн бодлого (deprecation хугацаа). Extension зөвхөн энэ contract дээр тулгуурлана.

2. **Webhooks**: `document.posted`, `document.reversed`, `period.closed`, `inventory.confirmed` зэрэг event-ийг хэрэглэгчийн URL руу илгээх. Signature, retry, idempotency. PLAN.md-ийн domain event механизмтай уялдуул.

3. **API key scope**: read-only / write-draft / post зэрэг түвшин. Extension-д default нь draft хүртэл; батлах эрхийг тусад нь өгнө. Цөмийн дүрэм (дебет=кредит, хаагдсан үе, буцаалт) extension-ээс тойрч болохгүй гэдгийг баталгаажуул. Session 6-ийн entitlement загвартай нийцтэй байх (`knowledge-only / read / write-draft / post / admin`).

4. **Sandbox tenant**: хэрэглэгч бүрд нэг товчоор production-ий хуулбар (эсвэл demo өгөгдөлтэй хоосон) tenant үүсгэх, хугацаа дуусахаар устах.

5. **entry-extension-template repo**: TypeScript эсвэл Python (аль нь хэрэглэгчид хялбар — аргументтай санал болго). Агуулга: API client, webhook receiver жишээ, 3 бэлэн жишээ extension (Excel-ээс борлуулалт импортлох, хугацаа хэтэрсэн авлагын имэйл, тайлан экспорт), тест, README.

6. **AGENTS.md / CLAUDE.md** template repo-д: entry-ийн архитектур товч, зөвшөөрөгдсөн API, ХОРИГЛОСОН зүйлс (DB-д шууд хандах, батлагдсан баримт засах, tenant credential хадгалах), тестийн шаардлага, sandbox дээр эхлээд туршихыг шаардах.

7. **Extension бүртгэл** (ирээдүйд): хэрэглэгч extension-ээ entry дотор бүртгэж, статус харах, унтраах. Санал болгоод үлдээ, одоо хэрэгжүүлэхгүй.

## 3. Гаралт

`PLAN-extension-sdk.md`: судалгааны дүн, API contract-ийн зарчим, webhook жагсаалт, scope загвар, template repo-ийн бүтэц, AGENTS.md-ийн бүрэн эх, хэрэгжүүлэх дараалал ба PLAN.md-тэй хамаарал. Монголоор.
