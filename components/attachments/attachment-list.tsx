"use client";

// Хавсралтын НЭГДСЭН жагсаалт — ханган нийлүүлэгчийн үнийн санал, гэрээ,
// нэхэмжлэх, гаалийн мэдүүлэг зэрэг файлыг баримтад хавсаргана.
//
// Дахин ашиглагдахуйц: `entityType`/`entityId`-гаар аль ч баримтад суулгана
// (одоо худалдан авалтын захиалга ба хүлээн авалт). Бүх элемент ui-kit-ээс —
// Button / IconAction / Icon / StatusBadge / EmptyState / LoadingRows /
// useConfirm / `.ea-form-select`. Шинэ товч, диалог, icon бичихийг хориглоно.
//
// Хуулалт нь multipart route-аар (`/api/attachments`) явна — server action-ы
// body 1MB-аар хязгаарлагдсан тул 8MB файл тэр замаар орохгүй. Жагсаах/
// устгах нь server action (ActionResult).

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { LoadingRows } from "@/components/ui/loading";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  deleteAttachment,
  listAttachments,
  type AttachmentView,
} from "@/lib/actions/attachments";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  PO_ATTACHMENT_KINDS,
  attachmentKindLabel,
  fmtSize,
  resolveAttachmentMediaType,
} from "@/lib/attachments/constants";

/** Media type → registry-ийн icon (шинэ icon бичихгүй). */
function iconFor(mediaType: string): IconName {
  if (
    mediaType.includes("spreadsheet") ||
    mediaType.includes("ms-excel") ||
    mediaType.includes("csv")
  )
    return "spreadsheet";
  if (mediaType === "application/pdf") return "document";
  return "file";
}

export function AttachmentList({
  entityType,
  entityId,
  canUpload = true,
  canDelete = true,
  kinds = PO_ATTACHMENT_KINDS,
  refreshToken,
  onChanged,
}: {
  /** "purchase_order" | "goods_receipt" — аудитын entityType-тай ижил. */
  entityType: string;
  /** Хоосон бол баримт хадгалагдаагүй — хавсаргах боломжгүй гэдгийг үзүүлнэ. */
  entityId: string;
  canUpload?: boolean;
  /** Хаагдсан/цуцлагдсан баримтад false (server тал мөн хориглоно). */
  canDelete?: boolean;
  kinds?: readonly { value: string; label: string }[];
  /** Гадна талаас дахин ачаалуулах (панелийн refreshToken). */
  refreshToken?: number;
  /** Хуулсан/устгасны дараа (host нь refreshOpenPanels + router.refresh дуудна). */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<AttachmentView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(
    () =>
      kinds.find((option) => option.value === "other")?.value ??
      kinds[0]?.value ??
      "other"
  );
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Ачаалалт НЭГ газар: гадна талын refreshToken эсвэл дотоод reloadKey
  // (хуулсан/устгасны дараа) өсөхөд дахин татна. Панелийн ачаалалтын хэв
  // маягтай ижил — .then дотор setState + cancelled хамгаалалт
  // (components/panel/arap-doc-panel.tsx).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Хадгалагдаагүй баримт (entityId хоосон) — сервер руу хандахгүй.
    if (!entityId) return;
    let cancelled = false;
    listAttachments(entityType, entityId)
      .then((result) => {
        if (cancelled) return;
        if (result.error || !result.items) {
          setLoadError(result.error ?? "Хавсралт ачаалж чадсангүй");
          setItems([]);
          return;
        }
        setLoadError(null);
        setItems(result.items);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("Хавсралт ачаалж чадсангүй");
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, refreshToken, reloadKey]);

  /** entityId хоосон бол жагсаалт үргэлж хоосон (ачаалалт хийгдэхгүй). */
  const rows: AttachmentView[] | null = entityId ? items : [];

  async function upload(file: File) {
    const mediaType = resolveAttachmentMediaType(file.name, file.type);
    if (!mediaType) {
      toast.error("PDF, зураг, Excel эсвэл Word файл оруулна уу");
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error("Файл 8MB-с ихгүй байх ёстой");
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", entityType);
      formData.append("entityId", entityId);
      formData.append("kind", kind);
      const response = await fetch("/api/attachments", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!response.ok || result.error) {
        toast.error(result.error || "Хавсралт хуулж чадсангүй");
        return;
      }
      toast.success("Хавсралт нэмэгдлээ");
      setReloadKey((value) => value + 1);
      onChanged?.();
    } catch {
      toast.error("Хавсралт хуулж чадсангүй — дахин оролдоно уу");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(item: AttachmentView) {
    const ok = await confirm({
      title: "Хавсралт устгах",
      description: `«${item.name}» файлыг устгах уу? Үйлдлийг буцаах боломжгүй.`,
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteAttachment(item.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Хавсралт устгагдлаа");
      setReloadKey((value) => value + 1);
      onChanged?.();
    });
  }

  const showUpload = canUpload && !!entityId;

  return (
    <div className="space-y-2">
      {showUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="ea-form-select !w-auto min-w-44"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            disabled={busy}
            aria-label="Хавсралтын төрөл"
          >
            {kinds.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            title="PDF, зураг, Excel, Word — 8MB хүртэл"
          >
            <Icon
              name={busy ? "loading" : "upload"}
              size="sm"
              className={busy ? "animate-spin" : undefined}
            />
            {busy ? "Хуулж байна…" : "Файл хавсаргах"}
          </Button>
        </div>
      )}

      {rows === null ? (
        <LoadingRows count={2} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="attach"
          title="Хавсралт алга"
          description={
            entityId
              ? "Үнийн санал, гэрээ, нэхэмжлэх, гаалийн мэдүүлэг — PDF, зураг, Excel, Word (8MB хүртэл)"
              : "Баримтыг хадгалсны дараа файл хавсаргана"
          }
        />
      ) : (
        <div className="space-y-1.5">
          {rows.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2"
            >
              <Icon
                name={iconFor(item.mediaType)}
                size="sm"
                className="shrink-0 text-[var(--ea-text-3)]"
              />
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/attachments/${item.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm text-[var(--ea-text-1)] hover:underline"
                >
                  {item.name}
                </a>
                <div className="mt-0.5 truncate text-[11px] text-[var(--ea-text-4)]">
                  {fmtSize(item.sizeBytes)} · {item.createdAt}
                  {item.uploadedBy ? ` · ${item.uploadedBy}` : ""}
                </div>
              </div>
              <StatusBadge tone="muted" size="sm">
                {attachmentKindLabel(item.kind)}
              </StatusBadge>
              <Button
                variant="outline"
                size="icon-sm"
                render={
                  <a
                    href={`/api/attachments/${item.id}?download=1`}
                    aria-label="Татах"
                    title="Татах"
                  />
                }
              >
                <Icon name="download" size="sm" />
              </Button>
              {canDelete && (
                <IconAction
                  name="delete"
                  label="Хавсралт устгах"
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() => void remove(item)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {loadError && (
        <p className="text-xs text-[var(--ea-danger-fg)]">{loadError}</p>
      )}
      {confirmDialog}
    </div>
  );
}
