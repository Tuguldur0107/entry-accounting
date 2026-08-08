"use client";

// НӨАТ-ийн сарын тайлангийн харагдац + тооцооны ноорог үүсгэх.
// Тооцооны журнал ЗААВАЛ ноорог үүсдэг (human-in-the-loop §9) — эндээс
// GL журнал руу орж шалгаад батална.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createVatSettlementDraft, type VatReturnData } from "@/lib/actions/vat";
import { fmtMnt } from "@/lib/grid/formatters";
import { fmtPeriodCode } from "@/lib/periods/period";

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | "success";
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: "var(--ea-border)",
        background: "var(--ea-surface)",
      }}
    >
      <div className="text-xs" style={{ color: "var(--ea-text-3)" }}>
        {label}
      </div>
      <div
        className="mt-1 font-mono text-xl font-semibold"
        style={{
          color:
            tone === "danger"
              ? "var(--ea-danger-fg)"
              : tone === "success"
                ? "var(--ea-success-fg)"
                : "var(--ea-text-1)",
        }}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs" style={{ color: "var(--ea-text-3)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function VatReturnView({
  periodCode,
  data,
}: {
  periodCode: string;
  data: VatReturnData;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    summary,
    settings,
    settlement,
    cashAccounts,
    yearSales,
    registrationThreshold,
  } = data;
  const [cashAccountId, setCashAccountId] = useState(
    cashAccounts[0]?.id ?? ""
  );

  function createSettlement() {
    startTransition(async () => {
      try {
        const result = await createVatSettlementDraft({
          periodCode,
          cashAccountId:
            summary.payableVat > 0 ? cashAccountId || undefined : undefined,
        });
        toast.success(
          result.dedup
            ? "Энэ сарын тооцоо аль хэдийн үүссэн байна"
            : "НӨАТ тооцооны ноорог журнал үүслээ — GL журналаас шалгаад батална уу"
        );
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Тооцоо үүсгэж чадсангүй"
        );
      }
    });
  }

  const hasActivity = summary.outputVat !== 0 || summary.inputVat !== 0;

  // НӨАТ-ийн бүртгэлийн босгын хяналт (2026: 400 сая ₮) — 80%-аас эхэлж
  // анхааруулна, давсан бол бүртгүүлэх үүрэгтэйг сануулна.
  const thresholdPercent =
    registrationThreshold > 0 ? (yearSales / registrationThreshold) * 100 : 0;
  const thresholdOver = thresholdPercent >= 100;
  const thresholdNear = !thresholdOver && thresholdPercent >= 80;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">
          НӨАТ тайлан — {fmtPeriodCode(periodCode)}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ea-text-3)" }}>
          Гаралтын данс {settings.outputVatAccountNumber} · Оролтын данс{" "}
          {settings.inputVatAccountNumber} · Хувь {settings.vatRatePercent}%
        </p>
      </div>

      {thresholdOver ? (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{
            borderColor:
              "color-mix(in srgb, var(--ea-danger) 40%, transparent)",
            background:
              "color-mix(in srgb, var(--ea-danger) 8%, var(--ea-surface))",
            color: "var(--ea-danger-fg)",
          }}
        >
          Оны борлуулалт {fmtMnt(yearSales)} — НӨАТ-ийн бүртгэлийн босго (400
          сая ₮) давсан — НӨАТ төлөгчөөр бүртгүүлэх үүрэгтэй.
        </div>
      ) : thresholdNear ? (
        <div
          className="rounded-lg border p-3 text-sm"
          style={{
            borderColor:
              "color-mix(in srgb, var(--ea-warning) 40%, transparent)",
            background:
              "color-mix(in srgb, var(--ea-warning) 8%, var(--ea-surface))",
            color: "var(--ea-warning-fg)",
          }}
        >
          Оны борлуулалт {fmtMnt(yearSales)} — НӨАТ-ийн бүртгэлийн босгын (400
          сая ₮) {Math.round(thresholdPercent)}%-д хүрсэн байна.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Гаралтын НӨАТ (борлуулалт)"
          value={fmtMnt(summary.outputVat)}
          hint={`${summary.outputLineCount} мөр`}
        />
        <SummaryCard
          label="Оролтын НӨАТ (худалдан авалт)"
          value={fmtMnt(summary.inputVat)}
          hint={`${summary.inputLineCount} мөр`}
        />
        {summary.refundableVat > 0 ? (
          <SummaryCard
            label="Буцаан авах / шилжүүлэх"
            value={fmtMnt(summary.refundableVat)}
            hint="Оролтын НӨАТ илүү — дараа сард шилжинэ"
            tone="success"
          />
        ) : (
          <SummaryCard
            label="Төлөх НӨАТ"
            value={fmtMnt(summary.payableVat)}
            hint={`Эцсийн хугацаа ${summary.deadline} — хоцорвол 0.1%/хоног`}
            tone={summary.payableVat > 0 ? "danger" : undefined}
          />
        )}
      </div>

      <div
        className="rounded-lg border p-4"
        style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}
      >
        <h2 className="text-sm font-semibold">Сарын тооцооны журнал</h2>
        {settlement ? (
          <p className="mt-2 text-sm" style={{ color: "var(--ea-text-3)" }}>
            {settlement.date} өдрийн тооцооны журнал{" "}
            <span className="font-medium" style={{ color: "var(--ea-text-1)" }}>
              {settlement.status === "draft"
                ? "ноорог"
                : settlement.status === "posted"
                  ? "батлагдсан"
                  : settlement.status}
            </span>{" "}
            төлөвтэй байна — GL журналын жагсаалтаас харна уу.
          </p>
        ) : !hasActivity ? (
          <p className="mt-2 text-sm" style={{ color: "var(--ea-text-3)" }}>
            Энэ сард НӨАТ-ийн дансдад бичилт алга.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {summary.payableVat > 0 ? (
              <div className="max-w-xs space-y-1.5">
                <Label>Төлбөр гарах банкны данс</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--ea-border)",
                    background: "var(--ea-bg)",
                    color: "var(--ea-text-1)",
                  }}
                  value={cashAccountId}
                  onChange={(event) => setCashAccountId(event.target.value)}
                >
                  {cashAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.glAccountNumber})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <Button onClick={createSettlement} disabled={isPending}>
              Тооцооны ноорог үүсгэх
            </Button>
            <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
              Ноорог журнал үүсгэнэ: Дт {settings.outputVatAccountNumber} / Кт{" "}
              {settings.inputVatAccountNumber}
              {summary.payableVat > 0 ? " / Кт банк (зөрүү)" : ""} — GL журналаас
              шалгаад Батлах дарна.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
