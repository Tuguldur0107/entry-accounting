// Өртгийн хяналт → Тайлан хэсгийн эхний таб болов.
// Хуучин bookmark/линк эвдэхгүйн тулд redirect (шүүлтүүрийн параметр хамт).

import { redirect } from "next/navigation";

type SearchParams = Promise<{ period?: string }>;

export default async function LegacyCostControlPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { period } = await searchParams;
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  redirect(`/costing/reports${params.size ? `?${params}` : ""}`);
}
