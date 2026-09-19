"use client";

// Хавсралтын КОМПАКТ мөр + popup — баримтын панелиудын НЭГДСЭН хэрэглээ.
//
// ШАЛТГААН: панель дотор хавсралтын бүтэн жагсаалт («Хавсралт алга» том
// хоосон блок) 200+ пиксель эзэлж, гол агуулгыг (журналын мөрүүд, үйлдлийн
// товчнууд) доош түлхдэг байв. Одоо панельд ЗӨВХӨН нэг мөр:
//
//     📎 Хавсралт · 2                          [Нэмэх]
//
// Дарахад popup нээгдэж (`Dialog`) бүтэн жагсаалт — хуулах, татах, устгах —
// `AttachmentList`-ээр гарна. Логик ДАВХАРДАХГҮЙ: жагсаалт/хуулалт/устгалт
// нэг л газар (attachment-list.tsx), энэ файл нь зөвхөн БҮРХҮҮЛ.

import { useEffect, useState } from "react";

import { AttachmentList } from "@/components/attachments/attachment-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { listAttachments } from "@/lib/actions/attachments";
import { PO_ATTACHMENT_KINDS } from "@/lib/attachments/constants";
import { cn } from "@/lib/utils";

export function AttachmentSection({
  entityType,
  entityId,
  canUpload = true,
  canDelete = true,
  kinds = PO_ATTACHMENT_KINDS,
  refreshToken,
  onChanged,
  className,
}: {
  entityType: string;
  entityId: string;
  canUpload?: boolean;
  canDelete?: boolean;
  kinds?: readonly { value: string; label: string }[];
  refreshToken?: number;
  onChanged?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loadedCount, setLoadedCount] = useState<number | null>(null);
  // Popup дотор өөрчлөгдөхөд тоолуур дахин уншина (жагсаалттай нэг эх).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Хадгалагдаагүй баримт (entityId хоосон) — сервер рүү хандахгүй.
    if (!entityId) return;
    let cancelled = false;
    listAttachments(entityType, entityId)
      .then((result) => {
        if (!cancelled) setLoadedCount(result.items?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) setLoadedCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, refreshToken, reloadKey]);

  /** entityId хоосон бол тоолуур үргэлж 0 (жагсаалт мөн хоосон). */
  const count = entityId ? loadedCount : 0;
  const label = count ? `Хавсралт · ${count}` : "Хавсралт";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Хавсралтыг нээх (PDF, зураг, Excel, Word — 8MB хүртэл)"
      >
        <Icon name="attach" size="sm" />
        {label}
      </Button>
      {count === 0 && (
        <span className="text-[11px] text-[var(--ea-text-4)]">
          {entityId ? "Файл хавсаргаагүй" : "Хадгалсны дараа хавсаргана"}
        </span>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Хавсралт</DialogTitle>
            <DialogDescription>
              Үнийн санал, гэрээ, нэхэмжлэх, гаалийн мэдүүлэг — PDF, зураг,
              Excel, Word (8MB хүртэл)
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <AttachmentList
              entityType={entityType}
              entityId={entityId}
              canUpload={canUpload}
              canDelete={canDelete}
              kinds={kinds}
              refreshToken={refreshToken}
              onChanged={() => {
                setReloadKey((value) => value + 1);
                onChanged?.();
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
