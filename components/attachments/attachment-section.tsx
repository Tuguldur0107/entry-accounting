"use client";

// Хавсралтын КОМПАКТ мөр — баримтын панелиудын НЭГДСЭН хэрэглээ.
//
// ШАЛТГААН: панель дотор хавсралтын бүтэн жагсаалт («Хавсралт алга» том
// хоосон блок) 200+ пиксель эзэлж, гол агуулгыг (журналын мөрүүд, үйлдлийн
// товчнууд) доош түлхдэг байв. Одоо панельд ЗӨВХӨН нэг мөр:
//
//     Хавсралт  [Бусад ▾] [⬆ Файл хавсаргах] [📎 Хавсралт харах · 2]
//
// Жагсаалт нь «Хавсралт харах» дарахад popup-д гарна; ХООСОН үед товч
// идэвхгүй — хоосон блок ХЭЗЭЭ Ч панелийн зай эзлэхгүй.
//
// Логик ДАВХАРДАХГҮЙ: төлөв/хуулалт/устгалт нь `useAttachments` (нэг
// controller — давхар fetch хийхгүй), харагдах хэсгүүд нь
// `AttachmentUploadBar` / `AttachmentRows` (attachment-list.tsx).

import { useState } from "react";

import {
  AttachmentRows,
  AttachmentUploadBar,
  useAttachments,
} from "@/components/attachments/attachment-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
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
  /** Хаагдсан/цуцлагдсан баримтад false (server тал мөн хориглоно). */
  canDelete?: boolean;
  kinds?: readonly { value: string; label: string }[];
  refreshToken?: number;
  onChanged?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ctl = useAttachments({
    entityType,
    entityId,
    kinds,
    refreshToken,
    onChanged,
  });
  const count = ctl.count ?? 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-xs font-semibold text-[var(--ea-text-2)]">
        Хавсралт
      </span>
      {canUpload && <AttachmentUploadBar ctl={ctl} />}
      <Button
        variant="outline"
        disabled={count === 0}
        onClick={() => setOpen(true)}
        title={
          count === 0
            ? "Хавсаргасан файл алга"
            : "Хавсаргасан файлуудыг нээх"
        }
      >
        <Icon name="attach" size="sm" />
        {count > 0 ? `Хавсралт харах · ${count}` : "Хавсралт харах"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Хавсралт</DialogTitle>
            <DialogDescription>
              Хавсаргасан файлыг нэрээр нь дарж нээх, ⬇ товчоор татах,
              🗑 товчоор устгана
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <AttachmentRows
              ctl={ctl}
              canDelete={canDelete}
              showEmptyState={false}
            />
          </div>
        </DialogContent>
      </Dialog>

      {ctl.confirmDialog}
    </div>
  );
}
