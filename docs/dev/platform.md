# Платформ: багц/billing, дэмжлэгийн хандалт, нууц үг сэргээх

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (Гол дүрэм). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

- **Billing / entitlement** (`docs/billing/00-proposal.md` — ЗААВАЛ уншина;
  `lib/billing/`): багц кодод (`plans.ts`: trial/standard/platform/enterprise/
  dedicated — боломж, хязгаар, үнэ), байгууллагын ялгаа
  `organization_subscriptions` (planId, status, seats, trialEndsAt,
  currentPeriodEnd, overrides JSON, pricePerSeatMnt). ЦЭВЭР шийдвэр `entitlements.ts`
  (`resolveEntitlements`, тесттэй), DB `load.ts`, **шалгах цэг ЗӨВХӨН
  `guards.ts`**: `assertWritesAllowed` (requireModuleAction write/post-д НЭГ
  цэгээс — read-only багцад `[SUBSCRIPTION_READ_ONLY]`), `requireFeature`
  (REST `api.rest` → 402, MCP `mcp` → -32003, eBarimt enqueue
  алгасна), `assertSeatAvailable` (урилга), `assertCompanyCreatable`
  (multi_company + компанийн тоо), `assertModuleEntitlements` (requireModuleAction —
  `accounting` боломж + бичих эрх, entitlement-ийг НЭГ удаа уншина).
  Код даяар `if plan === …` ХОРИОТОЙ.
  **Нягтлан бодох ажлыг дунд нь блоклохгүй**: унших, тайлан, экспорт, сар
  хаах (`requireRole`) үргэлж. Мөргүй SaaS байгууллага = trial 14 хоног;
  past_due grace 14 хоног; хүснэгт АНХ үүсэхэд preDeploy бүх байгууллагыг
  standard/active нөхнө. dedicated горимд бүх боломж, хязгааргүй (DB
  хөндөхгүй). UI: `/settings/billing` (гишүүн бүр ХАРНА, засахгүй), топбарын
  баннер, `attention.ts` дохио (`subscription.trial_ending` / `read_only`),
  AI/MCP/REST `get_billing_overview` (унших — ижил loader).
  **ҮНЭ — ОГНООТОЙ, ГУРВАН давхарга** (`pricing.ts` ЦЭВЭР, тесттэй; доошоо
  дардаг): `plans.ts`-ийн default → `platform_plan_prices` ҮЕҮҮД (Console-оос,
  платформ даяар нэг) → `organization_subscriptions.pricePerSeatMnt`
  (харилцагчийн тусгай үнэ). Үе бүр `effectiveFrom … effectiveTo`
  (ХАМРУУЛСАН; null = хугацаагүй) мужтай тул анхны үнэ түүхэндээ үлдэж,
  ирээдүйн үнийг урьдчилан оруулна; `priceAtDate` нь тухайн өдрийг хамрах үеийг
  олно, БАЙХГҮЙ бол default руу шилжинэ (цоорхойг ЗОХИОЖ нөхөхгүй). Давхцлыг
  `planPriceChange` УРЬДЧИЛЖ барина: хугацаагүй өмнөх үе дээр шинэ үе хожуу
  эхэлбэл өмнөхийг автоматаар өмнөх өдрөөр хааж ИЛ мэдэгдэнэ, бусад давхцлыг
  ТАТГАЛЗАНА.
  `null` = ТОГТООГООГҮЙ (хэлэлцээрээр), 0₮ БИШ; хадгалагдсан null нь ИЛ
  цэвэрлэлт тул default руу БУЦАХГҮЙ. `/settings/billing`, `get_billing_overview`,
  Console гурвуул `resolveSeatPrice`-ээр НЭГ утга хардаг; сарын дүн =
  суудал × үнэ (`monthlyAmountMnt`, тодорхойгүй бол null — таамаглахгүй).
  **Багц ба ҮНЭ ЗАСАХ нь апп дотор БАЙХГҮЙ** — Entry Console `GET/PUT
  /api/platform/subscriptions` ба `/api/platform/plan-prices` (Bearer
  `ENTRY_PLATFORM_API_KEY`, timing-safe, зөвхөн saas; хаалга
  `lib/api/platform-auth.ts`, цөм `lib/billing/platform.ts` ба
  `lib/billing/pricing-store.ts`); SaaS харилцагч ба dedicated
  харилцагчийн удирдлага хоёулаа Console-д, апп дотор platform admin эрх
  ҮҮСГЭХГҮЙ (хольж хутгахгүй).
  Өөрчлөлт бүр аудитын мөрд (`subscription`).
  **QPay-ээр ӨӨРӨӨ төлөх** (`docs/billing/00-proposal.md` §6a — ЗААВАЛ уншина):
  `/settings/billing` эзэн/админ → skills/standard/platform, 1/3/6/12 сар
  (хөнгөлөлтгүй) → Entry-ийн ӨӨРИЙН QPay мерчант (`ENTRY_BILLING_QPAY_*` env,
  харилцагчийн POS QPay-тэй ХОЛБООГҮЙ) → webhook `/api/billing/qpay/webhook`
  эсвэл [Шалгах] → `markBillingPaymentPaid` НЭГ транзакцаар subscription
  `active` + `currentPeriodEnd` сунгана. ЦЭВЭР `lib/billing/self-pay.ts`
  (тесттэй), DB `payment-store.ts`. `active` + өнгөрсөн `currentPeriodEnd` =
  `past_due` (grace `graceDaysFor`: skills 3, бусад 14). Идэвхтэй хугацаанд
  багц/суудал солихгүй (пропорц зохиохгүй); read-only үед ч төлнө
  (`requireRole`, assertWritesAllowed-гүй); мөнгө хэзээ ч алдагдахгүй
  (хугацаа дууссан нэхэмжлэхэд ирсэн webhook ч `paid`). Console: `GET
  /api/platform/billing-payments` (бүх төлбөр, QR/нууцгүй — `platform-payments.ts`)
  **Туршилтын funnel** (Console): `GET /api/platform/trial-funnel[?from&to&product=
  accounting|skills]` — [from,to] мужид үүссэн байгууллагын когорт (default 90 хоног,
  ≤366): бүртгүүлсэн → AI холбосон (анхны OAuth/token) → мастер дата (анхны
  харилцагч/бараа/ажилтан; POS «Бэлэн худалдан авагч», цалингийн «Ажилчид» seed ХАСАГДАНА)
  → анхны журнал → төлсөн (анхны `paid` төлбөр, эсвэл Console-оос идэвхжүүлсэн).
  ДАРААЛСАН тоо + дараалал алгассан (`reachedAnyOrder`), хувь, медиан цаг, байгууллага
  бүрийн мөр; демо ба эзний НЭМЭЛТ компани когортод орохгүй; skills нь богино funnel.
  ЦЭВЭР `lib/platform/trial-funnel.ts` (тесттэй), DB `trial-funnel-store.ts` (НЭГ асуулга)
