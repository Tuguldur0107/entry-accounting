"use client";

// Нэхэмжлэх илгээх dialog — и-мэйл (PDF хавсралттай) эсвэл public линк.
// Илгээлт бүрийн түүх (илгээсэн/үзсэн) доор нь харагдана.

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingInline } from "@/components/ui/loading";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  createInvoiceLink,
  getInvoiceSendContext,
  revokeInvoiceSend,
  sendInvoiceEmail,
} from "@/lib/actions/invoice-send";
import { toast } from "sonner";

type SendRow = {
  id: string;
  channel: "email" | "link";
  recipient: string | null;
  url: string | null;
  sentAt: string;
  viewedAt: string | null;
  revoked: boolean;
  expiresAt: string | null;
  expired: boolean;
};

/** Линкний хугацааны сонголтууд — "" нь хугацаагүй. */
const LINK_EXPIRY_OPTIONS = [
  { value: "7", label: "7 хоног" },
  { value: "30", label: "30 хоног" },
  { value: "90", label: "90 хоног" },
  { value: "", label: "Хугацаагүй" },
] as const;

export function InvoiceSendDialog({
  documentId,
  documentNo,
  open,
  onOpenChange,
}: {
  documentId: string;
  documentNo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Body-г зөвхөн нээлттэй үед mount хийнэ — state нь нээлт бүрд
            цэвэрхэн эхэлж, effect дотор sync reset хэрэггүй болно. */}
        {open && (
          <SendDialogBody
            documentId={documentId}
            documentNo={documentNo}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SendDialogBody({
  documentId,
  documentNo,
  onClose,
}: {
  documentId: string;
  documentNo: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sends, setSends] = useState<SendRow[] | null>(null);
  const [linkExpiry, setLinkExpiry] = useState("90");
  const [isPending, startTransition] = useTransition();

  // Mount үед контекст (харилцагчийн и-мэйл + түүх) ачаална.
  useEffect(() => {
    let cancelled = false;
    getInvoiceSendContext(documentId)
      .then((context) => {
        if (cancelled) return;
        setSends(context.sends);
        // Хэрэглэгч гараар бичээгүй л бол харилцагчийн и-мэйлийг бөглөнө.
        setEmail((current) => current || context.counterpartyEmail || "");
      })
      .catch((caught) =>
        toast.error(caught instanceof Error ? caught.message : "Ачаалж чадсангүй")
      );
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  function refresh() {
    getInvoiceSendContext(documentId)
      .then((context) => setSends(context.sends))
      .catch(() => undefined);
  }

  function handleSendEmail() {
    startTransition(async () => {
      try {
        const result = await sendInvoiceEmail(documentId, email);
        toast.success(`№ ${result.documentNo} нэхэмжлэх ${result.sentTo} руу илгээгдлээ`);
        refresh();
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "Илгээх амжилтгүй");
      }
    });
  }

  function handleCreateLink() {
    startTransition(async () => {
      try {
        const { url } = await createInvoiceLink(documentId, {
          expiryDays: linkExpiry === "" ? null : Number(linkExpiry),
        });
        await navigator.clipboard.writeText(url).catch(() => undefined);
        toast.success("Линк үүсч, санах ойд хуулагдлаа");
        refresh();
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "Линк үүсгэх амжилтгүй");
      }
    });
  }

  return (
    <>
      <DialogHeader>
          <DialogTitle>Нэхэмжлэх илгээх</DialogTitle>
          <DialogDescription>
            № {documentNo} — PDF хавсралттай и-мэйл эсвэл нээлттэй линк.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invoice-send-email">Хүлээн авагчийн и-мэйл</Label>
            <div className="flex gap-2">
              <Input
                id="invoice-send-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="billing@company.mn"
                className="flex-1"
              />
              <Button onClick={handleSendEmail} disabled={isPending || !email.trim()}>
                <Icon name="send" size="sm" />
                Илгээх
              </Button>
            </div>
            <p className="text-[11px] text-[var(--ea-text-4)]">
              Харилцагчийн картад и-мэйл байвал автоматаар бөглөгдөнө.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-[var(--ea-border)]" />
            <span className="text-[11px] text-[var(--ea-text-4)]">эсвэл</span>
            <div className="h-px flex-1 bg-[var(--ea-border)]" />
          </div>

          <div className="flex items-end gap-2">
            <div className="grid w-32 shrink-0 gap-1.5">
              <Label htmlFor="invoice-link-expiry">Хугацаа</Label>
              <select
                id="invoice-link-expiry"
                className="h-9 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg)] px-2 text-sm text-[var(--ea-text-1)]"
                value={linkExpiry}
                onChange={(event) => setLinkExpiry(event.target.value)}
              >
                {LINK_EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              onClick={handleCreateLink}
              disabled={isPending}
              className="flex-1"
            >
              <Icon name="openExternal" size="sm" />
              Нээлттэй линк үүсгэж хуулах
            </Button>
          </div>

          {/* Илгээлтийн түүх */}
          <div>
            <div className="mb-1.5 text-xs font-semibold text-[var(--ea-text-2)]">
              Илгээлтийн түүх
            </div>
            {sends === null ? (
              <LoadingInline />
            ) : sends.length === 0 ? (
              <p className="text-xs text-[var(--ea-text-4)]">
                Илгээгээгүй байна.
              </p>
            ) : (
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {sends.map((send) => (
                  <li
                    key={send.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-2.5 py-1.5 text-xs"
                  >
                    <Icon
                      name={send.channel === "email" ? "mail" : "openExternal"}
                      size="sm"
                      className="shrink-0 text-[var(--ea-text-3)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-[var(--ea-text-1)]">
                      {send.channel === "email" ? send.recipient : "Нээлттэй линк"}
                      <span className="ml-2 text-[var(--ea-text-4)]">
                        {send.sentAt.slice(0, 16).replace("T", " ")}
                      </span>
                      {!send.revoked && !send.expired && send.expiresAt && (
                        <span className="ml-2 text-[var(--ea-text-4)]">
                          · {send.expiresAt.slice(0, 10)} хүртэл
                        </span>
                      )}
                    </span>
                    {send.revoked ? (
                      <StatusBadge tone="muted" className="!px-2 !py-0.5 !text-[10px]">
                        Хүчингүй
                      </StatusBadge>
                    ) : send.expired ? (
                      <StatusBadge tone="danger" className="!px-2 !py-0.5 !text-[10px]">
                        Хугацаа дууссан
                      </StatusBadge>
                    ) : send.viewedAt ? (
                      <StatusBadge tone="success" className="!px-2 !py-0.5 !text-[10px]">
                        Үзсэн
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="muted" className="!px-2 !py-0.5 !text-[10px]">
                        Илгээсэн
                      </StatusBadge>
                    )}
                    {!send.revoked && send.url && (
                      <IconAction
                        name="copy"
                        label="Линк хуулах"
                        size="xs"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(send.url!)
                            .then(() => toast.success("Линк хуулагдлаа"))
                            .catch(() => toast.error("Хуулж чадсангүй"));
                        }}
                      />
                    )}
                    {!send.revoked && !send.expired && (
                      <IconAction
                        name="cancel"
                        label="Хүчингүй болгох"
                        size="xs"
                        variant="danger"
                        onClick={() => {
                          startTransition(async () => {
                            await revokeInvoiceSend(send.id);
                            refresh();
                            toast.success("Линк хүчингүй боллоо");
                          });
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Хаах
        </Button>
      </DialogFooter>
    </>
  );
}
