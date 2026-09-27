// Апп-ын НИЙТИЙН суурь URL (NEXT_PUBLIC_APP_URL) — харилцагчид очих линк
// (нэхэмжлэх, QPay webhook) үүнээс. Тохируулаагүй / буруу бол null: localhost-ын
// линкийг гадагш илгээхгүй. DB импортгүй.

export function publicAppUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return value && /^https?:\/\//.test(value) ? value : null;
}
