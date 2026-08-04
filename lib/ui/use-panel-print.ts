"use client";

// Панелиас хэвлэх НИЙТЛЭГ hook. window.print() нь бүх хуудсыг хэвлэдэг тул
// print sheet-ийг body-д portal-оор гаргаж, globals.css-ийн
// `body.ea-printing-voucher > *:not(.ea-print-sheet)` дүрмээр бусад бүх
// зүйлийг (апп, бусад панель) нууна. Journal, cash, АР/АП панелиуд нэг
// ижил механизм хэрэглэнэ.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function usePanelPrint() {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("ea-printing-voucher");
    window.print();
    document.body.classList.remove("ea-printing-voucher");
    // window.print() хэвлэх dialog хаагдтал блоклоно — дараа нь portal-ыг
    // буулгана (sync setState effect дотор хориотой тул timeout-оор).
    const timer = setTimeout(() => setPrinting(false), 0);
    return () => clearTimeout(timer);
  }, [printing]);

  return {
    print: () => setPrinting(true),
    /** Хэвлэж байх агшинд sheet-ийг body-д portal хийнэ. */
    renderSheet: (sheet: ReactNode) =>
      printing && typeof document !== "undefined"
        ? createPortal(sheet, document.body)
        : null,
  };
}
