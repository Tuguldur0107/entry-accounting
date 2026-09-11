"use client";

// Нийлүүлэгчийн карт — PO панелийн толгойд харагдах лавлах хэсэг
// (docs/procurement 00-proposal.md §3.6a).
//
// ХАТУУ ДҮРЭМ: бүх талбар ХАРИЛЦАГЧИЙН бүртгэлээс (`counterparties`)
// уншигдана, захиалгад ДАХИН хадгалагдахгүй — нэг залруулга хаа сайгүй
// хүчинтэй. Тиймээс энд засах оролт БАЙХГҮЙ; өөрчлөх бол Харилцагчид руу
// үсэрнэ.
//
// Нээлттэй өглөг ба өмнөх захиалгын тоо нь панелийн `supplier` талбараас
// (getPurchaseOrderPanelData — гэрээ §6) сервер талд тооцогдож ирнэ.

import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { LinkButton } from "@/components/ui/link-button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CounterpartyView } from "@/lib/arap/types";
import { fmtAccountDisplay } from "@/lib/grid/segments";
import { fmtMnt } from "@/lib/reports/balances";

export type SupplierCardData = CounterpartyView & {
  /** Нээлттэй өглөгийн үлдэгдэл (MNT). */
  openPayableMnt: number;
  /** Өмнөх захиалгын тоо (ноорог, цуцлагдсаныг оролцуулан). */
  previousOrders: number;
};

export function SupplierCard({
  supplier,
  activeSegIds = [3],
  className,
}: {
  supplier: SupplierCardData | null;
  /** Дансны дугаарыг идэвхтэй сегментээр харуулах (default: зөвхөн S3). */
  activeSegIds?: number[];
  className?: string;
}) {
  if (!supplier)
    return (
      <div
        className={`rounded-md border border-dashed border-[var(--ea-border)] px-3 py-4 text-center text-xs text-[var(--ea-text-4)] ${
          className ?? ""
        }`}
      >
        Нийлүүлэгч сонгоход түүний холбоо барих, банк, төлбөрийн нөхцөл энд
        харагдана
      </div>
    );

  const payableAccount = fmtAccountDisplay(
    supplier.defaultPayableAccountNumber ?? "",
    activeSegIds
  );
  const bank = [supplier.bankName, supplier.bankAccountNo]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] ${
        className ?? ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--ea-border)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon name="company" size="sm" className="text-[var(--ea-text-3)]" />
            <span className="truncate text-sm font-semibold text-[var(--ea-text-1)]">
              {supplier.name}
            </span>
            {!supplier.isActive && (
              <StatusBadge tone="danger" size="sm">
                Идэвхгүй
              </StatusBadge>
            )}
          </div>
          {supplier.registerNo && (
            <div className="mt-0.5 text-[11px] text-[var(--ea-text-3)]">
              ТТД <span className="font-mono">{supplier.registerNo}</span>
            </div>
          )}
        </div>
        <LinkButton href="/payables/counterparties" icon="company">
          Харилцагчийн бүртгэл
        </LinkButton>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5 text-xs sm:grid-cols-3">
        <Row label="Холбоо барих">{supplier.contactPerson}</Row>
        <Row label="Утас" mono>
          {supplier.phone}
        </Row>
        <Row label="Имэйл">{supplier.email}</Row>
        <Row label="Хаяг">{supplier.address}</Row>
        <Row label="Банк, данс" mono>
          {bank}
        </Row>
        <Row label="Төлбөрийн нөхцөл">
          {supplier.paymentTermsDays > 0
            ? `${supplier.paymentTermsDays} хоног`
            : "Тухай бүрд"}
        </Row>
        <Row label="Валют" mono>
          {supplier.defaultCurrency}
        </Row>
        <Row label="Өглөгийн данс" mono>
          {payableAccount}
        </Row>
        <Row label="Нээлттэй өглөг" mono>
          <span
            className={
              supplier.openPayableMnt > 0
                ? "font-semibold text-[var(--ea-warning-fg)]"
                : undefined
            }
          >
            {fmtMnt(supplier.openPayableMnt)}
          </span>
        </Row>
        <Row label="Өмнөх захиалга" mono>
          {String(supplier.previousOrders)}
        </Row>
      </dl>
    </div>
  );
}

function Row({
  label,
  mono,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  const empty = children == null || children === "";
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-wide text-[var(--ea-text-4)]">
        {label}
      </dt>
      <dd
        className={`mt-0.5 truncate ${mono ? "font-mono" : ""} ${
          empty ? "text-[var(--ea-text-4)]" : "text-[var(--ea-text-1)]"
        }`}
      >
        {empty ? "—" : children}
      </dd>
    </div>
  );
}
