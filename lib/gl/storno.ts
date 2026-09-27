// Улаан сторно — буцаалтын журналын мөр ЭХ мөрийнхөө ТАЛД, дүн нь СӨРӨГ
// (Дт/Кт солихгүй). Product owner 2026-09-27: «буцаалт хасах утгатай, Дт Кт
// сольж бичихгүй». Ерөнхий журналын буцаалт (gl.ts) анхнаасаа ийм байсан;
// бусад модуль (касс, ҮХ, өртөг, хангамж, АР/АП, POS) энэ НЭГ helper-ээр.
// Тэнцэл хадгалагдана: Σ(−Дт) = Σ(−Кт). Эргэлт (Дт/Кт нийлбэр) цэвэр дүнгээр
// буурна — буцаалт эргэлтийг хөөргөхгүй. ЦЭВЭР (tests/gl-storno.test.ts).

type Amount = string | number | null | undefined;

const negate = (value: Amount): string => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new Error(`Буцаалтын дүн буруу: ${value}`);
  // -0 → "0" (String(-0) нь "0" боловч тодорхой байлгана).
  return n === 0 ? "0" : String(-n);
};

/** Батлагдсан ЭХ мөрийн буцаалт: тал хэвээр, дүн сөрөг (валютын дүн ч). */
export function stornoOf<T extends { debit: Amount; credit: Amount; debitFc?: Amount; creditFc?: Amount }>(
  line: T
): { debit: string; credit: string; debitFc?: string; creditFc?: string } {
  return {
    debit: negate(line.debit),
    credit: negate(line.credit),
    ...(line.debitFc !== undefined ? { debitFc: negate(line.debitFc) } : {}),
    ...(line.creditFc !== undefined ? { creditFc: negate(line.creditFc) } : {}),
  };
}

/**
 * Толин тусгалаар (Дт↔Кт солиж) бүтээсэн буцаалтын мөрийг сторно болгоно:
 * «Дт Орлого X» ≡ «Кт Орлого −X». POS буцаалт г.м. мөрийг шинээр угсардаг замд.
 */
export function stornoFromMirror<T extends { debit?: Amount; credit?: Amount }>(line: T): T & { debit: string; credit: string } {
  return { ...line, debit: negate(line.credit), credit: negate(line.debit) };
}
