"use client";

// eTax — НӨАТ-ын тайланг ТЕГ-д тушаахад бэлтгэх хуудас (docs/dev/etax.md). Урсгал:
// бодолт (/tax/vat) → «Бэлтгэх» (ноорог snapshot + шалгалт) → хүн хянаад «Бэлэн» →
// etax.mta.mn-д тушаагаад ТЕГ-ийн дугаараар «Тушаасан» → «Хүлээн авсан» / «Буцаасан».
// Дүн энд бодогдохгүй, ТЕГ рүү юу ч илгээгдэхгүй (албан API спек ирээгүй).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { EtaxConnectionSettings } from "@/components/tax/etax-connection-settings";
import { TaxPageHeader, TaxStatCard } from "@/components/tax/tax-info";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/link-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { prepareEtaxVatReturn, setEtaxSubmissionStatus } from "@/lib/actions/etax";
import { fmtDateTimeUb } from "@/lib/format/datetime";
import { fmtMnt } from "@/lib/grid/formatters";
import { col } from "@/lib/grid/columnTypes";
import { ETAX_FORMS, ETAX_STATUS_LABELS, type EtaxSubmissionStatus } from "@/lib/itc/etax/constants";
import { canTransition } from "@/lib/itc/etax/submission";
import type { EtaxPageData, EtaxSubmissionView } from "@/lib/itc/etax/types";
import { fmtPeriodLabelMn } from "@/lib/periods/period";
import { ETAX_STATUS_TONES } from "@/lib/status";
import { feedback } from "@/lib/ui/feedback";

