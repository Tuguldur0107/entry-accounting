// Хүлээн авалтын (goods receipt) жагсаалт (Server Component).
//
// `?status=` төлөв, `?po=` захиалгын шүүлтүүр — PO панелиас "Хүлээн авалтууд"
// холбоос энэ параметрээр үсэрнэ.

import { GoodsReceiptsView } from "@/components/procurement/goods-receipts-view";
import { getActiveOrg } from "@/lib/auth";
import { loadGoodsReceipts } from "@/lib/procurement/load-data";

type SearchParams = Promise<{ status?: string; po?: string }>;

export default async function GoodsReceiptsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { status, po } = await searchParams;

  // Статусын тоолуур бүх төлөвөөр харагдах ёстой тул шүүлтүүр client талд.
  const receipts = await loadGoodsReceipts(orgId);

  return (
    <GoodsReceiptsView
      receipts={receipts}
      initialStatus={status}
      initialPoId={po}
    />
  );
}