- **Дэмжлэгийн хандалт** (`docs/deployment/support-access.md` — ЗААВАЛ уншина;
  `lib/platform/support.ts` ЦЭВЭР + `support-store.ts` DB): платформын оператор
  харилцагчийн байгууллагад ТҮР орох цорын ганц зам. Эрх нь ХЭРЭГЛЭГЧИД биш
  **СЕССЭД** уягдана — апп дотор супер админ РОЛЬ, платформын хуудас БАЙХГҮЙ
  (дээрх дүрэм хэвээр). Линкийг ЗӨВХӨН Console олгоно (`POST /api/platform/
  support-sessions`, Bearer + saas-only), НЭГ хэрэглэгчид и-мэйлээр уягдана
  (данс ЗОХИОХГҮЙ), DB-д зөвхөн sha256 hash. Хоёр хугацаа: ашиглагдаагүй линк
  15 мин, идэвхжсэн сесс 1 цаг (дахин орох СУНГАХГҮЙ). Түвшин `viewer` (default,
  зөвхөн унших) | `admin`; **`owner` ХЭЗЭЭ Ч олгогдохгүй** тул байгууллага
  устгах / эзэмшил шилжүүлэх нь харилцагчийнхаа мэдэлд үлдэнэ; багцын
  read-only давамгайлна. `getActiveOrg` нь cookie (`ea-support`) хүчинтэй үед
  scope-оо ТЭР байгууллага болгоно; `getMyOrgs` ганц мөр (өөрийн байгууллага
  руу санамсаргүй бичихээс); MCP/REST token-ий зам ХЭРЭГЛЭХГҮЙ. Орох/гарах
  бүр `audit_events` (`support_session`) + эзэн/админд `security.support_access`
  instant мэдэгдэл — **дэмжлэгийн хандалт ХЭЗЭЭ Ч чимээгүй болохгүй**; топбарт
  ил баннер. Console-ийн байгууллагын дэлгэрэнгүй `GET /api/platform/
  organizations?id=` (`lib/platform/org-detail.ts`) — ЗӨВХӨН унших, нууц үг /
  token / лого / бизнесийн бичилт буцаахгүй. Тест `tests/support-session.test.ts`
- **Нууц үг сэргээх, и-мэйл баталгаажуулалт** (`lib/actions/account-recovery.ts`,
  `lib/account/`): token нь DB-д sha256 hash, нэг удаагийн, хугацаатай
  (сэргээх 1 цаг, баталгаажуулах 24 цаг — `AUTH_TOKEN_TTL_MS`); хуучин
  token дахин олгоход хүчингүй. **Баталгаажуулалт нэвтрэлтийг ХЭЗЭЭ Ч
  хаахгүй** — зөвхөн баннер + «Дахин илгээх»; багана нэмэгдэхээс өмнөх
  хэрэглэгч preDeploy-д нөхөгдсөн, урилгаар ирсэн / и-мэйл тохируулаагүй
  deploy-д бүртгүүлсэн хүн шууд баталгаажсан. Сэргээх хүсэлт хаяг
  байгаа эсэхийг задлахгүй (enumeration); rate limit 3/15 мин. Хуудас
  `/reset-password`, `/verify-email` нэвтрэлтгүй (proxy.ts
  `isPublicAccountPage`); системийн и-мэйл `lib/email/transactional.ts`
  (Resend тохируулаагүй бол `unconfigured`, шидэхгүй)
