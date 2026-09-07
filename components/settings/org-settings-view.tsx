"use client";

// Тохиргоо → Байгууллага — master-detail:
//   Зүүн: миний байгууллагууд (сонгох = идэвхжүүлэх, + шинэ компани бүртгэх)
//   Баруун: ИДЭВХТЭЙ байгууллагын мэдээлэл + аюултай бүс.
// Гишүүд, урилга, эрх — Тохиргоо → Хэрэглэгчдийн эрх хуудсанд нэгдсэн.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { CompanySettingsForm } from "@/components/settings/company-settings-form";
import {
  createOrganization,
  deleteOrganization,
  leaveOrganization,
  switchOrganization,
  type OrgSettingsData,
} from "@/lib/actions/org";
import type { CompanySettings } from "@/lib/db/schema";
import { ROLE_LABELS } from "@/lib/constants/roles";
import { cn } from "@/lib/utils";

export function OrgSettingsView({
  data,
  companySettings,
}: {
  data: OrgSettingsData;
  companySettings: CompanySettings | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  function act(fn: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(success);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Амжилтгүй");
      }
    });
  }

  function selectOrg(orgId: string, name: string) {
    if (orgId === data.org.id) return;
    startTransition(async () => {
      try {
        await switchOrganization(orgId);
        toast.success(`«${name}» идэвхтэй боллоо`);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Шилжиж чадсангүй");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* ── Зүүн: байгууллагуудын жагсаалт ─────────────────────────────── */}
      <aside className="w-full shrink-0 space-y-3 lg:w-72">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Байгууллагууд</h1>
          <span className="text-xs" style={{ color: "var(--ea-text-4)" }}>
            {data.myOrgs.length}
          </span>
        </div>
        <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
          Зөвхөн ТАНЫ гишүүнчлэлтэй байгууллагууд энд харагдана — бусад
          хэрэглэгчийн байгууллага танд харагдахгүй. Байгууллага сонгоход бүх
          систем түүний бүртгэл рүү шилжинэ; нэг хэрэглэгч олон байгууллагад
          өөр өөр эрхтэй байж болно.
        </p>

        <ul className="space-y-2">
          {data.myOrgs.map((org) => {
            const isActive = org.id === data.org.id;
            return (
              <li key={org.id}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => selectOrg(org.id, org.name)}
                  className={cn(
                    "ea-interactive w-full rounded-lg border p-3 text-left",
                    isActive && "ring-1 ring-[var(--ea-primary)]"
                  )}
                  style={{
                    borderColor: isActive
                      ? "var(--ea-primary)"
                      : "var(--ea-border)",
                    background: "var(--ea-surface)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--ea-text-1)" }}
                    >
                      {org.name}
                    </span>
                    {isActive && (
                      <StatusBadge tone="success" className="!px-2 !py-0.5 !text-[10px]">
                        Идэвхтэй
                      </StatusBadge>
                    )}
                  </div>
                  <div
                    className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px]"
                    style={{ color: "var(--ea-text-3)" }}
                  >
                    <span>{ROLE_LABELS[org.role]}</span>
                    <span aria-hidden>·</span>
                    <span>Гишүүд {org.memberCount}</span>
                    {org.registryNo && (
                      <>
                        <span aria-hidden>·</span>
                        <span>ТТД {org.registryNo}</span>
                      </>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => setCreateOpen(true)}
        >
          <Icon name="add" size="sm" />
          Шинэ байгууллага бүртгэх
        </Button>
      </aside>

      {/* ── Баруун: идэвхтэй байгууллагын дэлгэрэнгүй ──────────────────────
          max-w-2xl — компанийн формын хэсгүүдтэй ИЖИЛ өргөн: гишүүдийн
          хүснэгт, урилга, аюултай бүс бүгд нэг ирмэгээр зэрэгцэнэ. */}
      <div className="min-w-0 max-w-2xl flex-1 space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{data.org.name}</h2>
            <StatusBadge tone="success" className="!px-2 !py-0.5 !text-[10px]">
              Идэвхтэй байгууллага
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--ea-text-3)" }}>
            Таны эрх: {ROLE_LABELS[data.myRole]} · Гишүүд {data.members.length}
          </p>
        </div>

        {/* Компанийн бүрэн мэдээлэл (реквизит, данс, лого, тамга, гарын үсэг) —
            /settings/company-тэй НЭГ форм. Нэр/регистр хадгалахад байгууллагын
            нэр/ТТД мөн шинэчлэгдэнэ. Байгууллага солиход key-гээр шинээр
            mount хийгдэж тухайн байгууллагын утга ачаална. */}
        <CompanySettingsForm key={data.org.id} initial={companySettings} />

        {/* Гишүүд, урилга, эрх — Хэрэглэгчдийн эрх хуудсанд нэгдсэн */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4"
          style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}
        >
          <div>
            <h3 className="text-sm font-semibold">Гишүүд, эрх</h3>
            <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
              Гишүүн нэмэх, роль болон модуль бүрийн эрхийг «Хэрэглэгчдийн
              эрх» хуудсанд тохируулна.
            </p>
          </div>
          <Link
            href="/settings/permissions"
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-[var(--ea-text-1)] hover:bg-[var(--ea-hover-subtle)]"
            style={{ borderColor: "var(--ea-border)" }}
          >
            <Icon name="shield" size="sm" className="text-[var(--ea-text-3)]" />
            Хэрэглэгчдийн эрх
          </Link>
        </div>

        {/* Аюултай бүс — owner: устгах, бусад гишүүн: гарах */}
        <div
          className="space-y-3 rounded-lg border p-4"
          style={{
            borderColor: "color-mix(in srgb, var(--ea-danger) 40%, transparent)",
            background: "var(--ea-surface)",
          }}
        >
          <h3 className="text-sm font-semibold" style={{ color: "var(--ea-danger-fg)" }}>
            Аюултай бүс
          </h3>
          {data.myRole === "owner" ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
                «{data.org.name}»-г устгавал журнал, баримт, тохиргоо — БҮХ дата
                буцалтгүй устна.
              </p>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                Байгууллага устгах
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
                Байгууллагаас гарвал дахин нэвтрэхийн тулд admin таныг шинээр
                урих шаардлагатай.
              </p>
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() =>
                  act(async () => {
                    await leaveOrganization();
                  }, "Байгууллагаас гарлаа")
                }
              >
                Байгууллагаас гарах
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Байгууллага устгах</DialogTitle>
          </DialogHeader>
          {deleteOpen && (
            <DeleteOrgBody
              orgName={data.org.name}
              isPending={isPending}
              onDelete={(confirmName, close) =>
                act(async () => {
                  await deleteOrganization(confirmName);
                  close();
                }, "Байгууллага устгагдлаа")
              }
              onClose={() => setDeleteOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

// ── Шинэ байгууллага бүртгэх ───────────────────────────────────────────────

function CreateOrgDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <CreateOrgBody onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateOrgBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    registryNo: "",
    vatPayerNo: "",
    address: "",
    phone: "",
    email: "",
  });

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  function submit() {
    startTransition(async () => {
      try {
        await createOrganization(form);
        toast.success(`«${form.name.trim()}» бүртгэгдэж, идэвхтэй боллоо`);
        onClose();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Үүсгэж чадсангүй");
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Шинэ байгууллага бүртгэх</DialogTitle>
        <DialogDescription>
          Та шинэ байгууллагын эзэмшигч болж, систем түүн рүү шилжинэ.
          Реквизит нь нэхэмжлэх, тайланд шууд хэрэглэгдэнэ.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label>Нэр *</Label>
          <Input value={form.name} onChange={set("name")} placeholder="Жишээ ХХК" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>ТТД</Label>
            <Input value={form.registryNo} onChange={set("registryNo")} />
          </div>
          <div className="grid gap-1.5">
            <Label>НӨАТ төлөгчийн дугаар</Label>
            <Input value={form.vatPayerNo} onChange={set("vatPayerNo")} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Хаяг</Label>
          <Input value={form.address} onChange={set("address")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Утас</Label>
            <Input value={form.phone} onChange={set("phone")} />
          </div>
          <div className="grid gap-1.5">
            <Label>И-мэйл</Label>
            <Input type="email" value={form.email} onChange={set("email")} />
          </div>
        </div>
        <p className="text-[11px]" style={{ color: "var(--ea-text-4)" }}>
          Банкны данс, лого, тамга, гарын үсгийг дараа нь Тохиргоо → Компанийн
          мэдээлэл хэсэгт нэмнэ.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Болих
        </Button>
        <Button onClick={submit} disabled={isPending || !form.name.trim()}>
          Бүртгэх
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Байгууллага устгах (нэрээ бичиж баталгаажуулна) ────────────────────────

function DeleteOrgBody({
  orgName,
  isPending,
  onDelete,
  onClose,
}: {
  orgName: string;
  isPending: boolean;
  onDelete: (confirmName: string, close: () => void) => void;
  onClose: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  return (
    <div className="grid gap-3">
      <p className="text-sm" style={{ color: "var(--ea-danger-fg)" }}>
        «{orgName}»-ийн БҮХ дата (журнал, баримт, тайлан, тохиргоо) буцалтгүй
        устана. Backup-гүй бол сэргээх боломжгүй.
      </p>
      <div className="grid gap-1.5">
        <Label>Баталгаажуулахын тулд байгууллагын нэрийг яг бичнэ үү</Label>
        <Input
          value={confirmName}
          onChange={(event) => setConfirmName(event.target.value)}
          placeholder={orgName}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Болих
        </Button>
        <Button
          variant="destructive"
          disabled={isPending || confirmName.trim() !== orgName}
          onClick={() => onDelete(confirmName, onClose)}
        >
          Бүрмөсөн устгах
        </Button>
      </DialogFooter>
    </div>
  );
}
