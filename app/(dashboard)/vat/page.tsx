import { redirect } from "next/navigation";

// НӨАТ хуудас Татвар модуль руу нүүсэн (/tax/vat) — хуучин deep link,
// хадгалсан хавчуурга, AI-ийн навигацийн зам хэвээр ажиллана.
type SearchParams = Promise<{ period?: string }>;

export default async function VatRedirect({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { period } = await searchParams;
  redirect(period ? `/tax/vat?period=${period}` : "/tax/vat");
}
