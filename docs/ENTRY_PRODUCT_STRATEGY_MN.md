# ENTRY

## AI-native, хэрэглэгч өөрөө өөрчлөх боломжтой нягтлан бодох бүртгэлийн платформын стратеги

**Баримт бичгийн төрөл:** Бүтээгдэхүүн, бизнес модель, интеграцийн нэгдсэн стратеги  
**Хувилбар:** 1.0  
**Огноо:** 2026-08-24  
**Төлөв:** Ажлын үндсэн баримт бичиг

---

## 1. Баримт бичгийн зорилго

Энэ баримт бичиг нь Entry-ийн тухай ярилцлагын хүрээнд батлагдсан бүтээгдэхүүний үзэл санаа, хэрэглэгчийн багц, үнэ, support-ийн бодлого, AI ба MCP стратеги, эх кодын удирдлага, төрийн систем болон банкны Corporate Gateway интеграцийн судалгааг нэг дор эмхэтгэв.

Энэ нь шууд гэрээ, лиценз, мэдээллийн аюулгүй байдлын бодлого эсвэл техникийн нарийвчилсан specification-ийг орлохгүй. Харин дараах ажлын суурь баримт болно:

- бүтээгдэхүүний алсын харааг нэг мөр болгох;
- баг, түнш, хөрөнгө оруулагчид Entry-г тайлбарлах;
- Standard болон Builder багцын хил хязгаарыг тогтоох;
- хөгжүүлэлтийн roadmap гаргах;
- төр, банкны байгууллагатай интеграцийн яриа эхлүүлэх;
- лиценз, гэрээ, аюулгүй байдлын баримт бичиг боловсруулах.

### Тэмдэглэгээ

- **Батлагдсан:** Ярилцлагаар шууд тохирсон шийдвэр.
- **Санал:** Хэрэгжүүлэхэд санал болгож буй загвар.
- **Баталгаажуулах:** Банк, төрийн байгууллага, хуульч эсвэл техникийн туршилтаар нэмж баталгаажуулах зүйл.

---

## 2. Товч хураангуй

Entry бол энгийн SaaS нягтлан бодох бүртгэлийн программ биш. Үндсэн санаа нь компани бэлэн стандарт систем ашиглаж болохын зэрэгцээ хүсвэл өөрийн нягтлан бодогч, захирал, санхүүгийн ажилтнаа AI-ийн тусламжтайгаар системээ өөрчлөх чадвартай болгоход оршино.

Entry хоёр үндсэн бүтээгдэхүүнтэй байна:

1. **Entry Standard** - Entry-ийн удирддаг бэлэн хувилбар. Хэрэглэгчийн үнэ сар бүр 100,000 төгрөг.
2. **Entry Builder** - хэрэглэгч компанид зориулсан private GitHub fork бүхий, өөрсдөө хөгжүүлж, ажиллуулж, өөрчилдөг хувилбар. Нэг удаагийн үнэ 50 сая төгрөг, сургалт нэг хүн тутам 5 сая төгрөг, хоёр өдөр буюу 16 цаг, сар бүрийн subscription нэг хэрэглэгч тутам 20,000 төгрөг.

Builder-ийн гол ялгаа нь код хөгжүүлэгч компанид биш, **хэрэглэгч компанид нээлттэй** байх явдал. Нягтлан бодогч эсвэл захирал ChatGPT, Codex, Claude, Claude Code зэрэг AI хэрэгслээр өөрийн тайлан, workflow, бизнес дүрэм, integration болон UI-г өөрчлөх эрх чөлөөтэй байна.

Entry routine custom development, байнгын гар барьсан support үзүүлэгч болохгүй. Builder хэрэглэгч өөрийн fork, deployment, security, upgrade, rollback болон custom logic-ийн үр дагаврыг хариуцна. Entry шаардлагатай үед төлбөртэй incident triage, upgrade, засвар, сургалт, skill болон custom development үйлчилгээ үзүүлж болно.

Урт хугацаанд Entry дараах экосистемийг байгуулна:

- Entry MCP;
- Certified Builder сургалт;
- reusable skill болон connector Store;
- third-party хөгжүүлэгчдийн custom development marketplace;
- хэрэглэгч хоорондын community;
- Монголын төр, татвар, нийгмийн даатгал, банкны интеграцийн стандарт давхарга.

---

## 3. Бүтээгдэхүүний алсын хараа

### 3.1 Үндсэн тезис

AI хөгжихийн хэрээр программын код бичих зардал, хугацаа эрс буурна. Энэ нөхцөлд хэрэглэгч бүх шаардлагаа программ нийлүүлэгчид тайлбарлаж, санал авч, хөгжүүлэлт хүлээдэг уламжлалт загвар сулрана.

Нягтлан бодогчид болон компанийн удирдлагууд код мэдэхгүй байж болох ч:

- өөрийн бизнесийн процессоо хамгийн сайн мэднэ;
- яг ямар тайлан, хяналт, баталгаажуулалт хэрэгтэйг ойлгоно;
- бэлэн программын хязгаарлалтад байнга тулгардаг;
- хурдан, хямд, өөрсдөө хянадаг шийдэл хүсдэг.

