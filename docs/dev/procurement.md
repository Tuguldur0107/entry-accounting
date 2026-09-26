# Хангамж (Procurement — PO + landed cost)

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (§5a). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

### 5a. Хангамж (Procurement — PO + landed cost) — ХЭРЭГЖСЭН

**Баримт бичиг: `docs/procurement/` — хангамжийн код хөндөхийн ӨМНӨ заавал
уншина.** `00-proposal.md` (дизайн §3–§5, БАТЛАГДСАН 2026-09-11) →
`01-implementation-contract.md` (функцийн нэр/параметр — зөрөхийг хориглоно).
Батлагдсан шийдвэрүүд `docs/cost/README.md` change-control **0.6**, норматив
шаардлага `docs/cost/01-functional-specification.md` §11
**FR-PROC-006 … FR-PROC-012**.

Худалдан авалтыг НЭГ объект (PO) болгож, хоёр түр дансаар хаалтыг хянана.
Өртгийн PWA хөдөлгөгч (`periodic.ts`, `period-run.ts`, `period-close.ts`)
ӨӨРЧЛӨГДӨӨГҮЙ — хангамж нь зөвхөн Inbound-ыг бүрдүүлнэ.

**Урсгал** (бичилт бүрийн Business Object = PO):

```
① PO үүсгэх (ноорог) → Батлах (open)        GL бичилт ҮГҮЙ (захиалга нь гүйлгээ биш)
② Хүлээн авалт (GR) — PO панелиас; нэхэмжлэхээс ӨМНӨ ч ДАРАА ч, хэсэгчилсэн
   Батлах → po_receipt орлого (confirmed) + АВТОМАТ receipt_capitalize
   дүн = тоо × PO нэгж үнэ × ХҮЛЭЭН АВСАН ӨДРИЙН Монголбанкны ханш
③ Нийлүүлэгчийн нэхэмжлэх (PO-той) — нэхэмжлэхийн өдрийн МБ ханш
   хөдөлгөөн ҮҮСГЭХГҮЙ (орлого ②-оос); хаагдсан PO → [PO_CLOSED]
④ Нэмэлт зардал (гааль, тээвэр, брокер…) — мөр бүрд бүрэлдэхүүн
   гаалийн татвар КАПИТАЛЖИНА; импортын НӨАТ капиталжихгүй → НӨАТ авлага
⑤ Хуваарилалт — "Хуваарилагдаагүй зардал" worklist; суурь 3, default СОНГОГДОХГҮЙ
   (PO-ГҮЙ зардлыг Өртөг → Зардлын хуваарилалт → Чөлөөт табаас хуваарилна:
    эх нэхэмжлэхийн мөрийг СОНГОЛТООР холбоно — холбовол клирингийн тулгалтад
    Dr/Cr нэг объектод тэгширч, Σ нь мөрийн үлдэгдлээс хэтрэхгүй)
⑥ PO хаах — нөхцөл биелсэн үед түр дансуудыг тэгшитгэнэ, зөрүү → ханшийн олз/гарз
⑦ Төлбөр — арилжааны банкны ханш (одоогийн касс логик, өөрчлөлтгүй)
⑧ Сар хаалт — тэр сард хүлээн авалттай НЭЭЛТТЭЙ PO байвал ХОРИГЛОНО
```

**PO-гүй жижиг худалдан авалт** — одоогийн зам хэвээр: АП бараатай мөр →
орлого → нэхэмжлэхийн дүнгээр капитализаци (нэг түр дансаар).

**GL бичилт** (дугаар кодод байхгүй — тохиргооны РОЛЬ):

