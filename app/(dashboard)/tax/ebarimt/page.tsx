// Татвар → ТЕГ-ийн холболт `/tax/ebarimt` — ITC/ТЕГ-ийн TPI нэвтрэлт (байгууллагын
// ITC хэрэглэгч) ба ТЕГ-ээс ТАТАХ гурван урсгалын төлөв: борлуулалт (getSalesTotalData),
// худалдан авалт (getSaleListERP), гаалийн мэдүүлэг (tpiDeclaration). Жагсаалтууд өөрийн
// модульд: Авлага → eBarimt · борлуулалт, Өглөг → eBarimt · худалдан авалт; баримт ОЛГОХ
// тохиргоо (PosAPI, мерчант, нэхэмжлэх) Бараа → POS тохиргоо → eBarimt. 2026-10-02-оос
// өмнө энэ хуудас илгээсэн баримтын жагсаалт байсан (Авлагынхтай давхардсан — цэгцлэв).

import Link from "next/link";

import { EbarimtTpiSettings } from "@/components/pos/ebarimt-tpi-settings";
import { TaxStatCard } from "@/components/tax/tax-info";
import { requireModuleAction } from "@/lib/auth";
import { loadTpiConnectionRow, toTpiConnectionView } from "@/lib/ebarimt/tax-sync";

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", dateStyle: "short", timeStyle: "short" }) : "—";

export default async function TaxEbarimtConnectionPage() {
  const { orgId } = await requireModuleAction("tax", "read");
  const row = await loadTpiConnectionRow(orgId);
  const connection = row ? toTpiConnectionView(row) : null;

  const streams = connection
    ? [
        {
          label: "Борлуулалт (ТЕГ-ийн бүх баримт)",
          href: "/receivables/ebarimt?view=sales",
          from: connection.syncFrom,
          through: connection.syncedThrough,
          okAt: connection.lastSyncOkAt,
          error: connection.lastSyncError,
          hint: "Авлага → eBarimt · борлуулалт — нэхэмжлэхийн тулгалт, бүх борлуулалт",
        },
        {
          label: "Худалдан авалт (нийлүүлэгчийн баримт)",
          href: "/payables/ebarimt",
          from: connection.purchasesSyncFrom,
          through: connection.purchasesSyncedThrough,
          okAt: connection.lastPurchaseSyncOkAt,
          error: connection.lastPurchaseSyncError,
          hint: "Өглөг → eBarimt · худалдан авалт — өглөгтэй ДДТД-аар тулгана",
        },
        // Гаалийн мэдүүлэг — операторын гаалийн түлхүүр тохируулагдсан үед л харагдана.
        ...(connection.customsApiKey
          ? [
              {
                label: "Гаалийн мэдүүлэг",
                href: "/payables/ebarimt?view=customs",
                from: connection.customsSyncFrom,
                through: connection.customsSyncedThrough,
                okAt: connection.lastCustomsSyncOkAt,
                error: connection.lastCustomsSyncError,
                hint: "Өглөг → eBarimt · худалдан авалт → Гаалийн мэдүүлэг",
              },
            ]
          : []),
      ]
    : [];

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">ТЕГ-ийн холболт (eBarimt TPI)</h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Байгууллагын ITC нэвтрэлтээр ТЕГ-ээс борлуулалт, худалдан авалт, гаалийн мэдүүлгийг өдөр бүр татна — зөвхөн унших, ТЕГ-д юу ч
          бичихгүй. Баримт олгох тохиргоо (PosAPI, мерчант, нэхэмжлэх){" "}
          <Link href="/inventory/pos-settings?section=ebarimt" className="underline">
            Бараа → POS тохиргоо → eBarimt
          </Link>
          -д.
        </p>
      </div>
      {streams.length > 0 && (
        <div className={`grid gap-3 ${streams.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {streams.map((stream) => (
            <Link key={stream.href} href={stream.href} className="block">
              <TaxStatCard
                label={stream.label}
                value={stream.through ?? "—"}
                hint={
                  stream.error
                    ? `Алдаатай: ${stream.error.slice(0, 140)}`
                    : `${stream.from ?? "—"} → ${stream.through ?? "—"} · сүүлд ${formatTime(stream.okAt)} · ${stream.hint}`
                }
                tone={stream.error ? "danger" : undefined}
              />
            </Link>
          ))}
        </div>
      )}
      <EbarimtTpiSettings />
    </section>
  );
}