Entry-ийн зорилго нь тэдэнд программын эрх чөлөөг хяналтгүй өгөх биш, харин **аюулгүй хязгаар, сургалт, тест, version control, approval болон rollback-тайгаар** өгөх юм.

### 3.2 Entry-ийн онцгой байршуулалт

Олон улсын зах зээлд Odoo, ERPNext, Dolibarr зэрэг open-source ERP болон accounting шийдлүүд байдаг. Odoo өөрийгөө accounting, inventory, POS болон бусад бизнес аппыг багтаасан open-source suite гэж тодорхойлдог. ERPNext нь 100 хувь free and open-source гэж мэдээлдэг. Dolibarr нь module builder, marketplace, community болон custom development замтай. Эдгээр нь open-source, extensibility, ecosystem загвар олон улсад батлагдсан гэдгийг харуулна.

Entry-ийн ялгарал:

- Монголын татвар, тайлан, нийгмийн даатгал, банкны орчинд анхнаасаа зориулагдана;
- нягтлан бодогч, захирал өөрөө AI-assisted builder болохыг бүтээгдэхүүний төвд байрлуулна;
- MCP-ээр дамжуулан олон AI хэрэгслээс ажиллана;
- Standard болон private-fork Builder-ийг нэг бүтээгдэхүүний стратегид нэгтгэнэ;
- сургалт, skill store, custom development marketplace, community-г орлогын модельтэй холбоно;
- санхүүгийн эрсдэлтэй өөрчлөлтөд maker-checker, audit, test, staging болон human approval шаардана.

**Дүгнэлт:** Entry-ийн өрсөлдөх тал нь зөвхөн open source биш. Монголын compliance integration, AI хэрэглэгчийн туршлага, сургалт, хариуцлагын тодорхой хил болон экосистемийн нийлбэр байна.

---

## 4. Хэрэглэгчийн асуудал ба Entry-ийн үнэ цэн

### 4.1 Гол асуудлууд

1. Бэлэн программ байгууллага бүрийн процесс, тайлан, баталгаажуулалтад бүрэн тохирдоггүй.
2. Өөрчлөлт бүрийг vendor-аар хийлгэхэд удаан, өндөр зардалтай.
3. Нягтлан бодогч код мэдэхгүй боловч шаардлагаа хамгийн сайн ойлгодог.
4. Vendor-ийн custom code өсөх тусам upgrade, support, testing төвөгтэй болдог.
5. Татвар, банк, төрийн системийн интеграц тус бүр өөр стандарт, эрх, гэрээтэй.
6. AI-аар код үүсгэх боломж нэмэгдэж байгаа ч санхүүгийн системд хяналтгүй өөрчлөлт хийх нь өндөр эрсдэлтэй.

### 4.2 Entry-ийн амлалт

Entry хэрэглэгчид дараах сонголтыг өгнө:

- **Бэлэн ашиглах:** Standard хувилбарыг шууд хэрэглэнэ.
- **Өөрийн болгох:** Builder fork дээр workflow, report, validation, integration, UI-г өөрчилнө.
- **AI-тай ажиллах:** MCP болон coding agent ашиглан өгөгдлөө асуух, тайлан бэлтгэх, өөрчлөлтийн draft үүсгэх.
- **Хяналттай нэвтрүүлэх:** branch, pull request, test, staging, approver, backup, rollback ашиглана.
- **Экосистемээс авах:** Store-оос skill, connector, report pack, custom module авна.

---

## 5. Хэрэглэгчийн сегмент ба багцууд

## 5.1 Entry Standard

**Батлагдсан үнэ:** 100,000 төгрөг / хэрэглэгч / сар.

### Зорилтот хэрэглэгч

- өөрийн IT баггүй;
- систем ажиллуулах, upgrade хийх хүсэлгүй;
- хурдан нэвтрүүлэхийг хүсдэг;
- Entry-ийн default workflow хангалттай;
- routine support болон managed service-ийг үнэ цэнтэй гэж үздэг байгууллага.

### Багцын утга

- Entry-ийн удирддаг default release;
- төвлөрсөн deployment, update, security patch;
- стандарт тайлан, workflow, role, audit;
- MCP хэрэглээний сургалт;
- зөвшөөрөгдсөн integration-ууд;
- үйлчилгээний нөхцөлд заасан support.

### Customization-ийн хил

Standard хэрэглэгч configuration, report template, approval workflow, field, mapping зэрэг хяналттай тохиргоо хийж болно. Харин core code-ийн fork авч дур мэдэн өөрчлөхгүй. Том custom development шаардлагатай бол Builder рүү шилжинэ эсвэл Store-ийн баталгаажсан нэмэлт ашиглана.

## 5.2 Entry Builder

**Батлагдсан үнэ:**

- 50,000,000 төгрөг нэг удаа;
- Builder сургалт 5,000,000 төгрөг / хүн;
- сургалтын хугацаа хоёр өдөр, нийт 16 цаг;
- 20,000 төгрөг / хэрэглэгч / сар subscription.

### Зорилтот хэрэглэгч

- өөрийн процесс, тайлан, integration өвөрмөц;
- системээ өөрсдөө хянах хүсэлтэй;
- санхүү, IT эсвэл AI builder үүрэг хариуцах хүнтэй;
- private repository болон self-managed deployment хүсдэг;
- routine vendor support-оос илүү эрх чөлөөг сонгодог байгууллага.

