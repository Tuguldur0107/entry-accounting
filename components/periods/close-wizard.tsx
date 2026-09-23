"use client";

// Сар хаалтын wizard — CLAUDE.md §4 monthly close дарааллыг нэг дэлгэцэнд.
// Алхам бүр өөрийн баталгаажсан action-ыг дуудна; шинэ бичилт бүгд НООРОГ
// үүсдэг тул (human-in-the-loop §9) энэ дэлгэц өөрөө юу ч шууд батлахгүй.

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Icon, type IconName } from "@/components/ui/icon";
import { runDepreciation } from "@/lib/actions/fa";
import { computeMonthlyCosting } from "@/lib/actions/costing-period";
import { closePeriod, reopenPeriod } from "@/lib/actions/periods";
import type { MonthEndChecklist, StepStatus } from "@/lib/actions/month-end";
import type { LedgerIntegrityResult } from "@/lib/gl/integrity";
import { fmtMnt } from "@/lib/grid/formatters";
import { fmtPeriodCode } from "@/lib/periods/period";

// Алхмын статус — Icon Kit-ийн semantic дүрс (текст glyph ✓/⚠ бичихгүй).
const STATUS_META: Record<StepStatus, { label: string; icon: IconName; color: string }> = {
  done: { label: "Бэлэн", icon: "success", color: "var(--ea-success-fg)" },
  attention: { label: "Анхаарах", icon: "warning", color: "var(--ea-warning-fg)" },
  pending: { label: "Хийгдээгүй", icon: "pending", color: "var(--ea-text-3)" },
  na: { label: "Хамааралгүй", icon: "minus", color: "var(--ea-text-3)" },
};

/**
 * Мөрийн урд «бэлэн / анхаарах / хүлээгдэж буй» дүрс. `inherit` — эцэг элемент
 * өнгөө аль хэдийн тавьсан (амжилт/аюулын текст) үед тэр өнгийг өвлөнө.
 */
function CheckMark({
  ok,
  pending = false,
  inherit = false,
}: {
  ok: boolean;
  /** false үед анхааруулга биш «хийгдээгүй» (бүдэг) дүрс. */
  pending?: boolean;
  inherit?: boolean;
}) {
  const name = ok ? "success" : pending ? "pending" : "warning";
  const color = ok
    ? "var(--ea-success-fg)"
    : pending
      ? "var(--ea-text-3)"
      : "var(--ea-warning-fg)";
  return (
    <Icon
      name={name}
      size="xs"
      className="mr-1 inline-block align-[-2px]"
      style={inherit ? undefined : { color }}
      label={ok ? "Бэлэн" : pending ? "Хийгдээгүй" : "Анхаарах"}
    />
  );
}

