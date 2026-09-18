// S1 (Компани) ба S6 (Группын дотоод) сегментийн утгыг байгууллагын
// бүртгэлээс АВТОМАТААР бүрдүүлэх ЦЭВЭР логик (DB-гүй, тесттэй).
//
// Дүрэм (knowledge/03-стандарт/segment-strategy.md §7.2, §7.4):
//   • S1 = харилцагчийн компаниуд (нэг эзэмшигчийн бүх байгууллага)
//   • S6 = ЯГ ижил жагсаалт (ижил код, ижил нэр) — группын доторх эсрэг тал
//   • Код нэг компанид НЭГ удаа хуваарилагдана, дахин ХЭЗЭЭ Ч өөрчлөгдөхгүй
//     (журналд бичигдсэн posting код хоцрох ёсгүй)
//   • Нэр солигдвол утгын нэр дагаж шинэчлэгдэнэ — код хэвээр
//   • Устгахгүй: бүртгэлээс гарсан компанийн код түүхэн бичилтэд үлдэнэ
//
// §7.6.6: S6 ≠ S1 тул S6-д өөрийн компани бас байрлана (жагсаалт ижил) ч
// posting-ийн автомат default болж ХЭЗЭЭ Ч сонгогдохгүй (lib/gl/posting-code.ts).

export interface CompanyRef {
  organizationId: string;
  name: string;
}

export interface ExistingSegmentValue {
  id: string;
  segmentId: number;
  code: string;
  name: string;
  linkedOrganizationId: string | null;
}

export interface CompanySegmentPlan {
  /** Шинээр үүсгэх утгууд. */
  create: {
    segmentId: number;
    code: string;
    name: string;
    linkedOrganizationId: string;
  }[];
  /** Байгаа мөрийг компанид холбох / нэрийг нь шинэчлэх. */
  update: { id: string; name: string; linkedOrganizationId: string }[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Сул код олох — эхний код нь оронгийн тооны хамгийн бага "1" эхлэлтэй
 * (3 оронд 101). Сегментийн код 0-ээр эхэлдэггүй (§7.1).
 */
export function nextFreeCode(used: Set<string>, length: number): string {
  const start = Math.pow(10, length - 1) + 1; // 3 орон → 101
  const max = Math.pow(10, length) - 1; // 3 орон → 999
  for (let n = start; n <= max; n++) {
    const code = String(n).padStart(length, "0");
    if (!used.has(code)) return code;
  }
  throw new Error(`Сегментийн сул код дууслаа (${length} орон)`);
}

/**
 * Компаниудын жагсаалт + одоогийн утгууд → хийх ажлын төлөвлөгөө.
 * Идемпотент: өөрчлөлтгүй үед create/update хоёул хоосон.
 */
export function planCompanySegmentValues(input: {
  companies: CompanyRef[];
  existing: ExistingSegmentValue[];
  /** Ямар сегментүүдэд ижил жагсаалт байрлуулах (default S1, S6). */
  segmentIds?: number[];
  /** Кодын урт (S1/S6 хоёул 3). */
  codeLength?: number;
}): CompanySegmentPlan {
  const segmentIds = input.segmentIds ?? [1, 6];
  const codeLength = input.codeLength ?? 3;
  const plan: CompanySegmentPlan = { create: [], update: [] };

  const rows = input.existing.filter((row) => segmentIds.includes(row.segmentId));
  const usedCodes = new Set(rows.map((row) => row.code));
  const claimed = new Set<string>(); // энэ гүйлтэд шинээр эзэмшсэн мөр (id)

  // ① Компани бүрд НЭГ код — холбоос → нэрийн тааралт → шинэ сул код.
  const codeOf = new Map<string, string>();
  for (const company of input.companies) {
    const linked = rows.find(
      (row) => row.linkedOrganizationId === company.organizationId
    );
    if (linked) {
      codeOf.set(company.organizationId, linked.code);
      continue;
    }
    // Хэрэглэгч гараар бичсэн ижил нэртэй мөр байвал түүнийг ӨВЛӨНӨ —
    // давхардсан компани үүсэхгүй.
    const byName = rows.find(
      (row) =>
        !row.linkedOrganizationId &&
        !claimed.has(row.id) &&
        normalizeName(row.name) === normalizeName(company.name)
    );
    if (byName) {
      claimed.add(byName.id);
      codeOf.set(company.organizationId, byName.code);
      continue;
    }
    const code = nextFreeCode(usedCodes, codeLength);
    usedCodes.add(code);
    codeOf.set(company.organizationId, code);
  }

  // ② Сегмент бүрд компани бүрийн мөр байгаа эсэх.
  const adopted = new Set<string>(); // нэг мөрийг хоёр компанид өгөхгүй
  for (const segmentId of segmentIds) {
    for (const company of input.companies) {
      const code = codeOf.get(company.organizationId)!;
      const segRows = rows.filter((row) => row.segmentId === segmentId);
      const linked = segRows.find(
        (row) => row.linkedOrganizationId === company.organizationId
      );
      if (linked) {
        if (linked.name !== company.name)
          plan.update.push({
            id: linked.id,
            name: company.name,
            linkedOrganizationId: company.organizationId,
          });
        continue;
      }
      // Кодоороо (эсвэл нэрээрээ) таарсан холбоогүй мөрийг өвлөнө.
      const adoptable = segRows.find(
        (row) =>
          !row.linkedOrganizationId &&
          !adopted.has(row.id) &&
          (row.code === code || normalizeName(row.name) === normalizeName(company.name))
      );
      if (adoptable) {
        adopted.add(adoptable.id);
        plan.update.push({
          id: adoptable.id,
          name: company.name,
          linkedOrganizationId: company.organizationId,
        });
        continue;
      }
      plan.create.push({
        segmentId,
        code,
        name: company.name,
        linkedOrganizationId: company.organizationId,
      });
    }
  }

  return plan;
}