export function EtaxView({
  data,
  isAdmin,
  canWrite,
  canPost,
}: {
  data: EtaxPageData;
  isAdmin: boolean;
  canWrite: boolean;
  canPost: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [taxReference, setTaxReference] = useState(data.current?.taxReference ?? "");
  const [note, setNote] = useState("");
  const { current, live, periodCode } = data;
  const amounts = current?.snapshot.amounts ?? live;
  const form = ETAX_FORMS.vat;

  function prepare() {
    startTransition(async () => {
      const { error, created, revertedToDraft, submission } = await prepareEtaxVatReturn(periodCode);
      if (error || !submission) {
        feedback.error(error ?? "Бэлтгэж чадсангүй");
        return;
      }
      const errors = submission.validation?.errors.length ?? 0;
      feedback.saved(
        `${created ? "Ноорог үүслээ" : "Дахин бодлоо"}${revertedToDraft ? " — дүн зөрсөн тул ноорог руу буцав" : ""}${errors ? `; шалгалтын алдаа ${errors}` : ""}`
      );
      router.refresh();
    });
  }

  function move(to: EtaxSubmissionStatus) {
    if (!current) return;
    if (to === "cancelled" && !window.confirm("Энэ илгээлтийг хүчингүй болгох уу?")) return;
    startTransition(async () => {
      const { error } = await setEtaxSubmissionStatus({ id: current.id, to, taxReference, note });
      if (error) feedback.error(error);
      else {
        feedback.saved(`Төлөв: ${ETAX_STATUS_LABELS[to]}`);
        setNote("");
      }
      router.refresh();
    });
  }

  const columns = useMemo<ColDef<EtaxSubmissionView>[]>(
    () => [
      { headerName: "Тайлант үе", field: "periodCode", width: 110, cellClass: "font-mono text-xs" },
      { headerName: "Маягт", field: "formCode", width: 100, cellClass: "text-xs" },
      {
        headerName: "Төлөв",
        field: "status",
        width: 130,
        valueGetter: (p) => (p.data ? ETAX_STATUS_LABELS[p.data.status] : ""),
        cellRenderer: (p: ICellRendererParams<EtaxSubmissionView>) =>
          p.data ? (
            <span className="flex h-full items-center">
              <StatusBadge tone={ETAX_STATUS_TONES[p.data.status] ?? "muted"} size="sm">
                {ETAX_STATUS_LABELS[p.data.status]}
              </StatusBadge>
            </span>
          ) : null,
      },
      col<EtaxSubmissionView>({ eaType: "readonly-money", headerName: "Төлөх НӨАТ", colId: "payable", width: 130, valueGetter: (p) => p.data?.snapshot.amounts.payableVat ?? 0 }),
      col<EtaxSubmissionView>({ eaType: "readonly-money", headerName: "Шилжүүлэх", colId: "refundable", width: 120, valueGetter: (p) => p.data?.snapshot.amounts.refundableVat ?? 0 }),
      { headerName: "ТЕГ №", field: "taxReference", width: 140, cellClass: "font-mono text-xs" },
      { headerName: "Тушаасан", colId: "submittedAt", width: 140, valueGetter: (p) => fmtDateTimeUb(p.data?.submittedAt) ?? "", cellClass: "text-xs" },
      { headerName: "Шинэчилсэн", colId: "updatedAt", width: 140, valueGetter: (p) => fmtDateTimeUb(p.data?.updatedAt) ?? "", cellClass: "text-xs" },
      { headerName: "Тэмдэглэл", field: "resultNote", minWidth: 200, flex: 1, cellClass: "text-xs text-[var(--ea-text-3)]" },
    ],
    []
  );

  const validation = current?.validation ?? null;
  const canReady = !!current && current.status === "draft" && (validation?.errors.length ?? 0) === 0 && !data.stale;
  const webUrl = data.connection?.webUrl ?? "https://etax.mta.mn";

  return (
    <>
      <TaxPageHeader
        title={`eTax — ${form.label} ${fmtPeriodLabelMn(periodCode)}`}
        subtitle="Entry-ийн бодолтыг ТЕГ-ийн маягтад бэлтгэж, хянаж, тушаалтыг бүртгэнэ. Дүн энд өөрчлөгдөхгүй — засвар нь журналд."
      />

      {!data.isVatPayer ? (
        <p className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--ea-border)", color: "var(--ea-text-3)" }}>
          Байгууллага НӨАТ төлөгч биш гэж тохируулагдсан — тайлан бэлтгэх шаардлагагүй байж болно (Тохиргоо → НӨАТ).
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TaxStatCard label="Гаралтын НӨАТ" value={fmtMnt(amounts.outputVat)} mono />
        <TaxStatCard label="Оролтын НӨАТ" value={fmtMnt(amounts.inputVat)} mono hint={amounts.carriedInVat ? `Шилжсэн кредит ${fmtMnt(amounts.carriedInVat)}` : undefined} />
        <TaxStatCard label="Төлөх НӨАТ" value={fmtMnt(amounts.payableVat)} mono tone={amounts.payableVat > 0 ? "danger" : undefined} hint={`Эцсийн хугацаа ${current?.snapshot.deadline ?? live.deadline}`} />
        <TaxStatCard label="Шилжүүлэх НӨАТ" value={fmtMnt(amounts.refundableVat)} mono tone={amounts.refundableVat > 0 ? "success" : undefined} />
      </div>

      <section className="space-y-3 rounded-lg border p-4" style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Энэ сарын илгээлт</h2>
            {current ? (
              <StatusBadge tone={ETAX_STATUS_TONES[current.status] ?? "muted"} size="sm">
                {ETAX_STATUS_LABELS[current.status]}
              </StatusBadge>
            ) : (
              <StatusBadge tone="muted" size="sm">
                Бэлтгээгүй
              </StatusBadge>
            )}
            {data.stale ? (
              <StatusBadge tone="warning" size="sm">
                Бодолт өөрчлөгдсөн — дахин бэлтгэнэ
              </StatusBadge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`${form.sourceHref}?period=${periodCode}`} icon="report">
              НӨАТ бодолт
            </LinkButton>
            {canWrite && (!current || current.status === "draft" || current.status === "ready") ? (
              <Button size="sm" onClick={prepare} disabled={isPending}>
                {current ? "Дахин бодох" : "Бэлтгэх (ноорог)"}
              </Button>
            ) : null}
          </div>
        </div>

        {current ? (
          <>
            <div className="text-xs text-[var(--ea-text-3)]">
              Хуулбар {fmtDateTimeUb(current.snapshot.computedAt) ?? "—"} · {current.snapshot.taxpayer.name || "—"} · Регистр{" "}
              {current.snapshot.taxpayer.registerNo ?? "—"} · Мөр: гаралт {current.snapshot.counts.outputLines}, оролт{" "}
              {current.snapshot.counts.inputLines}
            </div>
            {validation?.errors.length ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--ea-danger-fg)]">
                {validation.errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {validation?.warnings.length ? (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-[var(--ea-warning-fg)]">
                {validation.warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {current.resultNote ? <p className="text-xs text-[var(--ea-text-2)]">Тэмдэглэл: {current.resultNote}</p> : null}

            {current.status === "ready" ? (
              <p className="text-xs text-[var(--ea-text-2)]">
                Дараагийн алхам: etax.mta.mn → Тайлан → Тайлан тушаах хэсэгт {form.code} маягтыг дээрх дүнгээр бөглөж тоон
                гарын үсгээр баталгаажуулна. Хүлээн авсан дугаарыг доор бичиж «Тушаасан» гэж бүртгэнэ.
              </p>
            ) : null}

            {(canPost && (current.status === "ready" || current.status === "submitted")) || (canWrite && current.status !== "accepted") ? (
              <div className="grid gap-3 md:grid-cols-2">
                {current.status === "ready" ? (
                  <FormField label="ТЕГ-ийн хүлээн авсан дугаар" htmlFor="etax-ref" hint="eTax → Тайлангийн түүхээс">
                    <Input id="etax-ref" value={taxReference} onChange={(e) => setTaxReference(e.target.value)} />
                  </FormField>
                ) : null}
                {current.status === "submitted" || current.status === "ready" || current.status === "draft" ? (
                  <FormField label="Тэмдэглэл" htmlFor="etax-note" hint="Буцаасан бол ТЕГ-ийн шалтгаан (заавал)">
                    <Input id="etax-note" value={note} onChange={(e) => setNote(e.target.value)} />
                  </FormField>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {canWrite && canTransition(current.status, "ready") ? (
                <Button size="sm" onClick={() => move("ready")} disabled={isPending || !canReady}>
                  Бэлэн — хянасан
                </Button>
              ) : null}
              {canWrite && canTransition(current.status, "draft") ? (
                <Button size="sm" variant="outline" onClick={() => move("draft")} disabled={isPending}>
                  Ноорог руу
                </Button>
              ) : null}
              {canPost && canTransition(current.status, "submitted") ? (
                <Button size="sm" onClick={() => move("submitted")} disabled={isPending || !taxReference.trim()}>
                  Тушаасан гэж бүртгэх
                </Button>
              ) : null}
              {canPost && canTransition(current.status, "accepted") ? (
                <Button size="sm" onClick={() => move("accepted")} disabled={isPending}>
                  ТЕГ хүлээн авсан
                </Button>
              ) : null}
              {canPost && canTransition(current.status, "rejected") ? (
                <Button size="sm" variant="destructive" onClick={() => move("rejected")} disabled={isPending || !note.trim()}>
                  ТЕГ буцаасан
                </Button>
              ) : null}
              {canWrite && canTransition(current.status, "cancelled") ? (
                <Button size="sm" variant="ghost" onClick={() => move("cancelled")} disabled={isPending}>
                  Хүчингүй болгох
                </Button>
              ) : null}
              <a
                href={webUrl}
                target="_blank"
                rel="noreferrer"
                className="ea-interactive inline-flex h-7 items-center rounded-md border border-[var(--ea-border-strong)] px-2.5 text-[0.8rem] text-[var(--ea-text-2)]"
              >
                etax.mta.mn нээх
              </a>
            </div>
          </>
        ) : (
          <p className="text-xs text-[var(--ea-text-3)]">
            {canWrite
              ? "«Бэлтгэх» дарахад НӨАТ-ын бодолтын хуулбар (snapshot) үүсч шалгагдана; дүн журналаас л өөрчлөгдөнө."
              : "Тайлан бэлтгэх эрх (Татвар — бичих) шаардлагатай."}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Илгээлтийн түүх</h2>
        <DataGridDynamic<EtaxSubmissionView>
          rowData={data.history}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height={320}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      </section>

      {isAdmin ? <EtaxConnectionSettings connection={data.connection} /> : null}
    </>
  );
}