### Builder-д өгөх зүйл

- private GitHub repository fork;
- өөрийн орчинд deploy хийх эрх;
- код болон configuration өөрчлөх боломж;
- Certified Builder сургалт;
- core release болон security update авах суваг;
- Store, community, documentation, MCP ecosystem-д хандах эрх;
- шаардлагатай үед төлбөртэй incident support.

### Customer-ийн хариуцлага

Builder хэрэглэгч дараахыг өөрөө бүрэн хариуцна:

- custom code-ийн correctness;
- accounting rule болон тайлангийн үнэн зөв байдал;
- deployment ба infrastructure;
- access control болон credential security;
- backup, disaster recovery;
- automated test, user acceptance test;
- staging, production release;
- fork merge, upgrade, downgrade;
- банк, татвар, төрийн системд илгээсэн мэдээлэл;
- customization-оос үүссэн алдаа, хохирол.

---

## 6. Support ба үйлчилгээний хил

### 6.1 Үндсэн бодлого

Entry Builder нь routine support багц биш. Entry-ийн баг customer бүрийн custom development department болж хувирахгүй.

### 6.2 Incident support загвар

**Санал:** Builder хэрэглэгчийн хүсэлтийг дараах шаттай болгоно.

1. **Paid triage** - асуудал core, infrastructure, configuration эсвэл custom code-ийн аль нь болохыг оношлох.
2. **Scope and quote** - засварын хүрээ, эрсдэл, хугацаа, үнэ санал болгох.
3. **Paid implementation** - хэрэглэгч зөвшөөрвөл засвар, migration, upgrade хийх.
4. **Handover** - өөрчлөлтийн PR, test result, deployment note өгөх.

### 6.3 Core defect ба customization defect

- Өөрчлөгдөөгүй, дэмжигдсэн Entry core дээр дахин үүсэх алдаа бол core defect.
- Customer-ийн fork, custom module, dependency, deployment, security setting-ээс үүссэн алдаа бол customer customization defect.
- Аль ангилалд орох нь тодорхойгүй бол paid triage хийнэ.

### 6.4 Builder subscription юуг хамрах вэ

**Баталгаажуулах:** 20,000 төгрөгийн subscription-ийн гэрээний утгыг нарийвчлан батлах шаардлагатай. Санал болгож буй хүрээ:

- лиценз хүчинтэй байх;
- core release татах эрх;
- security advisory, critical patch;
- documentation;
- MCP-ийн төвийн шаардлагатай үйлчилгээ;
- Store болон community access;
- compatibility matrix;
- routine support болон custom development орохгүй.

---

## 7. Сургалтын стратеги

Албан нэршлийг **Entry Certified Builder Training** гэж ашиглана. “Vibe coding” гэдэг үгийг маркетингийн hook болгон хэрэглэж болох ч гэрээ, сургалтын гэрчилгээ, governance баримтад мэргэжлийн нэршил хэрэглэнэ.

### 7.1 Хоёр өдрийн сургалтын санал болгож буй бүтэц

#### Өдөр 1 - Аюулгүй өөрчлөлтийн суурь

- Entry architecture ба accounting core;
- repository, branch, commit, pull request;
- ChatGPT, Codex, Claude, Claude Code ашиглах;
- prompt-оос requirement, test case гаргах;
- report, field, workflow өөрчлөх;
- test, staging, backup, rollback;
- нууц мэдээлэл болон credential хамгаалах.

#### Өдөр 2 - Бодит customization ба governance

- байгууллагын нэг бодит workflow өөрчлөх;
- validation rule хийх;
- MCP tool ашиглах;
- connector болон Store skill суулгах;
- accounting impact review;
- maker-checker approval;
- release гаргах, downgrade хийх;
- incident үүсвэл оношлох болон Entry-д escalation хийх.

### 7.2 Role

- **User:** өдөр тутмын бүртгэл, тайлан.
- **Builder:** configuration, code, test, PR.
- **Reviewer:** code, accounting impact, security review.
- **Approver:** production release болон мөнгө/тайлан илгээх зөвшөөрөл.

Нэг хүн жижиг байгууллагад хэд хэдэн role эзэмшиж болох ч систем үйлдэл бүрийн audit trail-ийг тусад нь хадгална.

---

## 8. GitHub, release, downgrade ба эх кодын хамгаалалт

### 8.1 Release ба downgrade

GitHub release болон semantic version ашигласнаар:

- тогтвортой хувилбар тэмдэглэх;
- release note хадгалах;
- өмнөх хувилбар руу буцах;
- customer fork ямар core version дээр байгааг мэдэх;
- migration болон compatibility удирдах боломжтой.

Гэхдээ application code-ийг downgrade хийх нь database schema болон өгөгдлийг автоматаар буцаана гэсэн үг биш. Release бүр:

- migration;
- backward compatibility;
- backup requirement;
- rollback procedure;
- irreversible change;
- supported version window

гэсэн мэдээлэлтэй байна.

### 8.2 Санал болгож буй branch загвар

- `entry-core/*` - Entry-ийн upstream release;
- `customer/main` - customer-ийн production;
- `customer/staging` - туршилтын орчин;
- `feature/*` - өөрчлөлтийн branch;
- tag - батлагдсан production release.

