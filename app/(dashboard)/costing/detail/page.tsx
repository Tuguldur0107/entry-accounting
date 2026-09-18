// Гүйлгээний дэлгэрэнгүй → Тайлан хэсгийн таб болов.
// Хуучин bookmark/линк эвдэхгүйн тулд redirect (шүүлтүүрийн параметр хамт).

import { redirect } from "next/navigation";

type SearchParams = Promise<{ from?: string; to?: string }>;

export default async function LegacyCostingDetailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { from, to } = await searchParams;
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  redirect(`/costing/reports/detail${params.size ? `?${params}` : ""}`);
}
