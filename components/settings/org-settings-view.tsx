"use client";

// Удирдлага → Байгууллага, гишүүд — master-detail:
//   Зүүн: миний байгууллагууд (сонгох = идэвхжүүлэх, + шинэ компани бүртгэх)
//   Баруун: ИДЭВХТЭЙ байгууллагын дэлгэрэнгүй — мэдээлэл, гишүүд, урилга.
// Гишүүн дээр давхар даралт → профайл (мэдээлэл + сүүлийн үйлдлүүд).
// Урилга: бүртгэлтэй и-мэйл шууд гишүүн, бүртгэлгүй бол токентой урилга.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColDef, RowDoubleClickedEvent } from "ag-grid-community";

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
import { LoadingInline } from "@/components/ui/loading";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { CompanySettingsForm } from "@/components/settings/company-settings-form";
import {
  cancelInvitation,
  createOrganization,
  deleteOrganization,
  getMemberDetail,
  inviteMember,
  leaveOrganization,
  removeMember,
  switchOrganization,
  updateMemberRole,
  type OrgMemberView,
  type OrgSettingsData,
} from "@/lib/actions/org";
import type { CompanySettings, MembershipRole } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "Эзэмшигч",
  admin: "Админ",
  accountant: "Нягтлан",
  viewer: "Үзэгч",
};