```
② Хүлээн авалт батлах   Dr Барааны нөөц  (costing_item_settings)
                        Cr Бараа мат. түр данс (clearingAccountNumber)
③④ PO-той нэхэмжлэх     Dr Өглөгийн түр данс (apClearingAccountNumber)
                        Cr Өглөг (АР/АП-ийн одоогийн логик)
   импортын НӨАТ        Dr НӨАТ авлага (бүрэлдэхүүнгүй мөр, данс ИЛ)
⑤ Хуваарилалт          Dr Барааны нөөц / Cr Бараа мат. түр данс  (landed_cost)
⑥ PO хаалт             Dr Бараа мат. түр данс / Cr Өглөгийн түр данс
                        зөрүү → Dr Ханшийн гарз ЭСВЭЛ Cr Ханшийн олз
                        (fxLoss/fxGainAccountNumber) → хоёр түр данс PO-гоор 0
```

Гол файлууд:

```
lib/procurement/
├── constants.ts      PO_BUSINESS_OBJECT / PO_SOURCE_TYPE / PROCUREMENT_MODULE_KEY
│                     — литералын ЦОРЫН ГАНЦ эх сурвалж
├── close-lines.ts    buildPoCloseLines — ЦЭВЭР (тесттэй) хаалтын мөрүүд,
│                     ханшийн олз/гарз; чиглэл буруу бол ШИДНЭ (нөхөж бичихгүй)
├── po-math.ts        remainingToReceive / remainingToInvoice / poCloseBlockers
│                     — хаалтын нөхцөл, шалтгаан нь МОНГОЛ текстээр
├── types.ts          PurchaseOrderView / …Detail / GoodsReceiptView г.м. (plain)
└── load-data.ts      loadPurchaseOrders / …Detail / loadGoodsReceipts /
                      loadUnallocatedCostLines / loadProcurementDashboard

lib/actions/procurement.ts   PO CRUD + approve/cancel/close/reopen, GR
                             create/update/confirm/reverse/delete,
                             createApInvoiceFromPo, панелийн getter-ууд,
                             fetchOfficialRate, getLandedCostSummary
lib/cash/exchange-rates.ts   pickOfficialRate (цэвэр) + getOfficialRateForDate
                             — Монголбанкны албан ханш огноогоор (СУУРЬ ханш)
lib/costing/posting-helpers.ts  costing.ts-ээс ЗӨӨСӨН нийтлэг туслахууд
                                (itemAccountsFor, costingPostingCodeBuilder…)
```

Хатуу дүрмүүд:

- **Дансны дугаар кодод хатуу бичихийг хориглоно** — `clearingAccountNumber`
  (бараа мат. түр данс), `apClearingAccountNumber` (өглөгийн түр данс, default
  31000099), `fxGain/fxLossAccountNumber`, барааны нөөц/COGS нь
  `costing_item_settings`-ээс (JPR-006)
- **Бараа ХҮЛЭЭН АВСАН ӨДРИЙН албан ханшаар үнэлэгдэнэ** — нэхэмжлэх өөр
  ханштай байсан ч өмнөх капитализаци хөндөгдөхгүй; зөрүү нь PO хаалтад
  ханшийн олз/гарз болж ГАРНА (өртөгт шингэхгүй)
- **Ханш ХЭЗЭЭ Ч зохиогдохгүй** — `getOfficialRateForDate` олдохгүй бол
  ШИДНЭ, хэрэглэгч гараар оруулна
- **`po_receipt` хөдөлгөөнийг бараа материалын модулиас засах/устгах/цуцлах
  ХОРИОТОЙ** — зөвхөн Хангамж → Хүлээн авалт дээрээс буцаана. `/costing`-ийн
  гар үнэ оруулах жагсаалтад ч, `runCosting`-ийн receiptCosts-д ч ОРОХГҮЙ
  (аль хэдийн үнэлэгдсэн)
- **Бүх бичилт `businessObjectType: "purchase_order"` + `businessObjectId`-тай**
  байна (бичих мөчид, lineage-аас гаргаж авахгүй) — хоёр түр данс PO
  объектоороо тэгширнэ (FR-PROC-004)
