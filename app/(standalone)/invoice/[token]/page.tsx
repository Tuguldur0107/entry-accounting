// Нэхэмжлэхийн НЭЭЛТТЭЙ хуудас — харилцагч токентой линкээр нэвтрэлгүй үзнэ.
// Анхны нээлтээр viewedAt тэмдэглэгдэж "Үзсэн" төлөв болно.

import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";

import { loadInvoicePayload } from "@/lib/arap/invoice-payload";
import { db } from "@/lib/db";
import { arApInvoiceSends } from "@/lib/db/schema";

export const metadata = { title: "Нэхэмжлэх" };

const fmt = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/.test(token)) notFound();

  const send = await db.query.arApInvoiceSends.findFirst({
    where: and(eq(arApInvoiceSends.token, token), isNull(arApInvoiceSends.revokedAt)),
  });
  if (!send) notFound();

  // Хугацаа дууссан линк — нэхэмжлэхийн агуулга харагдахгүй.
  // Server Component тул хүсэлтийн агшны цагаар шалгах нь зорилготой.
  // eslint-disable-next-line react-hooks/purity
  const expired = send.expiresAt ? send.expiresAt.getTime() < Date.now() : false;
  if (expired) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Линкний хугацаа дууссан
        </h1>
        <p className="mt-2 text-sm text-[var(--ea-text-3)]">
          Энэ нэхэмжлэхийн линкний хүчинтэй хугацаа дууссан байна — илгээгчээс
          шинэ линк хүснэ үү.
        </p>
      </main>
    );
  }

  // Payload нь илгээлтийн БАЙГУУЛЛАГЫН хүрээнд уншигдана (userId нь createdBy).
  if (!send.organizationId) notFound();
  const invoice = await loadInvoicePayload(send.organizationId, send.documentId);
  if (!invoice) notFound();

  // "Үзсэн" — зөвхөн анхны нээлтийг тэмдэглэнэ.
  if (!send.viewedAt) {
    await db
      .update(arApInvoiceSends)
      .set({ viewedAt: new Date() })
      .where(eq(arApInvoiceSends.id, send.id));
  }

  const { company, counterparty } = invoice;
  const hasItems = invoice.lines.some((line) => line.itemName);
  const balance = invoice.totalAmount - invoice.paidAmount;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      {/* Цаасан баримтын хэв маяг — public тул үргэлж цайвар */}
      <div className="rounded-lg border border-[var(--ea-border)] bg-white p-8 text-black shadow-sm">
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-bold">{company.name}</div>
            <div className="text-xs text-neutral-500">
              {[
                company.registerNo && `Регистр: ${company.registerNo}`,
                company.address,
                company.phone,
                company.email,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          {company.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/png;base64,${company.logo}`}
              alt=""
              className="max-h-12 max-w-36 object-contain"
            />
          )}
        </div>

        <h1 className="mt-6 text-center text-xl font-bold uppercase tracking-widest">
          Нэхэмжлэх
        </h1>
        <p className="mb-6 text-center text-sm text-neutral-500">
          № {invoice.documentNo}
        </p>

        <div className="mb-6 flex flex-wrap justify-between gap-4 text-sm">
          <div>
            <div className="text-xs text-neutral-500">Худалдан авагч</div>
            <div className="font-semibold">{counterparty.name}</div>
            {counterparty.registerNo && (
              <div className="text-xs text-neutral-500">
                Регистр: {counterparty.registerNo}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-neutral-500">Огноо</div>
            <div className="font-mono">{invoice.date}</div>
            <div className="mt-1 text-xs text-neutral-500">Төлөх огноо</div>
            <div className="font-mono">{invoice.dueDate}</div>
          </div>
        </div>

        <table className="w-full border-t border-black text-sm">
          <thead>
            <tr className="border-b border-neutral-400 text-left text-xs">
              <th className="py-1.5 pr-2">№</th>
              <th className="py-1.5 pr-2">Тайлбар</th>
              {hasItems && <th className="py-1.5 pr-2">Бараа</th>}
              {hasItems && <th className="py-1.5 pr-2 text-right">Тоо</th>}
              <th className="py-1.5 text-right">Дүн ({invoice.currency})</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index} className="border-b border-neutral-200">
                <td className="py-1.5 pr-2">{index + 1}</td>
                <td className="py-1.5 pr-2">{line.description || "—"}</td>
                {hasItems && <td className="py-1.5 pr-2">{line.itemName ?? ""}</td>}
                {hasItems && (
                  <td className="py-1.5 pr-2 text-right font-mono">
                    {line.quantity != null ? String(line.quantity) : ""}
                  </td>
                )}
                <td className="py-1.5 text-right font-mono">{fmt(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-b border-black font-bold">
              <td colSpan={hasItems ? 4 : 2} className="py-2 text-right">
                НИЙТ ДҮН
              </td>
              <td className="py-2 text-right font-mono">{fmt(invoice.totalAmount)}</td>
            </tr>
            {invoice.paidAmount > 0 && (
              <tr className="text-sm">
                <td colSpan={hasItems ? 4 : 2} className="py-1.5 text-right text-neutral-500">
                  Төлсөн {fmt(invoice.paidAmount)} · Үлдэгдэл
                </td>
                <td className="py-1.5 text-right font-mono font-semibold">{fmt(balance)}</td>
              </tr>
            )}
          </tfoot>
        </table>

        {company.bankAccounts.length > 0 && (
          <div className="mt-6 text-sm">
            <div className="text-xs font-semibold">Төлбөр хүлээн авах данс</div>
            {company.bankAccounts.map((account, index) => (
              <div key={index} className="text-xs text-neutral-600">
                {account.bankName} · <span className="font-mono">{account.accountNo}</span>
                {account.accountName ? ` · ${account.accountName}` : ""}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-center">
        <a
          href={`/invoice/${token}/pdf`}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--ea-primary)] px-4 text-sm font-medium text-[var(--primary-foreground)]"
          style={{ textDecoration: "none" }}
        >
          PDF татах
        </a>
      </div>
    </main>
  );
}