### 8.3 Эх кодын хамгаалалтын бодит үнэлгээ

Customer-д бүтэн private fork өгвөл эх код задрах эрсдэлийг техникийн аргаар бүрэн тэглэх боломжгүй. Иймээс хамгаалалт дараах нийлбэр байна:

- private repository;
- named user access;
- least privilege;
- audit log;
- repository export болон secret scanning;
- лиценз ба гэрээ;
- confidentiality, IP, redistribution restriction;
- customer watermark/build identifier;
- credential болон Entry-ийн төвийн нууцыг source code-д оруулахгүй байх;
- хамгийн үнэ цэнтэй төвийн үйлчилгээ, signing key, marketplace, update service-ийг тусдаа ажиллуулах.

### 8.4 Ownership-ийн санал

- Entry core IP - Entry-д үлдэнэ.
- Customer-ийн өгөгдөл - customer-ийн өмч.
- Customer-ийн өөрийн custom code - гэрээгээр тодорхойлсон хүрээнд customer хянаж, ашиглана.
- Entry Store-д нийтлэх module - зохиогч, лиценз, revenue share тодорхой байна.
- Core руу буцааж нийлүүлэх improvement - тусдаа contribution agreement-тай байна.

**Баталгаажуулах:** Эцсийн лицензийг Монголын программ хангамж, зохиогчийн эрх, нууцлал, хариуцлагын хуульчтай боловсруулна.

---

## 9. AI ба MCP стратеги

### 9.1 Үндсэн боломж

Entry MCP нь ChatGPT, Codex, Claude, Claude Code зэрэг хэрэгслээс Entry-ийн зөвшөөрөгдсөн үйлдлийг дуудах стандарт давхарга байна.

Жишээ read болон draft tool:

- `search_transactions`
- `explain_balance`
- `draft_journal_entry`
- `prepare_tax_report`
- `validate_tax_report`
- `prepare_social_insurance_report`
- `compare_ebarimt_sales`
- `sync_bank_transactions`
- `reconcile_bank_statement`
- `create_payment_draft`

### 9.2 Эрхийн шатлал

1. **Read:** асуух, хайх, тайлбарлах.
2. **Draft:** журнал, тайлан, төлбөрийн draft бэлтгэх.
3. **Validate:** дүрэм, дүн, давхардал шалгах.
4. **Approve:** зөвхөн эрх бүхий хүн.
5. **Submit:** батлагдсан үйлдлийг connector-оор илгээх.

AI нь мөнгө шилжүүлэх, татварын тайлан илгээх, тоон гарын үсэг зурах, production deploy хийх эцсийн эрхийг дангаараа авахгүй.

### 9.3 Албан ёсны integration болох зам

Одоогийн custom/private MCP-ийг бүтээгдэхүүний чанарт хүргэхэд:

- тогтвортой public MCP endpoint;
- OAuth болон organization authorization;
- privacy policy, terms of use;
- tool бүрийн тодорхой schema;
- read/write permission ялгалт;
- audit log болон consent screen;
- rate limit, retry, idempotency;
- test tenant;
- OpenAI болон Anthropic-ийн тус тусын distribution/approval шаардлага

хэрэгтэй.

Нэг MCP server техникийн хувьд олон AI client-д ажиллаж болох ч ChatGPT/Codex болон Claude/Claude Code-ийн албан ёсны түгээлт, review, listing нь тусдаа процесс байна.

---

## 10. Store ба community

### 10.1 Store-д зарах боломжтой зүйл

- салбарын chart of accounts pack;
- тайлангийн template;
- tax validation skill;
- банкны reconciliation rule;
- payroll module;
- approval workflow;
- dashboard;
- салбарын connector;
- MCP skill;
- migration болон data cleaning package.

### 10.2 Seller төрөл

- Entry;
- Certified Builder;
- нягтлан бодох зөвлөх;
- программ хөгжүүлэгч;
- integration partner;
- салбарын мэргэжилтэн.

### 10.3 Store governance

- publisher identity;
- version compatibility;
- source/license status;
- security review;
- accounting impact declaration;
- test coverage;
- update policy;
- refund, support, liability;
- customer review;
- revenue share.

### 10.4 Community

Community нь хэрэглэгчид хоорондоо:

- workflow хуваалцах;
- accounting practice хэлэлцэх;
- skill болон module санал болгох;
- upgrade issue шийдэх;
- Certified Builder олох

боломжтой орчин байна. Community зөвлөгөө нь Entry-ийн албан ёсны accounting/legal advice биш гэдгийг тодорхой тэмдэглэнэ.

---

## 11. Монголын төрийн системийн интеграц

## 11.1 Нэгдсэн дүгнэлт

| Систем | Одоогийн боломж | Entry-ийн эхний шийдэл |
|---|---|---|
| eBarimt | Албан ёсны POSAPI 3.0 баримттай | Шууд API connector |
| eTax | Албан ёсны API байгаа, эрх хяналттай | Тайлан бэлтгэл, validation, дараа нь direct API |
| eBalance | Нийтийн developer API олдоогүй, vendor интеграц байдаг | Import файл, mapping, дараа нь partner API |
| Нийгмийн даатгал | Excel/XML тайлангийн суваг батлагдсан | НД7/НД8 export, дараа нь API боломж судлах |

