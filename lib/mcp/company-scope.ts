// MCP `initialize`-ийн зааварт холболтын КОМПАНИЙГ ил хэлнэ — ЦЭВЭР (DB-гүй, тесттэй).
//
// Token НЭГ байгууллагад уягддаг (docs/dev/ai-mcp.md). Олон компанитай хэрэглэгч
// «Б компанид бичээрэй» гэвэл AI энэ холболт аль компанийнх болохыг мэдэхгүй
// бол А компанид биччихнэ. Тиймээс заавар компанийн нэрийг өгч, бичилтийн өмнө
// дурдуулж, өөр компанийн хүсэлтийг энэ холболтоор хийлгэхгүй.

/** Компанийн нэр байгууллагын өөрийн оруулсан утга — зааварт орохын өмнө цэвэрлэнэ. */
const MAX_NAME_LENGTH = 80;

function sanitizeCompanyName(name: string | null | undefined): string {
  const clean = (name ?? "")
    .replace(/[\u0000-\u001f\u007f«»"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > MAX_NAME_LENGTH ? `${clean.slice(0, MAX_NAME_LENGTH)}…` : clean;
}

export function companyScopeInstruction(name: string | null | undefined): string {
  const company = sanitizeCompanyName(name);
  const label = company ? `«${company}»` : "НЭГ";
  return (
    ` Энэ холболт зөвхөн ${label} компанид ажиллана. Бичилт үүсгэх/батлах/устгахын ` +
    "өмнө хэрэглэгчид компанийн нэрийг дурдана; хэрэглэгч ӨӨР компанийг нэрлэвэл " +
    "энэ холболтоор бичихгүй — тэр компаниар Entry-д тусад нь холбохыг зөвлөнө " +
    "(get_active_company, list_companies-оор шалгана)."
  );
}
