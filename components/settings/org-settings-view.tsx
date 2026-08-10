"use client";

// Фаз 01 — Тохиргоо → Байгууллага: нэр/ТТД, гишүүд, эрх.
// Гишүүн урих: бүртгэлтэй email шууд нэмэгдэнэ (pending урилга —
// дараагийн сайжруулалт). Эрхийн шатлал: owner > admin > accountant > viewer.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import {
  cancelInvitation,
  deleteOrganization,
  inviteMember,
  leaveOrganization,
  removeMember,
  updateMemberRole,
  updateOrganization,
  type OrgMemberView,
  type OrgSettingsData,
} from "@/lib/actions/org";
import type { MembershipRole } from "@/lib/db/schema";

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Эзэмшигч",
  admin: "Админ",
  accountant: "Нягтлан",
  viewer: "Үзэгч",
};

const INVITABLE_ROLES: MembershipRole[] = ["admin", "accountant", "viewer"];

export function OrgSettingsView({ data }: { data: OrgSettingsData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(data.org.name);
  const [registryNo, setRegistryNo] = useState(data.org.registryNo ?? "");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MembershipRole>("accountant");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const canManage = data.myRole === "admin" || data.myRole === "owner";

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

  const columns = useMemo<ColDef<OrgMemberView>[]>(
    () => [
      { field: "name", headerName: "Нэр", flex: 1, minWidth: 140 },
      { field: "email", headerName: "Email", flex: 1, minWidth: 180 },
      {
        field: "role",
        headerName: "Эрх",
        width: 150,
        cellRenderer: (params: ICellRendererParams<OrgMemberView>) => {
          const member = params.data;
          if (!member) return null;
          if (!canManage || member.role === "owner")
            return <span>{ROLE_LABELS[member.role]}</span>;
          return (
            <select
              className="w-full rounded border bg-transparent px-1 py-0.5 text-xs"
              style={{
                borderColor: "var(--ea-border)",
                color: "var(--ea-text-1)",
              }}
              value={member.role}
              onChange={(event) =>
                act(
                  () =>
                    updateMemberRole({
                      membershipId: member.membershipId,
                      role: event.target.value as MembershipRole,
                    }),
                  "Эрх өөрчлөгдлөө"
                )
              }
            >
              {INVITABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          );
        },
      },
      ...(canManage
        ? [
            {
              headerName: "",
              width: 90,
              cellRenderer: (params: ICellRendererParams<OrgMemberView>) => {
                const member = params.data;
                if (!member || member.role === "owner") return null;
                return (
                  <button
                    type="button"
                    className="text-xs underline"
                    style={{ color: "var(--ea-danger-fg)" }}
                    onClick={() =>
                      act(
                        () => removeMember(member.membershipId),
                        "Гишүүн хасагдлаа"
                      )
                    }
                  >
                    Хасах
                  </button>
                );
              },
            } as ColDef<OrgMemberView>,
          ]
        : []),
    ],
    [canManage] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Байгууллага</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ea-text-3)" }}>
          Таны эрх: {ROLE_LABELS[data.myRole]} · Гишүүд {data.members.length}
        </p>
      </div>

      <div
        className="space-y-3 rounded-lg border p-4"
        style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}
      >
        <h2 className="text-sm font-semibold">Мэдээлэл</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Нэр</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>ТТД</Label>
            <Input
              value={registryNo}
              onChange={(event) => setRegistryNo(event.target.value)}
              disabled={!canManage}
            />
          </div>
        </div>
        {canManage && (
          <Button
            size="sm"
            disabled={isPending || !name.trim()}
            onClick={() =>
              act(
                () => updateOrganization({ name, registryNo }),
                "Хадгалагдлаа"
              )
            }
          >
            Хадгалах
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Гишүүд</h2>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              + Гишүүн нэмэх
            </Button>
          )}
        </div>
        <DataGridDynamic<OrgMemberView>
          rowData={data.members}
          columnDefs={columns}
          getRowId={(params) => params.data.membershipId}
          height={Math.min(400, 86 + data.members.length * 38)}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />

        {/* Хүлээгдэж буй урилгууд — бүртгүүлмэгц гишүүн болно */}
        {data.invitations.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold" style={{ color: "var(--ea-text-2)" }}>
              Хүлээгдэж буй урилга
            </h3>
            <ul className="space-y-1.5">
              {data.invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                  style={{
                    borderColor: "var(--ea-border)",
                    background: "var(--ea-bg-2)",
                  }}
                >
                  <span className="min-w-0 flex-1 truncate" style={{ color: "var(--ea-text-1)" }}>
                    {invitation.email}
                    <span className="ml-2" style={{ color: "var(--ea-text-4)" }}>
                      {ROLE_LABELS[invitation.role]} · {invitation.createdAt}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(invitation.url)
                        .then(() => toast.success("Урилгын линк хуулагдлаа"))
                        .catch(() => toast.error("Хуулж чадсангүй"));
                    }}
                  >
                    Линк хуулах
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      className="text-xs underline"
                      style={{ color: "var(--ea-danger-fg)" }}
                      onClick={() =>
                        act(
                          () => cancelInvitation(invitation.id),
                          "Урилга цуцлагдлаа"
                        )
                      }
                    >
                      Цуцлах
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Аюултай бүс — owner: устгах, бусад гишүүн: гарах */}
      <div
        className="space-y-3 rounded-lg border p-4"
        style={{
          borderColor: "color-mix(in srgb, var(--ea-danger) 40%, transparent)",
          background: "var(--ea-surface)",
        }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--ea-danger-fg)" }}>
          Аюултай бүс
        </h2>
        {data.myRole === "owner" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
              Байгууллагыг устгавал журнал, баримт, тохиргоо — БҮХ дата
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

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Байгууллага устгах</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-sm" style={{ color: "var(--ea-danger-fg)" }}>
              «{data.org.name}»-ийн БҮХ дата (журнал, баримт, тайлан, тохиргоо)
              буцалтгүй устана. Backup-гүй бол сэргээх боломжгүй.
            </p>
            <div className="grid gap-1.5">
              <Label>
                Баталгаажуулахын тулд байгууллагын нэрийг яг бичнэ үү
              </Label>
              <Input
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder={data.org.name}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Болих
            </Button>
            <Button
              variant="destructive"
              disabled={isPending || deleteConfirm.trim() !== data.org.name}
              onClick={() =>
                act(async () => {
                  await deleteOrganization(deleteConfirm);
                  setDeleteOpen(false);
                }, "Байгууллага устгагдлаа")
              }
            >
              Бүрмөсөн устгах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>«{data.org.name}» — гишүүн нэмэх</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
              Гишүүн болмогц энэ байгууллагын бүх бүртгэлийг эрхийнхээ хүрээнд
              харна. Бүртгэлтэй и-мэйл шууд нэмэгдэнэ; бүртгэлгүй бол урилгын
              линк илгээгдэж, бүртгүүлмэгц гишүүн болно.
            </p>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="hongorzul@company.mn"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Эрх</Label>
              <select
                className="rounded-md border px-3 py-2 text-sm"
                style={{
                  borderColor: "var(--ea-border)",
                  background: "var(--ea-bg)",
                  color: "var(--ea-text-1)",
                }}
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as MembershipRole)
                }
              >
                {INVITABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
                Нягтлан — бичилт үүсгэж, батална; период хаахгүй. Үзэгч — зөвхөн
                харна.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Болих
            </Button>
            <Button
              disabled={isPending || !inviteEmail.trim()}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const result = await inviteMember({
                      email: inviteEmail,
                      role: inviteRole,
                    });
                    if (result.outcome === "added") {
                      toast.success("Гишүүн нэмэгдлээ");
                    } else if (result.emailed) {
                      toast.success("Урилгын и-мэйл илгээгдлээ — бүртгүүлмэгц гишүүн болно");
                    } else {
                      await navigator.clipboard
                        .writeText(result.url)
                        .catch(() => undefined);
                      toast.success(
                        "Урилгын линк хуулагдлаа — и-мэйл тохиргоогүй тул линкийг өөрөө дамжуулна уу"
                      );
                    }
                    setInviteOpen(false);
                    setInviteEmail("");
                    router.refresh();
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Амжилтгүй"
                    );
                  }
                })
              }
            >
              Нэмэх
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