### 11.2 eBarimt

eBarimt нь хамгийн түрүүнд хийхэд бэлэн интеграц. Албан ёсны СМТТ хөгжүүлэгчийн портал дээр POSAPI 3.0 ашиглах, туршилтын орчин, API холболт, баримт хадгалах, баталгаажуулах болон token авах баримт байна.

Entry дараахыг дэмжинэ:

- B2C болон B2B баримт;
- борлуулалт, буцаалт, цуцлалт;
- VAT, city tax;
- QR, сугалаа, receipt ID;
- merchant, branch, POS, seller;
- бүтээгдэхүүн, үйлчилгээний код;
- offline queue, retry, sync;
- eBarimt борлуулалтыг Entry журналтай тулгах.

**Архитектур:** customer-ийн салбар эсвэл серверт local connector ажиллуулах нь POSAPI-ийн дотоод үйлчилгээтэй нийцнэ.

### 11.3 eTax

СМТТ-ийн Developer Portal дээр eTax API танилцуулга байгаа боловч production credential, sandbox, endpoint schema болон software vendor-ийн эрх авах процесс нийтэд бүрэн харагдахгүй байна.

Entry-ийн хоёр үе шат:

1. Татварын тайлан тооцоолох, mapping хийх, дүн тулгах, алдаа шалгах, зөвшөөрөгдсөн файл гаргах.
2. ТЕГ/СМТТ-ийн албан эрх авсны дараа draft үүсгэх, илгээх, төлөв татах, хүлээн авсан дугаар архивлах.

Цахим татварын тайлан тоон гарын үсгээр баталгаажих шаардлагатай. Иймээс AI тайлан бэлтгэж болох ч эрх бүхий хүн баталж, гарын үсэг зурна.

### 11.4 eBalance

Нийтийн developer API specification олдоогүй. Гэхдээ Монголын санхүүгийн зарим программ eBalance руу тайлан автоматаар илгээдэг гэж мэдээлдэг тул partner эсвэл private integration суваг байгаа гэж үзэх үндэслэлтэй.

Эхний release:

- санхүүгийн тайлангийн мөр mapping;
- тодруулгын тайлан;
- баланс, орлого, cash flow тулгалт;
- жил, маягтын version;
- зөвшөөрөгдсөн Excel/XML импорт файл.

Дараа нь Сангийн яам, eBalance оператор, СМТТ-өөс vendor API, sandbox, schema, signing, status endpoint-ийн нөхцөлийг албан ёсоор авна.

### 11.5 Нийгмийн даатгал

Нийгмийн даатгалын employer portal болон хуучин online-shim материалд НД7, НД8, Excel/XML загвар, тоон гарын үсгийн мэдээлэл байна. Нийтийн employer submission API баримт олдоогүй.

Entry эхний үед:

- ажилтны шимтгэл ногдох орлого;
- даатгуулагчийн ангилал;
- сан тус бүрийн тооцоо;
- НД7/НД8;
- хүчинтэй schema-тай Excel/XML;
- payroll, GL, contribution total reconciliation;
- илгээсэн тайлан, receipt архив

хийнэ. Хүчинтэй schema-г НДЕГ-аас албан ёсоор авч баталгаажуулна.

### 11.6 Төрийн connector-ийн аюулгүй байдлын зарчим

- browser automation-аар төрийн portal login, signature, submit хийхгүй;
- credential, certificate, token-ийг source code-д хадгалахгүй;
- schema, маягт, татварын дүрмийг version-тэй болгох;
- submission бүр idempotency key-тэй байх;
- raw request/response болон receipt хадгалах;
- human approval шаардах;
- retry нь давхар илгээлт үүсгэхгүй байх;
- Standard болон Builder-ийн credential boundary тусдаа байх.

---

## 12. Банкны Corporate Gateway стратеги

## 12.1 Зах зээлийн дараалал

Монголбанк 2025 оны байдлаар ХААН, Голомт, Худалдаа хөгжлийн, Төрийн, Хас банкийг системийн нөлөө бүхий банк гэж тодорхойлсон. Иймээс Entry эхлээд эдгээр таван банк дээр төвлөрнө.

| Банк | Нийтийн мэдээллээр батлагдсан боломж | Priority |
|---|---|---:|
| ХААН | REST/JSON, OAuth2, account, balance, statement, transfer, batch, tax, customs | 1 |
| Голомт | Statement, domestic, batch, SWIFT, FX, tax, customs, digital signature | 2 |
| ХХБ | REST/JSON, OAuth, statement, transfer, customs, FX, double control | 3 |
| Хас | Corporate Gateway ашиглагдаж байгаа, ERP statement integration батлагдсан | 4 |
| Төрийн банк | Corporate Gateway бүтээгдэхүүн батлагдсан | 5 |
| Капитрон | Public Open Banking developer portal | 6 |
| Тээвэр хөгжлийн банк | Account information, statement, domestic transfer | 7 |
| Богд | Statement/income automation, transaction service | 8 |

### 12.2 Phase 1 - Read-only Bank Sync

