# DB өгөгдлийн бүтэц (Drizzle / PostgreSQL)

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (DB өгөгдлийн бүтэц). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

## DB өгөгдлийн бүтэц (Drizzle / PostgreSQL)

Бүх хүснэгт `userId`-аар хамгаалагдсан (нэг хэрэглэгч = нэг компани).
`users.welcome_dismissed_at` — нүүрний анхны туршилтын картыг хаасан мөч (§9a).
Дэлгэрэнгүйг `lib/db/schema.ts`-ээс уншина — доор нь зөвхөн бүлэглэл.

```
Цөм        users, chart_of_accounts, segment_configs, segment_values,
           module_configs, accounting_periods
             segment_values.linkedOrganizationId — S1/S6-ийн утга аль
               байгууллагаас автоматаар бүрдсэн бэ (§3a); null = гараар оруулсан
GL         journal_vouchers, journal_lines, document_counters
             journal_vouchers.documentNo — ЖУРНАЛЫН БИЧИЛТИЙН ДУГААР
               "<МОДУЛЬ>-<YY>-<NNNNNN>" (§2a); хуучин бичилтэд NULL
             document_counters (organization_id, scope) — дугаарын АТОМИК
               тоолуур; scope = "GL-26" г.м.
             journal_lines.costEntryId / inventoryMovementId — дэд дэвтрийн
             эх сурвалж (Source → Movement → Cost → GL мөр → Журнал)
             journal_lines.businessObjectType / businessObjectId — клирингийн
             түлхүүр (PO), бичих МӨЧИД тавигдана
             journal_vouchers.currency / exchangeRate / rateSource / rateDate +
               journal_lines.debitFc / creditFc — баримтын ВАЛЮТ (§2b);
               MNT баримтад "MNT" / 1 / 0
Cash       cash_accounts, cash_documents, bank_statements,
           bank_statement_lines, cash_fx_revaluations
             cash_documents.counterpartyId — харилцагчийн БҮРТГЭЛИЙН холбоос
               (задаргаа: код/РД + нэр); `counterparty` текст нь нэр (бүртгэлгүй
               харилцагчид ч бичигдэнэ). Холбох дараалал `resolveCashCounterparty`
               (lib/actions/cash.ts): ил ID → нэхэмжлэхийн харилцагч → чөлөөт
               нэрээр ЯГ таарсан бүртгэл (`matchCounterpartyByName`, олон
               таарвал холбохгүй — ХОЛБООС ЗОХИОХГҮЙ). Банкны хуулга импорт мөн
               ижил дүрмээр холбоно. Харилцагч устгагдвал set null, нэр үлдэнэ
             cash_documents.cashFlowCode — МГ код (S8); МГ нэр нь segment_values(8)-ээс
               уншигдана, баримтад хадгалагдахгүй (нэр солигдвол дагана)
             cash_account_period_balances — хаалтын үлдэгдэл (дансны валютаар),
               период хаахад бичигдэж дахин нээхэд устдаг (snapshot + delta), exchange_rates
             exchange_rates — НИЙТИЙН лавлах: organizationId БАЙХГҮЙ (ханш нь
               нийтийн баримт), unique INDEX (source, currency, date) —
               constraint биш, drizzle-kit #5955-ийн улмаас (§5b); source
               mongolbank|tdb|golomt, date = ханшийн ӨӨРИЙН огноо (RATE_DATE),
               fetchedAt = хэзээ татсан (§5b)
             fx_revaluations.closingRate / rateSource / rateBasis / sourceDate /
               manualOverrideReason — тэгшитгэлийн ханшийн баримт
AR/AP      counterparties, ar_ap_documents, ar_ap_document_lines,
             documents.documentType ar_invoice|ap_bill|ar_credit_note|ap_debit_note;
               sourceDocumentId / lines.sourceLineId — кредит/дебит баримтын эх (§5d)
           ar_ap_settlements, arap_ecl_settings, arap_write_offs,
           arap_write_off_recoveries (ENT-065 §5e — хасалт нь settlement +
             voucher-той, сэргэлт нь хасалтын үлдэгдлийг бууруулна)
             settlements.cashDocumentId нь `on delete set null` тул кассын
               баримт rollback-гүй устсан үед мөр ӨНЧИН үлдэж нэхэмжлэх «төлөгдсөн»
               мэт харагддаг байв (хяналтын дансны ТОГТМОЛ зөрүү). Бичилтийн
               замууд (deleteCashDocument / reverseCashDocument /
               reverseArApOffset) rollback хийдэг; ӨМНӨХ мөрүүдийг preDeploy-ийн
               `scripts/cleanup-orphan-settlements.mjs` (идемпотент) нөхнө —
               өнчин = cashDocumentId ба voucherId ХОЁУЛАА null; цэвэр логик
               `scripts/lib/settlement-cleanup-plan.mjs` (тесттэй), GL хөндөхгүй
             documents.purchaseOrderId — PO-той нэхэмжлэх (→ өглөгийн түр данс)
             lines.purchaseOrderLineId / unitPrice / costComponentId
               (CHECK: itemId ба costComponentId зэрэг байж болохгүй)
             counterparties.code — ХАРИЛЦАГЧИЙН КОД: РД/ТТД-ээс ТУСДАА, org дотор
               давтагдашгүй (partial unique index, хоосон = давхардал биш),
               `normalizeCounterpartyCode` (ТОМ үсэг, ≤32) — автомат дугаарлалт
               ХИЙХГҮЙ (гараар / импортоор оноогдоно). Кассын "Харилцагчийн код"
               багана, AI list/create/update_counterparty, master data CSV (`code`)
             counterparties.tin — ТТД (татвар төлөгчийн дугаар, 11–14 орон):
               регистрээс ТУСДАА багана; ЦЭВЭР `normalizeTin` / `effectiveTin`
               (counterparty-kind.ts, тесттэй — хуучин мөрд регистрийн талбарт
               бичигдсэн ТТД-г preDeploy нөхнө, харагдацад ч өвлөнө). Картын
               «ТЕГ-ээс лавлах» (`lookupCounterpartyTaxpayer`: ТТД → нэр/НӨАТ
               төлөгч, байгууллагын регистр → ТТД) НЭГ удаа; POS кассын B2B ба
               AI `create_pos_sale` (customerTin өгөөгүй бол) картын ТТД-г шууд
               хэрэглэнэ — регистрээр лавлах 2026-06-15-аас хязгаарлагдсан.
               AI create/update/batch/list_counterparty `tin`, CSV `tin`
             counterparties.entityKind — СУБЪЕКТИЙН төрлийн КОД: систем
               "organization" (Байгууллага, default) | "individual" (Хувь хүн) ЭСВЭЛ
               байгууллагын НЭМСЭН `kind_<n>` (counterparty_entity_kinds: name,
               baseKind organization|individual, isActive; систем 2 төрөл мөргүй ч
               бий, устгагдахгүй — нэрийг л засна). Бизнесийн логик (регистрийн
               шалгалт, POS eBarimt B2B) ЗӨВХӨН `baseKindOf`-оор — шинэ төрлийн
               кодыг hardcode хийхгүй; хэрэглэгдэж буй төрөл устгагдахгүй
               (идэвхгүй болгоно). UI: Харилцагчид → «Төрөл». — `counterpartyType` (авлага/
               өглөгийн ЧИГЛЭЛ)-ээс ТУСДАА хэмжээс. ЦЭВЭР `lib/arap/counterparty-kind.ts`
               (тесттэй): шошго, `inferEntityKindFromRegisterNo` (иргэний РД
               = 2 кирилл + 8 орон → individual; 7/11/14 орон → organization;
               бусад null — таамаглахгүй), `registerNoMismatch` ЗӨВЛӨМЖ (хориг
               биш — гадаадын харилцагч). Форм: «Төрөл» = субъект, «Тооцоо» =
               чиглэл; регистрийн шошго төрлөөр. POS төлбөрийн диалог байгууллага
               харилцагчийн РД/ТТД-г eBarimt B2B-ээр урьдчилан бөглөнө. AI
               create/update/batch `entityKind`; CSV `entityKind`; preDeploy
               иргэний РД хэлбэртэй хуучин мөрийг individual болгож нөхнө
             counterparties.contactPerson / bankName / bankAccountNo
Хангамж    purchase_orders, purchase_order_lines, goods_receipts,
           goods_receipt_lines
             orders.status draft|open|closed|cancelled; closeVoucherId —
               түр дансдыг тэгшитгэсэн хаалтын журнал
             receipts.exchangeRate / rateSource / rateDate — хүлээн авсан
               өдрийн Монголбанкны албан ханш (барааны өртөг ҮҮГЭЭР)
             receipt_lines.movementId — үүсгэсэн орлогын хөдөлгөөн
Хавсралт   document_attachments — polymorphic (entityType: `purchase_order`,
           `goods_receipt`, `journal`, `cash`, `arap`, `inventory`, `fa` —
           аудитын entityType-тай ижил; whitelist
           lib/attachments/constants.ts ATTACHMENT_ENTITY_MODULE_KEYS),
           файл base64-аар, FK байхгүй тул устгалтыг модулийн delete зам
           deleteAttachmentsFor-оор ӨӨРӨӨ хийнэ; унших зам ЗААВАЛ org +
           модулийн эрхийн шалгалттай (арап нь ar/ap аль нэг эрхээр)
Inventory  inventory_items, warehouses, inventory_movements, inventory_categories,
           inventory_category_levels
             categories.parentId — ОЛОН ТҮВШИНТЭЙ мод (ЦЭВЭР
               lib/inventory/category-tree.ts, тесттэй): цикл/гүн хориг, устгах
               хориг (дэд ангилал/бараа/хөнгөлөлтийн дүрэм). УДАМШИЛ: эцэг ангиллын
               хөнгөлөлтийн дүрэм (CartLine.categoryPath), POS chip, борлуулалтын
               тайлангийн шүүлт дэд ангиллын бараанд ч; eBarimt ангилал хоосон бол
               өвөг рүү өгсөж өвлөнө (readiness + queue НЭГ дүрэм). Self-FK NO
               ACTION — байгууллагын cascade устгал бүх модыг нэг дор устгана
             category_levels (org, depth, name) — түвшний нэр; мөргүй бол
               default «Ерөнхий › Үндсэн › Дэд»; хамгийн багадаа 1, ашиглагдаж
               буй гүнээс доош хасахгүй. Хуудас: Бараа · Ангилал · Агуулах ТУСДАА
             items.barcodeType (GS1|ISBN|UNDEFINED → PosAPI barCodeType),
               description / brand / manufacturer / originCountry — барааны
               дэлгэрэнгүй карт (тооцоонд нөлөөгүй; Excel импортод хоосон нүд =
               өөрчлөхгүй)
             items.salesPrice — борлуулах үнэ (MNT, нэгжид, null = тогтоогоогүй):
               АР нэхэмжлэхэд бараа сонгоход нэгж үнэ автоматаар (байхгүй бол
               сүүлийн АР мөрийн unitPrice); өртөгтэй ХОЛБООГҮЙ, үнэ зохиохгүй
             movements.issueTypeId — зарлагын дебет чиглэл
             movements.sourceType `po_receipt` — хүлээн авалтын мөрөөс үүссэн
POS        pos_settings (рольын данс, walkInCounterpartyId, issueTypeId,
           provisionalCogs, allowNegativeStock, хөнгөлөлтийн хязгаар, бөөрөнхийлөл),
           pos_payment_methods (kind × cashAccountId × feePercent — ewallet
           settlement-ийн шимтгэл), pos_settings.ewalletFeeAccountNumber
           (шимтгэлийн зардал, default 73100008), pos_discount_rules,
           pos_shifts, pos_sales, pos_sale_lines (arApLineId / movementId /
           provisionalCostEntryId), pos_sale_discounts, pos_payments,
           pos_gift_cards, pos_store_credits; inventory_categories,
           item_price_history; inventory_items.salesPrice/barcode/vatMode…;
           counterparties.customerGroup/creditLimit; vat_settings.isVatPayer;
           ar_ap_documents / cash_documents .sourceType ("pos") + sourceId;
           cost_entries.trueUpOfEntryId, valuationSource "provisional_avg",
           entryType "cogs_true_up" (ТЭМДЭГТЭЙ дүн)
QPay       pos_settings.qpay{Enabled,ApiUrl,ApiKeyEnc,WebhookSecretEnc,MerchantId,
           InvoiceTtlSec} (нууц ШИФРТЭЙ), pos_payment_methods.provider ("qpay" |
           null — зөвхөн ewallet), pos_qpay_intents (org, shift, cashier, amount,
           cartSnapshot jsonb, status open|paid|finalized|cancelled|expired|failed,
           qpayInvoiceId/qrText/qrImage/urls, paymentId/paidAmount/paidAt,
           expiresAt, saleId, lastCheckAt, lastError; unique INDEX (org,
           qpayInvoiceId) where not null)
eBarimt    pos_settings.ebarimt{Enabled,MerchantTin,BranchNo,DistrictCode,PosNo,
           PosApiUrl,Mode} (мерчантын тохиргоо — нууц БАЙХГҮЙ),
           pos_payment_methods.ebarimtCode, inventory_items.ebarimt{Classification,
           TaxProduct}Code, inventory_categories.ebarimtClassificationCode,
           pos_sales.ebarimt{Id,Lottery,Status,QrData,Date,Type,ConsumerNo,CustomerTin},
           pos_ebarimt_submissions (дараалал — kind send|cancel, status pending|
           claimed|sent|failed|cancelled, payload/response jsonb, attempts,
           nextAttemptAt; partial unique (saleId, kind) pending|claimed)
Costing    cost_components, inventory_issue_types, costing_account_settings,
           costing_item_settings, cost_allocations, cost_allocation_lines,
           costing_runs, cost_entries, cost_period_results
             account_settings.apClearingAccountNumber — өглөгийн түр дансны
               шинэ роль (default 31000099)
             cost_entries.sourceLineId + businessObjectType/Id;
               valuationSource `po_receipt` | `ap_line`
             cost_allocations.sourceLineId / purchaseOrderId — нэхэмжлэхийн
               мөрөөс хийсэн хуваарилалт (Σ ≤ мөрийн MNT дүн)
FA         fixed_assets, fa_depreciation_entries, fa_settings
             fixed_assets.location / subLocation — байршил, дэд байршил
             fixed_assets.depreciationStartDate — ӨДРИЙН суурийн эхлэл
             fixed_assets.taxUsefulLifeMonths / taxDepreciationMethod — §7a
             fa_depreciation_entries.taxAmount (мэмо) / depreciatedDays
             fa_settings.depreciationBasis — "monthly" | "daily" (§7a)
VAT        vat_settings
Payroll    employees, payroll_settings, payroll_runs, payroll_run_lines
             run_lines.standardHours / workedHours — цагт суурилсан олголт
             run_lines.vacationPay / otherAdditions — нийт олголтод нэмэгдэнэ
             run_lines.advanceHours / advanceAmount — урьдчилгаа (§7)
             runs.advanceDate / advanceDocumentId / finalDocumentId — хоёр
               нэгтгэсэн өглөгийн нэхэмжлэх
             settings.standardMonthlyHours / employeePayableAccountNumber /
               employeeCounterpartyId
Audit      audit_events — статус шилжилт бүрд lib/audit.ts logAuditEvent
           (бизнесийн урсгалыг хэзээ ч унагахгүй); /settings/audit хуудас
Мэдэгдэл   notifications (хүлээн авагч × org, dedupeKey unique INDEX,
           readAt, emailedAt), notification_preferences (user × org, channels
           JSON, mutedUntil, telegramChatId/LinkCode), notification_runs (job ×
           periodKey × org unique — scheduler/digest булаалт),
           notification_deliveries (мэдэгдэл × суваг unique) — §9d;
           company_settings.largeAmountAlertMnt (D2 босго)
Багц       organization_subscriptions (planId, status, seats, trialEndsAt,
           currentPeriodEnd, overrides, pricePerSeatMnt — харилцагчийн ТУСГАЙ үнэ)
             billing_payments — багцын QPay төлбөр (§6a): plan/seats/months/amount,
               status open|paid|cancelled|expired|failed, qpayInvoiceId (partial
               unique INDEX), QR, paidAt, periodStart/End; org cascade
             platform_plan_prices — багцын үнийн ТҮҮХ, ПЛАТФОРМЫН лавлах
               (organizationId БАЙХГҮЙ). Мөр бүр = ОГНООНЫ МУЖ: effective_from
               (YYYY-MM-DD text) … effective_to (null = хугацаагүй), note;
               unique INDEX (plan_id, effective_from). Тухайн өдрийг хамрах үе
               байхгүй бол lib/billing/plans.ts-ийн default; price null = хэлэлцээрээр
Дэмжлэг   platform_support_sessions — платформын операторын ТҮР хандалт:
           token_hash (sha256, unique INDEX), user_id (линк НЭГ хүнд уягдана),
           role viewer|admin (owner БАЙХГҮЙ), expires_at (линк) · started_at →
           ends_at (сесс) · ended_at (гарсан), reason/issued_by — Console
Мэдлэг     knowledge_articles — НИЙТИЙН лавлах (organizationId БАЙХГҮЙ): slug ×
           section unique INDEX, category, title/heading/body, citation, modules
           jsonb, source_path, checksum (sha256 — seed алгасалт), sort_order.
           knowledge_reads (org, user, slug, section, created_at; org+time index)
           — 24ц квот + бөөнөөр татах илрүүлэлт, аудит БИШ (§9e)
Тохиргоо   company_settings.aiPostLimitMnt — AI/MCP/REST-ийн ШУУД БАТЛАХ дээд
           хязгаар (MNT, null = 10 сая ₮ default, §9); tool-оор өсгөхөд 1 тэрбум ₮ тааз
AI         ai_settings (write_mode л — §9a; ai_messages / ai_attachments 2026-09-25-нд
           архивлагдсан, removed-schema-objects)
Тайлан     report_line_mappings
             cfCodes — мөнгөн гүйлгээний тайлангийн S8 сегментийн кодууд
               (дансны таарцаас ТҮРҮҮЛЖ шалгагдана)
```
