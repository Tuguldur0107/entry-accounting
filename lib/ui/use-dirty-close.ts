"use client";

import type { useConfirm } from "@/components/ui/confirm-dialog";

type ConfirmFn = ReturnType<typeof useConfirm>["confirm"];

export type DirtyCloseOptions = {
  /** Маягт нээгдэхдээ авсан snapshot-оос ялгаатай эсэх. */
  dirty: boolean;
  /**
   * Дуудагчийн useConfirm instance. Hook өөрөө useConfirm дууддаггүй —
   * эс бөгөөс view тутамд хоёр confirm dialog зурагдана.
   */
  confirm: ConfirmFn;
  /** Dialog-ийн open төлөвийг бодитоор солих setter. */
  setOpen: (open: boolean) => void;
  title?: string;
  description?: string;
};

/**
 * Dialog-ийн `onOpenChange`-д залгах хамгаалалт: Esc, backdrop, × товч бүгд
 * энэ handler-аар дайрдаг тул бөглөсөн мэдээлэл чимээгүй устахаас сэргийлнэ.
 *
 * Амжилттай хадгалалт нь `setOpen(false)`-ийг ШУУД дуудна (энэ handler-аар
 * биш) — тэгэхээр хадгалсны дараа асуулт гарахгүй.
 */
export function useDirtyClose({
  dirty,
  confirm,
  setOpen,
  title = "Хадгалаагүй өөрчлөлт",
  description = "Бөглөсөн мэдээлэл хадгалагдахгүй. Гарах уу?",
}: DirtyCloseOptions) {
  // Hook дотор useCallback хийхгүй: handler нь зөвхөн onOpenChange-д ордог
  // тул reference тогтвортой байх шаардлагагүй.
  return (open: boolean) => {
    if (open || !dirty) {
      setOpen(open);
      return;
    }
    void confirm({
      title,
      description,
      confirmText: "Гарах",
      cancelText: "Үргэлжлүүлэх",
      danger: true,
    }).then((ok) => {
      if (ok) setOpen(false);
    });
  };
}