- данс холбох;
- account list, balance авах;
- statement автоматаар татах;
- cursor болон date range-аар incremental sync;
- transaction fingerprint үүсгэж duplicate хамгаалах;
- орлогыг invoice, receivable-тай тулгах;
- зарлагыг payable, expense, payroll-тай тулгах;
- банкны шимтгэлийн journal санал болгох;
- танигдаагүй гүйлгээг review queue-д оруулах.

Энэ phase нь санхүүгийн шууд шилжүүлгийн эрсдэлгүйгээр хэрэглэгчид өндөр үнэ цэн өгнө.

### 12.3 Phase 2 - Payment Draft

- payable-ээс draft payment;
- beneficiary name/account check;
- duplicate болон amount anomaly check;
- balance ба limit check;
- batch payroll file/API payload;
- tax/customs payment draft;
- scheduled payment draft.

Draft нь банк руу мөнгө шилжүүлэхгүй. Нягтлан бэлтгээд approver-д илгээнэ.

### 12.4 Phase 3 - Maker-checker submission

1. Нягтлан буюу maker draft үүсгэнэ.
2. Entry business rule, balance, beneficiary, duplicate, limit шалгана.
3. Захирал эсвэл approver батална.
4. Bank adapter батлагдсан payload илгээнэ.
5. Entry банкны transaction status-ийг дахин шалгана.
6. Final status, reference, fee, receipt-ийг журналтай холбоно.

Pending, timeout, unknown үед шууд retry хийхгүй. Эхлээд status/reference лавлаж, гүйлгээ банканд бүртгэгдээгүй нь тодорхой болсон үед retry хийнэ.

### 12.5 Нэгдсэн Banking API

Entry core банк бүрийн field, error, token logic-ийг мэдэхгүй байна. Нэгдсэн interface-ийн ард versioned adapter ажиллана.

```text
Entry Banking API
  |- Khan adapter
  |- Golomt adapter
  |- TDB adapter
  |- Xac adapter
  |- State adapter
  |- Capitron adapter
  `- Other bank adapters
```

Нэгдсэн үйлдэл:

- `list_accounts`
- `get_balance`
- `sync_transactions`
- `verify_beneficiary`
- `create_payment_draft`
- `submit_approved_payment`
- `get_payment_status`
- `download_payment_receipt`

### 12.6 Банкны гэрээ ба onboarding

Ихэнх Corporate Gateway нь дурын public API key биш. Customer тухайн банкны corporate харилцагч байж, дансаа холбуулах гэрээ байгуулна. Entry мөн software vendor/partner байдлаар банк тус бүртэй:

- cooperation agreement;
- confidentiality agreement;
- sandbox access;
- test certification;
- production onboarding;
- security requirement;
- support/escalation channel;
- multi-tenant SaaS болон self-hosted Builder нөхцөл

тохирно.

### 12.7 Standard ба Builder

**Standard:** Entry-managed adapter, encrypted tenant credential, central monitoring, managed update.

**Builder:** customer-ийн орчинд local/self-hosted bank connector ажиллуулахыг илүүд үзнэ. Credential Entry-ийн төв сервер рүү очихгүй. Customer deployment, network, certificate, upgrade болон incident-ээ хариуцна.

---

## 13. Санал болгож буй системийн архитектур

```text
Users / AI Clients
ChatGPT | Codex | Claude | Claude Code | Entry UI
                         |
                         v
                Entry Identity & Policy
                         |
                         v
                    Entry MCP/API
                         |
          +--------------+--------------+
          |                             |
          v                             v
  Accounting Core              Approval & Audit
  GL, AR, AP, Payroll          Maker-checker, logs
          |
          v
  Compliance Mapping Layer
  Tax, eBalance, ND, eBarimt
          |
          +-----------------------------+
          |                             |
          v                             v
 Government Connectors           Banking API
 eBarimt/eTax/eBalance/ND        Bank adapters
          |                             |
          v                             v
 Government Systems               Corporate Gateways
