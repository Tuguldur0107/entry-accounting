// QR-ын модулийн матриц → SVG path — ЦЭВЭР, СЕРВЕР/клиент аль алинд (статик
// import). PDF нэхэмжлэхийн «линкийн QR»-д (lib/pdf/invoice-pdf.tsx);
// дэлгэцийн QR нь components/ui/qr-code.tsx (dynamic import) хэвээр.

import qrcode from "qrcode-generator";

/** `M{x} {y}h1v1h-1z` квадратуудын path + модулийн тоо (quiet zone-гүй). */
export function qrSvgPath(value: string): { path: string; count: number } {
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();
  const count = code.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row += 1)
    for (let col = 0; col < count; col += 1) if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
  return { path, count };
}