function Step({
  index,
  title,
  status,
  children,
  actions,
}: {
  index: number;
  title: string;
  status: StepStatus;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const meta = STATUS_META[status];
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Icon name={meta.icon} size="md" style={{ color: meta.color }} label={meta.label} />
          <h2 className="text-sm font-semibold">
            {index}. {title}
          </h2>
        </div>
        <span className="text-xs" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <div className="mt-2 text-sm" style={{ color: "var(--ea-text-3)" }}>
        {children}
      </div>
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function CloseWizard({
  periodCode,
  checklist,
  integrity,
}: {
  periodCode: string;
  checklist: MonthEndChecklist;
  integrity: LedgerIntegrityResult;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    fa,
    fx,
    costing,
    payroll,
    vat,
    procurement,
    pos,
    drafts,
    periodStatus,
    closedAt,
  } = checklist;
  const closed = periodStatus === "closed";
  // Хангамжийн хориг (docs/procurement шийдвэр #7) — closePeriod мөн ижил
  // нөхцөлөөр зогсоодог; энд товчийг урьдчилан идэвхгүй болгоно.
  const poBlocked = procurement.openOrdersWithReceipts > 0;
  // POS хориг (docs/pos §3.3 ⑦, §2.1 C1) — closePeriod-ийн `open-pos-shifts` /
  // `unvalued-movements`-тэй ижил нөхцөл; хасах үлдэгдэл нь өөрөө хориг биш
  // (unvalued-ээр илэрнэ).
  const posBlocked =
    pos.status === "attention" && (pos.openShifts > 0 || pos.unvaluedMovements > 0);
  const closeBlocked = drafts.total > 0 || poBlocked || posBlocked;

  function act(fn: () => Promise<string>) {
    startTransition(async () => {
      try {
        toast.success(await fn());
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Амжилтгүй боллоо");
      }
    });
  }

  const draftItems: { label: string; n: number; href: string }[] = [
    { label: "Журнал", n: drafts.journal, href: "/gl/journal" },
    { label: "Касс", n: drafts.cash, href: "/cash/transactions" },
    { label: "АР/АП", n: drafts.arap, href: "/receivables/documents" },
    { label: "Бараа", n: drafts.inventory, href: "/inventory/movements" },
    { label: "Элэгдэл", n: drafts.faDep, href: "/fa/depreciation" },
    { label: "Өртөг", n: drafts.costEntries, href: "/costing/entries" },
    {
      label: "Хүлээн авалт",
      n: drafts.goodsReceipts,
      href: "/procurement/receipts",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">
          Сар хаалт — {fmtPeriodCode(periodCode)}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ea-text-3)" }}>
          Алхмуудыг дарааллаар нь гүйцээгээд хамгийн сүүлд сараа хаана. Тооцоо
          бүр НООРОГ бичилт үүсгэдэг — та шалгаж баталсны дараа л GL-д орно.
        </p>
      </div>

      {closed ? (
        <div
          className="rounded-lg border p-4 text-sm"
          style={{
            borderColor: "var(--ea-success)",
            background: "var(--ea-surface)",
          }}
        >
          <span style={{ color: "var(--ea-success-fg)" }}>
            <CheckMark ok inherit />
            Энэ тайлант үе {closedAt ?? ""} хаагдсан.
          </span>{" "}
          Дахин нээх нь ил үйлдэл — зөвхөн засварын зайлшгүй шаардлагад.
        </div>
      ) : null}

      {/* Ledger integrity assertion — DB trigger-үүдийн давхар баталгаа.
          "Хэзээ ч зөрчигдөхгүй" нөхцөлүүд зөрчигдвөл хаалтын өмнө ил гарна. */}
      <div
        className="rounded-lg border p-4 text-sm"
        style={{
          borderColor: integrity.ok
            ? "var(--ea-border)"
            : "color-mix(in srgb, var(--ea-danger) 45%, transparent)",
          background: "var(--ea-surface)",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-[var(--ea-text-1)]">
            Ledger-ийн бүрэн бүтэн байдал
          </span>
          <span
            className="text-xs font-semibold"
            style={{
              color: integrity.ok
                ? "var(--ea-success-fg)"
                : "var(--ea-danger-fg)",
            }}
          >
            <CheckMark ok={integrity.ok} inherit />
            {integrity.ok ? "Зөрчилгүй" : "Зөрчилтэй"}
          </span>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--ea-text-3)" }}>
          {integrity.checkedVoucherCount} батлагдсан журнал шалгагдав — ΣДт=ΣКт
          болон мөр бүр Дт/Кт-ийн аль нэг талд гэсэн нөхцөлүүд.
        </p>
        {integrity.bothSidesLineCount > 0 && (
          <p className="mt-1 text-xs" style={{ color: "var(--ea-danger-fg)" }}>
            Дт, Кт хоёул бөглөгдсөн {integrity.bothSidesLineCount} мөр байна.
          </p>
        )}
        {integrity.unbalancedVouchers.length > 0 && (
          <ul className="mt-2 space-y-1">
            {integrity.unbalancedVouchers.map((voucher) => (
              <li key={voucher.id} className="text-xs">
                <span className="font-mono" style={{ color: "var(--ea-text-4)" }}>
                  {voucher.date}
                </span>{" "}
                <span style={{ color: "var(--ea-text-1)" }}>
                  {voucher.description}
                </span>{" "}
                <span style={{ color: "var(--ea-danger-fg)" }}>
                  зөрүү {fmtMnt(voucher.imbalance)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Step
        index={1}
        title="Үндсэн хөрөнгийн элэгдэл"
        status={fa.status}
        actions={
          !closed && fa.status !== "na" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  act(async () => {
                    const result = await runDepreciation({ month: periodCode });
                    // Хүлээгдэх алдаа нь УТГААР ирдэг (production дээр шидсэн
                    // мессеж далдлагддаг — lib/action-result.ts).
                    if (result.error !== undefined)
                      throw new Error(result.error);
                    return result.created > 0
                      ? `${result.created} хөрөнгийн элэгдлийн ноорог үүслээ`
                      : "Шинээр бодох элэгдэл алга (бүгд бодогдсон)";
                  })
                }
              >
                Элэгдэл бодох
              </Button>
              <LinkButton href="/fa/depreciation">Элэгдлийн жагсаалт</LinkButton>
            </>
          ) : null
        }
      >
        {fa.status === "na"
          ? "Идэвхтэй үндсэн хөрөнгө алга."
          : `Идэвхтэй хөрөнгө ${fa.activeAssets} · энэ сард батлагдсан ${fa.postedEntries}, ноорог ${fa.draftEntries}.`}
      </Step>

      <Step
        index={2}
        title="Валютын ханшийн тэгшитгэл"
        status={fx.status}
        actions={
          !closed && fx.status !== "na" ? (
            <LinkButton href="/cash/reconciliation">Тэгшитгэл хийх</LinkButton>
          ) : null
        }
      >
        {fx.status === "na" ? (
          "Валютын данс алга."
        ) : (
          <ul className="space-y-0.5">
            {fx.accounts.map((account) => (
              <li key={account.id}>
                <CheckMark ok={account.done} pending />
                {account.name} ({account.currency}) —{" "}
                {account.done
                  ? "сарын эцсээр тэгшитгэсэн"
                  : account.lastValuationDate
                    ? `сүүлд ${account.lastValuationDate}-нд тэгшитгэсэн`
                    : "тэгшитгэл хийгдээгүй"}
              </li>
            ))}
          </ul>
        )}
      </Step>

      <Step
        index={3}
        title="Бараа материалын өртөг тооцоо"
        status={costing.status}
        actions={
          !closed && costing.status !== "na" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  act(async () => {
                    const result = await computeMonthlyCosting(periodCode);
                    if (!result.ok)
                      throw new Error(
                        ("message" in result ? result.message : undefined) ??
                          `Өртөг тооцоо амжилтгүй (${result.code})`
                      );
                    return `Өртөг тооцогдлоо: шинээр ${result.valued}, өмнө нь ${result.alreadyValued}, тэг ${result.zeroValued}${result.blockers.length > 0 ? `, блоклогдсон ${result.blockers.length}` : ""}`;
                  })
                }
              >
                Өртөг тооцох
              </Button>
              <LinkButton href="/costing/entries">Өртгийн бичилтүүд</LinkButton>
              {costing.blocked > 0 ? (
                <LinkButton href="/costing/reports">Блокийн шалтгаан</LinkButton>
              ) : null}
            </>
          ) : null
        }
      >
        {costing.status === "na"
          ? "Энэ сард барааны хөдөлгөөн алга."
          : `Тооцогдсон ${costing.calculated}, блоклогдсон ${costing.blocked} · бичилт: батлагдсан ${costing.postedEntries}, ноорог ${costing.draftEntries}.`}
      </Step>

      <Step
        index={4}
        title="Цалингийн бичилт"
        status={payroll.status}
        actions={
          !closed && payroll.status !== "na" ? (
            <LinkButton href={`/payroll?period=${periodCode}`}>
              Цалин бодолт
            </LinkButton>
          ) : null
        }
      >
        {payroll.status === "na"
          ? "Идэвхтэй ажилтан алга."
          : `Идэвхтэй ажилтан ${payroll.activeEmployees} · бодолтын мөр ${payroll.lineCount} · GL журнал: ${
              payroll.voucherStatus === "none"
                ? "үүсээгүй"
                : payroll.voucherStatus === "draft"
                  ? "ноорог"
                  : "батлагдсан"
            }.`}
      </Step>

      <Step
        index={5}
        title="НӨАТ тооцоо"
        status={vat.status}
        actions={
          !closed && vat.status !== "na" ? (
            <LinkButton href={`/tax/vat?period=${periodCode}`}>НӨАТ тайлан</LinkButton>
          ) : null
        }
      >
        {vat.status === "na"
          ? "Энэ сард НӨАТ-ийн бичилт алга."
          : `Гаралт ${fmtMnt(vat.outputVat)} · оролт ${fmtMnt(vat.inputVat)} · ${
              vat.payableVat > 0
                ? `төлөх ${fmtMnt(vat.payableVat)} (${vat.deadline} дотор)`
                : `шилжүүлэх ${fmtMnt(vat.refundableVat)}`
            } · тооцооны журнал: ${
              vat.settlementStatus === "none"
                ? "үүсээгүй"
                : vat.settlementStatus === "draft"
                  ? "ноорог"
                  : "батлагдсан"
            }.`}
      </Step>

      <Step
        index={6}
        title="Хангамж — захиалгын хаалт"
        status={procurement.status}
        actions={
          !closed && procurement.status !== "na" ? (
            <>
              <LinkButton href="/procurement/orders?status=open">
                Нээлттэй захиалгууд
              </LinkButton>
              {procurement.unallocatedCostLines > 0 ? (
                <LinkButton href="/costing/allocations">
                  Хуваарилагдаагүй зардал
                </LinkButton>
              ) : null}
              {procurement.draftReceipts > 0 ? (
                <LinkButton href="/procurement/receipts">
                  Хүлээн авалтууд
                </LinkButton>
              ) : null}
            </>
          ) : null
        }
      >
        {procurement.status === "na"
          ? "Энэ сард худалдан авалтын захиалга алга."
          : poBlocked
            ? `Энэ сард хүлээн авалттай нээлттэй захиалга (PO) ${procurement.openOrdersWithReceipts} байна — эхлээд PO-г хаана уу. Хуваарилагдаагүй зардлын мөр ${procurement.unallocatedCostLines}, батлагдаагүй хүлээн авалт ${procurement.draftReceipts}.`
            : `Хүлээн авалттай нээлттэй захиалга алга · хуваарилагдаагүй зардлын мөр ${procurement.unallocatedCostLines} · батлагдаагүй хүлээн авалт ${procurement.draftReceipts}.`}
      </Step>

      <Step
        index={7}
        title="POS / Бараа материал"
        status={pos.status}
        actions={
          !closed && pos.status !== "na" ? (
            <>
              {pos.openShifts > 0 ? (
                <LinkButton href="/inventory/shifts">Нээлттэй ээлжүүд</LinkButton>
              ) : null}
              {pos.negativeStockScopes > 0 ? (
                <LinkButton href="/inventory">Хасах үлдэгдэл</LinkButton>
              ) : null}
              {pos.unvaluedMovements > 0 || pos.provisionalCogs !== 0 ? (
                <LinkButton href="/costing/reports">Өртгийн тайлан</LinkButton>
              ) : null}
            </>
          ) : null
        }
      >
        {pos.status === "na" ? (
          "Энэ сард POS борлуулалт алга."
        ) : (
          <ul className="space-y-0.5">
            <li>
              <CheckMark ok={pos.openShifts === 0} />
              Нээлттэй ээлж {pos.openShifts}
              {pos.openShifts > 0 ? " — эхлээд ээлжээ хаана уу (хаалтын хориг)." : "."}
            </li>
            <li>
              <CheckMark ok={pos.negativeStockScopes === 0} />
              Хасах үлдэгдэлтэй бараа×агуулах{" "}
              {pos.negativeStockScopes}
              {pos.negativeStockScopes > 0
                ? " — орлого эсвэл тооллого бүртгээд өртгөө дахин тооцно уу."
                : "."}
            </li>
            <li>
              <CheckMark ok={pos.unvaluedMovements === 0} />
              Сарын өртөгт үнэлэгдээгүй хөдөлгөөн{" "}
              {pos.unvaluedMovements}
              {pos.unvaluedMovements > 0 ? " — Өртөг тооцох алхмыг гүйцээнэ үү (хаалтын хориг)." : "."}
            </li>
            <li>
              Урьдчилсан COGS {fmtMnt(pos.provisionalCogs)} — сар хаалтын залруулгаар
              эцсийн дундажид тэнцүүлнэ.
            </li>
          </ul>
        )}
      </Step>

      <Step
        index={8}
        title="Ноорог цэвэрлэгээ"
        status={drafts.total === 0 ? "done" : "attention"}
      >
        {drafts.total === 0 ? (
          "Энэ сард ноорог бичилт үлдээгүй — хаахад бэлэн."
        ) : (
          <span>
            Нийт {drafts.total} ноорог үлдсэн (батлах эсвэл устгах):{" "}
            {draftItems
              .filter((item) => item.n > 0)
              .map((item, index) => (
                <span key={item.label}>
                  {index > 0 ? " · " : ""}
                  <Link
                    href={item.href}
                    className="underline"
                    style={{ color: "var(--ea-primary)" }}
                  >
                    {item.label} {item.n}
                  </Link>
                </span>
              ))}
          </span>
        )}
      </Step>

      <Step
        index={9}
        title="Тайлант үе хаах"
        status={closed ? "done" : closeBlocked ? "attention" : "pending"}
        actions={
          closed ? (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                act(async () => {
                  const result = await reopenPeriod(periodCode);
                  if (!result.ok) throw new Error(`Нээгдсэнгүй (${result.code})`);
                  return `${periodCode} дахин нээгдлээ`;
                })
              }
            >
              Дахин нээх
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={isPending || closeBlocked}
              onClick={() =>
                act(async () => {
                  const result = await closePeriod(periodCode);
                  if (!result.ok)
                    throw new Error(
                      result.code === "has-drafts"
                        ? "Ноорог бичилт үлдсэн байна — эхлээд цэвэрлэнэ үү"
                        : result.code === "open-purchase-orders"
                          ? "Энэ сард хүлээн авалттай нээлттэй захиалга (PO) байна — эхлээд PO-г хаана уу."
                          : result.code === "open-pos-shifts"
                            ? "Нээлттэй кассын ээлж байна — Бараа материал → Борлуулалт → Ээлж дээр хаана уу."
                            : result.code === "unvalued-movements"
                              ? "Сарын өртгийн тооцоололд ороогүй буюу зогссон (хасах үлдэгдэл г.м.) бараа хөдөлгөөн байна — Өртөг → Сарын өртөг тооцоод засна уу."
                          : result.code === "previous-open"
                          ? "Өмнөх тайлант үе нээлттэй байна — тайлант үеийг дарааллаар нь хаана уу."
                          : result.code === "hook-rejected"
                            ? result.reason
                            : `Хаагдсангүй (${result.code})`
                    );
                  return `${periodCode} тайлант үе хаагдлаа`;
                })
              }
            >
              Сар хаах
            </Button>
          )
        }
      >
        {closed
          ? "Хаагдсан — энэ сар руу шинэ бичилт орохгүй."
          : drafts.total > 0
            ? "Ноорог үлдсэн тул хаах товч идэвхгүй."
            : poBlocked
              ? "Хүлээн авалттай нээлттэй захиалга (PO) үлдсэн тул хаах товч идэвхгүй."
              : posBlocked
                ? pos.openShifts > 0
                  ? "Нээлттэй кассын ээлж үлдсэн тул хаах товч идэвхгүй."
                  : "Сарын өртөгт үнэлэгдээгүй бараа хөдөлгөөн үлдсэн тул хаах товч идэвхгүй."
                : "Хаасны дараа энэ сарын бичилт түгжигдэнэ (дахин нээх боломжтой)."}
      </Step>
    </div>
  );
}