```

### Архитектурын зарчим

- accounting core тогтвортой, connector-оос тусдаа;
- external schema versioned;
- all write actions audited;
- raw external response preserved;
- secrets managed outside source;
- AI permission least-privilege;
- approval rule centrally enforced;
- custom fork core invariant-ийг test-ээр хамгаалах;
- adapter contract tests болон sandbox smoke tests ажиллуулах.

---

## 14. Хэрэгжүүлэх roadmap

## Phase 0 - Суурь governance

- Standard/Builder product terms;
- role, approval, audit;
- repository ба release policy;
- licensing draft;
- MCP permission model;
- connector interface specification.

## Phase 1 - Хамгийн өндөр үнэ цэнтэй automation

- eBarimt POSAPI 3.0;
- ХААН, Голомт, ХХБ read-only bank sync;
- bank reconciliation;
- НД7/НД8 Excel/XML;
- eBalance import file;
- eTax report calculation/validation/export.

## Phase 2 - Coverage ба direct integration

- Хас, Төрийн банк, Капитрон;
- eTax official API;
- eBalance partner API;
- tax and bank receipt archive;
- Standard connector monitoring.

## Phase 3 - Controlled write operations

- bank payment draft;
- beneficiary validation;
- maker-checker;
- batch payroll;
- tax/customs payment;
- payment status reconciliation.

## Phase 4 - Builder ecosystem

- Certified Builder program;
- Store;
- publisher verification;
- skill/module signing;
- community;
- third-party connector certification.

---

## 15. Орлогын загвар

### Үндсэн орлого

- Standard subscription;
- Builder one-time enablement/license;
- Builder user subscription;
- Certified Builder Training;
- paid incident triage;
- paid upgrade, migration, recovery;
- custom development;
- Store commission;
- certified connector/module listing;
- enterprise security/compliance service.

### Бизнесийн чухал хязгаар

Builder-ийн 50 сая төгрөг болон хямд сарын subscription нь Entry бүх custom асуудлыг үнэгүй хариуцна гэсэн үг биш. Гэрээ, sales material, onboarding, product UI бүх түвшинд энэ хилийг нэг мөр тайлбарлана.

---

## 16. Гол эрсдэл ба хамгаалалт

| Эрсдэл | Нөлөө | Хамгаалалт |
|---|---|---|
| Нягтлан AI-аар буруу code үүсгэх | Тайлан, журнал буруу | Test, staging, reviewer, approver |
| Буруу банкны гүйлгээ | Шууд санхүүгийн хохирол | Draft, maker-checker, limits, status check |
| Давхар submit/retry | Давхар төлбөр/тайлан | Idempotency, reference lookup, reconciliation |
| Credential алдагдах | Данс, өгөгдлийн эрсдэл | Vault, local connector, rotation, audit |
| Төрийн schema өөрчлөгдөх | Тайлан буцаагдах | Versioned mapping, contract test, release note |
| Customer fork хоцрох | Security, compatibility | Supported-version policy, paid upgrade |
| Entry support-д дарагдах | Margin буурах | Paid triage, scope, no default Builder SLA |
| Эх код тарах | IP алдагдах | Private repo, contract, access audit, service boundary |
| AI хэт их эрхтэй болох | Fraud, unauthorized action | Least privilege, explicit human approval |
| Community зөвлөгөө буруу байх | Compliance error | Disclaimer, verified publisher, moderation |

---

## 17. Батлагдсан шийдвэрийн бүртгэл

1. Entry бол accounting system.
2. Builder-ийн source code хэрэглэгч компанид private fork хэлбэрээр нээлттэй байна.
3. Нягтлан бодогч, захирал AI-assisted builder болж customize хийх боломжтой.
4. Standard үнэ 100,000 төгрөг / хэрэглэгч / сар.
5. Builder нэг удаагийн үнэ 50 сая төгрөг.
6. Builder сургалт 5 сая төгрөг / хүн, хоёр өдөр, 16 цаг.
7. Builder subscription 20,000 төгрөг / хэрэглэгч / сар.
8. Builder routine support бараг авахгүй, өөрсдөө хариуцна.
9. Шаардлагатай support, incident, custom work төлбөртэй байна.
10. Standard болон Builder хэрэглэгч аль аль нь MCP, ChatGPT, Codex, Claude, Claude Code хэрэглэж сурна.
11. Store-д skill болон custom development зарах боломж нээнэ.
12. Хэрэглэгчид хоорондоо зөвлөлдөх community байгуулна.
13. Release болон downgrade GitHub version-оор удирдагдана.
14. Төрийн интеграцад eBarimt-ийг direct API-аар эхлүүлнэ.
15. eTax/eBalance/НД дээр эхлээд report preparation/export, дараа нь official API замаар ахиулна.
16. Банкны интеграцад эхлээд read-only statement/reconciliation, дараа нь controlled payment хийнэ.
17. AI өөрөө банкны төлбөр, татварын тайланг эцэслэн батлахгүй.

---

## 18. Нээлттэй шийдвэрүүд

1. Builder лиценз perpetual эсвэл subscription validity-тай эсэх.
2. 20,000 төгрөгийн subscription зогсвол fork ашиглах эрх хэрхэн өөрчлөгдөх.
3. Supported core version-ийн хугацаа.
4. Paid triage-ийн minimum charge, hourly rate, emergency multiplier.
5. Standard support SLA.
6. Store commission ба seller payout.
7. Customer custom code-ийн ownership ба Entry-д reuse хийх нөхцөл.
8. Builder customer source access-ийг user/seat/organization-аар хязгаарлах эсэх.
9. Bank payment feature аль багцад, ямар нэмэлт үнээр орох.
10. MCP usage quota болон AI provider-ийн зардлыг хэн хариуцах.
11. Official accounting/legal certification шаардлага.
12. eTax, eBalance, НДЕГ болон банк тус бүрийн vendor гэрээ, sandbox, audit нөхцөл.

---

## 19. Ойрын дараагийн ажлууд

### Бизнес ба хууль

- Standard ба Builder term sheet;
- Builder support policy;
- software license болон confidentiality draft;
- data processing, privacy, security policy;
- Store seller agreement.

### Product

- Standard/Builder feature matrix;
- role-permission matrix;
- MCP tool catalog;
- approval UX;
- connector management screen;
- audit dashboard.

### Partnership

- СМТТ/ТЕГ-д eTax/eBarimt vendor хүсэлт;
- Сангийн яам/eBalance API хүсэлт;
- НДЕГ-д current XML schema/API хүсэлт;
- ХААН, Голомт, ХХБ-д vendor agreement болон sandbox хүсэлт;
- дараа нь Хас, Төрийн банк, Капитрон.

### Engineering

- canonical Banking API spec;
- Government Connector interface;
- secret management;
- idempotency framework;
- immutable audit event;
- release/migration/rollback standard;
- core invariant test suite.

---

## 20. Эх сурвалж

### Олон улсын бүтээгдэхүүний жишиг

- [Odoo - Open Source ERP and CRM](https://www.odoo.com/)
- [ERPNext - open-source ERP](https://erpnext.com/)
- [Dolibarr - Open Source ERP and CRM](https://www.dolibarr.org/)

### eBarimt ба eTax

- [СМТТ Developer Portal](https://developer.itc.gov.mn/)
- [POSAPI 3.0 системийн заавар](https://developer.itc.gov.mn/docs/ebarimt-api/9ebc8iaq69ipw-posapi-3-0-sistemijn-zaavar)
- [POSAPI 3.0 API холболт](https://developer.itc.gov.mn/docs/ebarimt-api/inbishdm2zj3x-pos-api-3-0-sistemijn-api-holbolt-za)
- [POSAPI 3.0 туршилтын орчин](https://developer.itc.gov.mn/docs/ebarimt-api/branches/main/u0vpfrq242mtu-posapi-3-0-sistemijn-turshiltyn-orching-ashiglah-zaavar)
- [eTax API танилцуулга](https://developer.itc.gov.mn/docs/etax-api/u5lwigkjw3pcv-tanilczuulga)
- [Татварын цахим үйлчилгээ ба цахим гарын үсэг](https://mta.gov.mn/files/pdf/1x0cgpm8kcr/6576bc9ebc0423573f2e6bd4.pdf)

### eBalance ба нийгмийн даатгал

- [eBalance санхүүгийн тайлангийн систем](https://e-balance.mof.gov.mn/)
- [Smart Software интеграцийн жагсаалт](https://www.smartapp.mn/integrations)
- [Нийгмийн даатгалын цахим үйлчилгээ](https://www.ndaatgal.mn/tsahim-uilchilgee/)
- [Нийгмийн даатгалын employer portal тусламж](https://www.ndaatgal.mn/help/)
- [Нийгмийн даатгалын тайлангийн материал](https://app.ndaatgal.mn/onlineshim/)

### Банкны Corporate Gateway

- [Монголбанкны 2025 оны жилийн тайлан](https://www.mongolbank.mn/file/e1f57d759e643702e18549a39b69e19a/files/MB_jil_tailan2025%202%201%201.pdf)
- [ХААН Банк Corporate Gateway Developer Manual](https://www.khanbank.com/uploaded/static_files/documents/Corporate%20Gateway%20Developer%20garin%20avlaga.pdf)
- [Голомт банк Corporate Gateway](https://www.golomtbank.com/corporate/digital-bank/corporate-gateway)
- [Худалдаа хөгжлийн банк Corporate Gateway](https://www.tdbm.mn/en/corporate/tsahim-bank/corporate-gateway)
- [Капитрон Open Banking](https://open.capitronbank.mn/)
- [Тээвэр хөгжлийн банк Corporate Gateway](https://transbank.mn/en/organization/digital-banking-organization/corporate-gateway)
- [Богд банк Corporate Gateway](https://www.bogdbank.com/corporate/product/39)
- [Төрийн банк Corporate Gateway бүтээгдэхүүн](https://www.statebank.mn/corporate/product/10001)
- [ХасБанкны 2024 оны эхний хагас жилийн тайлан](https://xacbank.mn/api/media/file/%D0%A5%D0%B0%D1%81%D0%91%D0%B0%D0%BD%D0%BA%D0%BD%D1%8B%202024%20%D0%BE%D0%BD%D1%8B%20%D1%8D%D1%85%D0%BD%D0%B8%D0%B9%20%D1%85%D0%B0%D0%B3%D0%B0%D1%81%20%D0%B6%D0%B8%D0%BB%D0%B8%D0%B9%D0%BD%20%D0%A1%D0%B0%D0%BD%D1%85%D2%AF%D2%AF%2C%20%D2%AF%D0%B9%D0%BB%20%D0%B0%D0%B6%D0%B8%D0%BB%D0%BB%D0%B0%D0%B3%D0%B0%D0%B0%D0%BD%D1%8B%20%D1%82%D0%B0%D0%B9%D0%BB%D0%B0%D0%BD.pdf)

---

## 21. Эцсийн байр суурь

Entry-ийн хамгийн том боломж нь ирээдүйд AI код бичдэг болно гэдгийг хүлээх биш, харин тэр ирээдүйд нягтлан бодогч, захирал аюулгүй, хариуцлагатайгаар өөрийн системийг удирдах дэд бүтцийг одооноос байгуулахад оршино.

Standard нь найдвартай бэлэн бүтээгдэхүүн, Builder нь эрх чөлөө ба хариуцлага, MCP нь AI интерфейс, connector-ууд нь Монголын compliance ба банкны орчны давуу тал, Store ба community нь өргөжих экосистем болно.

Entry-ийн гол зарчим:

> **Өөрчлөх эрх чөлөөг өгнө. Санхүүгийн хариуцлагыг автоматжуулж алга болгохгүй.**
