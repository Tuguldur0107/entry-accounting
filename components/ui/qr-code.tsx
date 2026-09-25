"use client";

// Нийтлэг QR зураглагч — `qrcode-generator` (dynamic import, ~10KB) модулийн
// матрицыг inline SVG болгоно (зураг татахгүй). POS-ийн QPay диалог, дараа нь
// АР нэхэмжлэхийн QR-д. Баримтын eBarimt QR (receipt-preview.tsx) хэвлэлтийн
// кэштэй тусдаа хэвээр.

import { useEffect, useState } from "react";

interface QrCodeLike {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

let qrFactory: ((typeNumber: 0, errorCorrectionLevel: "M") => QrCodeLike) | null = null;
const cache = new Map<string, { path: string; count: number }>();

function buildPath(value: string): { path: string; count: number } | null {
  const cached = cache.get(value);
  if (cached) return cached;
  if (!qrFactory) return null;
  try {
    const code = qrFactory(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let path = "";
    for (let row = 0; row < count; row += 1)
      for (let col = 0; col < count; col += 1) if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    const result = { path, count };
    cache.set(value, result);
    return result;
  } catch {
    return null;
  }
}

export function QrCode({
  value,
  size = 240,
  label = "QR",
  fallbackSrc,
}: {
  value: string;
  size?: number;
  label?: string;
  /** Сан ачаалагдах хүртэл / ачаалагдаагүй үед харуулах зураг (QPay-ийн qr_image). */
  fallbackSrc?: string | null;
}) {
  // Render бүрд шууд (buildPath өөрөө Map-аар кэшлэдэг). Сан (qrcode-generator)
  // асинхрон ачаалагдах хүртэл null — ачаалагдмагц setLoaded дахин render хийж
  // зурна. Өмнө нь useMemo([value]) тэр анхны null-ийг хадгалж QR ХЭЗЭЭ Ч
  // зурагдахгүй байв (2026-09-25, QPay диалог хоосон).
  const [, setLoaded] = useState(0);
  const qr = buildPath(value);

  useEffect(() => {
    if (qr || qrFactory) return;
    let cancelled = false;
    import("qrcode-generator")
      .then((module) => {
        if (cancelled) return;
        qrFactory = module.default;
        setLoaded((current) => current + 1);
      })
      .catch(() => {
        // Ачаалагдаагүй — дуудагч qr_image / текст нөөцөө харуулна.
      });
    return () => {
      cancelled = true;
    };
  }, [qr]);

  if (!qr)
    return fallbackSrc ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fallbackSrc} alt={label} width={size} height={size} className="rounded-md bg-white" />
    ) : null;
  return (
    <svg
      viewBox={`-2 -2 ${qr.count + 4} ${qr.count + 4}`}
      style={{ width: size, height: size }}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className="rounded-md bg-white text-black"
    >
      <path d={qr.path} fill="currentColor" />
    </svg>
  );
}