const INVITABLE_ROLES: MembershipRole[] = ["admin", "accountant", "viewer"];

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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [profileMember, setProfileMember] = useState<OrgMemberView | null>(null);

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

  const columns = useMemo<ColDef<OrgMemberView>[]>(
    () => [
      { field: "name", headerName: "Нэр", flex: 1, minWidth: 140 },
      { field: "email", headerName: "Email", flex: 1, minWidth: 180 },
      {
        field: "joinedAt",
        headerName: "Элссэн",
        width: 110,
        cellClass: "font-mono text-xs",
      },
      {
        field: "role",
        headerName: "Эрх",
        width: 150,
        cellRenderer: (params: { data?: OrgMemberView }) => {
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
              onClick={(event) => event.stopPropagation()}
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
    ],
    [canManage] // eslint-disable-line react-hooks/exhaustive-deps
  );

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

      {/* ── Баруун: идэвхтэй байгууллагын дэлгэрэнгүй ──────────────────── */}
      <div className="min-w-0 max-w-3xl flex-1 space-y-6">
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

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Гишүүд</h3>
              <p className="text-[11px]" style={{ color: "var(--ea-text-4)" }}>
                Мөр дээр давхар даралт — гишүүний профайл
              </p>
            </div>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
                <Icon name="add" size="sm" />
                Гишүүн нэмэх
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
            onRowDoubleClicked={(event: RowDoubleClickedEvent<OrgMemberView>) => {
              if (event.data) setProfileMember(event.data);
            }}
          />

          {/* Хүлээгдэж буй урилгууд — бүртгүүлмэгц гишүүн болно */}
          {data.invitations.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold" style={{ color: "var(--ea-text-2)" }}>
                Хүлээгдэж буй урилга
              </h4>
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
                    <span
                      className="min-w-0 flex-1 truncate"
                      style={{ color: "var(--ea-text-1)" }}
                    >
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

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          {inviteOpen && (
            <InviteBody
              orgName={data.org.name}
              isPending={isPending}
              onInvite={(email, role, close) =>
                startTransition(async () => {
                  try {
                    const result = await inviteMember({ email, role });
                    if (result.outcome === "added") {
                      toast.success("Гишүүн нэмэгдлээ");
                    } else if (result.emailed) {
                      toast.success(
                        "Урилгын и-мэйл илгээгдлээ — бүртгүүлмэгц гишүүн болно"
                      );
                    } else {
                      await navigator.clipboard
                        .writeText(result.url)
                        .catch(() => undefined);
                      toast.success(
                        "Урилгын линк хуулагдлаа — и-мэйл тохиргоогүй тул линкийг өөрөө дамжуулна уу"
                      );
                    }
                    close();
                    router.refresh();
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Амжилтгүй"
                    );
                  }
                })
              }
              onClose={() => setInviteOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={profileMember !== null}
        onOpenChange={(open) => !open && setProfileMember(null)}
      >
        <DialogContent className="sm:max-w-md">
          {profileMember && (
            <MemberProfileBody
              member={profileMember}
              canManage={canManage}
              isPending={isPending}
              onRemove={() =>
                act(async () => {
                  await removeMember(profileMember.membershipId);
                  setProfileMember(null);
                }, "Гишүүн хасагдлаа")
              }
              onClose={() => setProfileMember(null)}
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

// ── Гишүүн урих ────────────────────────────────────────────────────────────

function InviteBody({
  orgName,
  isPending,
  onInvite,
  onClose,
}: {
  orgName: string;
  isPending: boolean;
  onInvite: (email: string, role: MembershipRole, close: () => void) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("accountant");

  return (
    <>
      <DialogHeader>
        <DialogTitle>«{orgName}» — гишүүн нэмэх</DialogTitle>
        <DialogDescription>
          Гишүүн болмогц энэ байгууллагын бүх бүртгэлийг эрхийнхээ хүрээнд
          харна. Бүртгэлтэй и-мэйл шууд нэмэгдэнэ; бүртгэлгүй бол урилгын линк
          илгээгдэж, бүртгүүлмэгц гишүүн болно.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
            value={role}
            onChange={(event) => setRole(event.target.value as MembershipRole)}
          >
            {INVITABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
          <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
            Админ — гишүүд, тохиргоог удирдана. Нягтлан — бичилт үүсгэж,
            батална; период хаахгүй. Үзэгч — зөвхөн харна.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Болих
        </Button>
        <Button
          disabled={isPending || !email.trim()}
          onClick={() => onInvite(email, role, onClose)}
        >
          Нэмэх
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Гишүүний профайл ───────────────────────────────────────────────────────

type MemberDetail = Awaited<ReturnType<typeof getMemberDetail>>;

function MemberProfileBody({
  member,
  canManage,
  isPending,
  onRemove,
  onClose,
}: {
  member: OrgMemberView;
  canManage: boolean;
  isPending: boolean;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [failed, setFailed] = useState(false);

  // Mount үед дэлгэрэнгүйг ачаална (нээх бүрд шинээр mount хийгддэг).
  useEffect(() => {
    let cancelled = false;
    getMemberDetail(member.membershipId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [member.membershipId]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{member.name}</DialogTitle>
        <DialogDescription>{member.email}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 text-sm">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div style={{ color: "var(--ea-text-4)" }}>Эрх</div>
            <div style={{ color: "var(--ea-text-1)" }}>
              {ROLE_LABELS[member.role]}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--ea-text-4)" }}>Элссэн огноо</div>
            <div className="font-mono" style={{ color: "var(--ea-text-1)" }}>
              {member.joinedAt}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold" style={{ color: "var(--ea-text-2)" }}>
            Сүүлийн үйлдлүүд
          </div>
          {failed ? (
            <p className="text-xs" style={{ color: "var(--ea-text-4)" }}>
              Ачаалж чадсангүй.
            </p>
          ) : detail === null ? (
            <LoadingInline />
          ) : detail.recentEvents.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--ea-text-4)" }}>
              Бүртгэгдсэн үйлдэл алга.
            </p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {detail.recentEvents.map((event) => (
                <li
                  key={event.id}
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    borderColor: "var(--ea-border)",
                    background: "var(--ea-bg-2)",
                  }}
                >
                  <span style={{ color: "var(--ea-text-1)" }}>
                    {event.summary || `${event.action} · ${event.entityType}`}
                  </span>
                  <span className="ml-2 font-mono" style={{ color: "var(--ea-text-4)" }}>
                    {event.at}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <DialogFooter className="sm:justify-between">
        {canManage && member.role !== "owner" ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={onRemove}
          >
            Байгууллагаас хасах
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outline" onClick={onClose}>
          Хаах
        </Button>
      </DialogFooter>
    </>
  );
}
