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
  inviteMember,
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
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Гишүүн нэмэх</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="Бүртгэлтэй хэрэглэгчийн email"
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
                act(async () => {
                  await inviteMember({ email: inviteEmail, role: inviteRole });
                  setInviteOpen(false);
                  setInviteEmail("");
                }, "Гишүүн нэмэгдлээ")
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
