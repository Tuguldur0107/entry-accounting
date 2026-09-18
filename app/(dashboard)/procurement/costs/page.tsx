// "Хуваарилагдаагүй зардал" өртгийн модуль руу шилжсэн — хуучин
// bookmark/линк эвдэхгүйн тулд redirect (огнооны параметр хамт дамжина).

import { redirect } from "next/navigation";

type SearchParams = Promise<{ from?: string; to?: string }>;

export default async function LegacyUnallocatedCostsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { from, to } = await searchParams;
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  redirect(`/costing/allocations${params.size ? `?${params}` : ""}`);
}