- **Хуваарилалтын "үнийн дүнгээр" суурийн жин = PO мөрийн нийт үнэ** (D6 = (а)):
  өмнө хуваарилсан `landed_cost` жинд ОРОХГҮЙ → дарааллаас хамаарахгүй.
  Суурь урьдчилан СОНГОГДОХГҮЙ (OD-017), `manual`-д Σ таарахгүй бол хадгалахгүй
- **PO хаалтын нөхцөл** (`poCloseBlockers`): Σ хүлээн авсан = захиалсан, Σ
  нэхэмжилсэн тоо = захиалсан, Σ нэхэмжилсэн дүн (PO валют) = мөрийн дүн, бүх
  нэмэлт зардал хуваарилагдсан. Зөрүүг АВТОМАТААР нөхөхийг хориглоно — UI-д
  улаанаар харагдана
- **Дутуу хаалт** (ENT-064, `poShortClosePlan`, docs/cost 1.1): бараа бүрэн
  ирэхгүй бол `closePurchaseOrder({shortClose:{reason, writeOffAccount}})` /
  AI `close_purchase_order {shortClose}` / панелийн «Дутуу хаах» — `proc:post`,
  шалтгаан ЗААВАЛ (аудит, `short_close_reason`); хүлээн аваагүй үлдэгдэл
  `cancelled_quantity`; хүлээн авснаас илүү нэхэмжлэл → хэрэглэгчийн ИЛ
  сонгосон 6/7/8 зардлын данс (`poWriteOffAccountProblem`, кодод данс БАЙХГҮЙ),
  ханшийн зөрүү үүнийг хассан өглөгийн түр данснаас. Хүлээн авсан ч
  нэхэмжлээгүй бараа → ХОРИГЛОНО. Нэхэмжлэхийн тааз захиалсан тоо хэвээр,
  хүлээн авснаас илүүд анхааруулга (D-SC-2). Дахин нээхэд цуцлалт сэргэнэ
- **Нээлттэй PO-той сар хаалт** `costing_account_settings.open_po_close_mode`:
  `block` (default) | `warn` — хэсэгчлэн хүлээн авсан PO-той сарыг анхааруулгатай
  хаана (SIM2-023). Ноорог GR-ийг `delete_goods_receipt`; PO цуцлахад ноорог GR устна
- **Сар хаалт:** хүлээн авалттай нээлттэй PO байвал `closePeriod` код
  `open-purchase-orders`-оор татгалзана; ноорог хүлээн авалт бусад ноорогтой
  адил хаалтыг хориглоно (OD-011)
- Бичилтийн зам бүрд `assertPeriodOpen(orgId, date)` + транзакц дотор
  `assertPeriodOpenInTx` ПЕРВЫЙ; эрх `requireModuleAction("proc", …)`; статус
  шилжилт бүрд `logAuditEvent`
- **Хавсралт** нь нийтлэг `document_attachments` (entityType `purchase_order`,
  дараа бусад модульд ч); унших/татах зам ЗААВАЛ org шалгалттай (ID нь эрх
  олгохгүй); хаагдсан PO-д нэмж болно, устгахгүй
- **UI:** модулийн түлхүүр `proc` (`lib/constants/app-modules.ts`), нав бүлэг
  `procurement` (`components/layout/modules.ts` — самбар / Захиалга / Хүлээн
  авалт / Тайлан; "Хуваарилагдаагүй зардал" нь Өртөг модулийн Зардлын
  хуваарилалт табд `/costing/allocations` — хуучин `/procurement/costs` ба
  `/costing/unallocated` redirect хийнэ), панель `purchase-order` ба
  `goods-receipt`
  (`panel-registry.tsx`). Хүснэгт `DataGridDynamic`, статус `StatusBadge`,
  шүүлтүүр `FilterChips` / `PageTabs`, хоосон `EmptyState`, icon `Icon` /
  `IconAction`, батлах диалог `useConfirm` — шинэ component/icon бичихийг
  ХОРИГЛОНО; жагсаалт дээр давхар даралт → панель
