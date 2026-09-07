"use client";

// Хэрэглэгчдийн эрх (Тохиргоо → Хэрэглэгчдийн эрх) — байгууллагын гишүүдийн
// БҮРЭН удирдлага нэг дор:
//   - гишүүн нэмэх (урилга), хүлээгдэж буй урилга цуцлах
//   - роль солих (Админ / Нягтлан / Үзэгч)
//   - модуль бүрийн нарийн эрх: Байхгүй / Унших / Бичих / Батлах
//   - мөр дээр давхар даралт → профайл (сүүлийн үйлдлүүд, хасах)
// Эзэмшигч, админ үргэлж бүрэн эрхтэй; "Байхгүй" модуль тухайн гишүүний
// навигациас нуугдаж, үйлдэл server action түвшинд хаагдана.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams, RowDoubleClickedEvent } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingInline } from "@/components/ui/loading";
import { saveMemberPermissions } from "@/lib/actions/permissions";
import {
  cancelInvitation,
  getMemberDetail,
  inviteMember,
  removeMember,
  updateMemberRole,
  type OrgInvitationView,
  type OrgMemberView,
} from "@/lib/actions/org";
import { APP_MODULE_DEFS } from "@/lib/constants/app-modules";
import { INVITABLE_ROLES, ROLE_LABELS } from "@/lib/constants/roles";
import type { MembershipRole } from "@/lib/db/schema";
import {
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_LABELS,
  defaultLevelForRole,
  parsePermissions,
  type PermissionLevel,
} from "@/lib/permissions";

interface Row {
  membershipId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: string;
  /** moduleKey → түвшин (default-аар бөглөгдсөн, бүрэн матриц). */
  levels: Record<string, PermissionLevel>;
}

function buildRow(member: OrgMemberView): Row {
  const overrides = parsePermissions(member.permissions);
  const fallback = defaultLevelForRole(member.role);
  return {
    membershipId: member.membershipId,
    name: member.name,
    email: member.email,
    role: member.role,
    joinedAt: member.joinedAt,
    levels: Object.fromEntries(
      APP_MODULE_DEFS.map((def) => [def.key, overrides[def.key] ?? fallback])
    ),
  };
}

export function PermissionsSettings({
  orgName,
  myRole,
  members,
  invitations,
}: {
  orgName: string;
  myRole: MembershipRole;
  members: OrgMemberView[];
  invitations: OrgInvitationView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profileMember, setProfileMember] = useState<OrgMemberView | null>(null);

  const canManage = myRole === "admin" || myRole === "owner";

  const [rows, setRows] = useState<Row[]>(() => members.map(buildRow));
  const [baseline, setBaseline] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      members.map(buildRow).map((row) => [row.membershipId, JSON.stringify(row.levels)])
    )
  );

  const dirtyIds = rows
    .filter((row) => JSON.stringify(row.levels) !== baseline[row.membershipId])
    .map((row) => row.membershipId);

  function setLevel(membershipId: string, moduleKey: string, level: PermissionLevel) {
    setRows((current) =>
      current.map((row) =>
        row.membershipId === membershipId
          ? { ...row, levels: { ...row.levels, [moduleKey]: level } }
          : row
      )
    );
  }

  /** Роль солих, хасах г.м шууд үйлдлүүд — амжилтад refresh. */
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

  async function save() {
    setSaving(true);
    try {
      for (const row of rows) {
        if (!dirtyIds.includes(row.membershipId)) continue;
        const result = await saveMemberPermissions(row.membershipId, row.levels);
        if (result.error) {
          toast.error(`${row.name}: ${result.error}`);
          return;
        }
      }
      setBaseline(
        Object.fromEntries(
          rows.map((row) => [row.membershipId, JSON.stringify(row.levels)])
        )
      );
      router.refresh();
      toast.success("Эрхийн тохиргоо хадгалагдлаа");
    } catch {
      toast.error("Эрхийн тохиргоо хадгалагдсангүй");
    } finally {
      setSaving(false);
    }
  }

  const columnDefs = useMemo<ColDef<Row>[]>(() => {
    const cols: ColDef<Row>[] = [
      {
        headerName: "Гишүүн",
        field: "name",
        minWidth: 170,
        flex: 1,
        pinned: "left",
        cellRenderer: (params: ICellRendererParams<Row>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <div className="leading-tight">
              <div className="text-xs font-medium text-[var(--ea-text-1)]">
                {row.name}
              </div>
              <div className="text-[10px] text-[var(--ea-text-4)]">
                {row.email}
              </div>
            </div>
          );
        },
      },
      {
        headerName: "Роль",
        field: "role",
        width: 110,
        cellClass: "flex items-center",
        cellRenderer: (params: ICellRendererParams<Row>) => {
          const row = params.data;
          if (!row) return null;
          // Эзэмшигчийн ролийг солихгүй; зөвхөн админ солино.
          if (!canManage || row.role === "owner")
            return (
              <span className="text-xs text-[var(--ea-text-1)]">
                {ROLE_LABELS[row.role]}
              </span>
            );
          return (
            <select
              className="ea-form-select !h-7 !rounded !px-1.5 !text-xs"
              value={row.role}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                act(
                  () =>
                    updateMemberRole({
                      membershipId: row.membershipId,
                      role: event.target.value as MembershipRole,
                    }),
                  "Роль өөрчлөгдлөө"
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
      {
        headerName: "Элссэн",
        field: "joinedAt",
        width: 104,
        cellClass: "font-mono text-xs",
      },
    ];
    for (const def of APP_MODULE_DEFS) {
      cols.push({
        headerName: def.key.toUpperCase(),
        colId: `perm-${def.key}`,
        headerTooltip: def.nameMn,
        width: 104,
        sortable: false,
        cellClass: "flex items-center",
        valueGetter: (params) => (params.data ? params.data.levels[def.key] : ""),
        cellRenderer: (params: ICellRendererParams<Row>) => {
          const row = params.data;
          if (!row) return null;
          // Эзэмшигч, админ — үргэлж бүрэн (түгжээтэй).
          if (row.role === "owner" || row.role === "admin")
            return (
              <span className="text-[11px] text-[var(--ea-text-4)]">Бүрэн</span>
            );
          if (!canManage)
            return (
              <span className="text-[11px] text-[var(--ea-text-1)]">
                {PERMISSION_LEVEL_LABELS[row.levels[def.key]]}
              </span>
            );
          return (
            <select
              className="ea-form-select !h-7 !rounded !px-1.5 !text-xs"
              value={row.levels[def.key]}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                setLevel(
                  row.membershipId,
                  def.key,
                  event.target.value as PermissionLevel
                )
              }
            >
              {PERMISSION_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {PERMISSION_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          );
        },
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Хэрэглэгчдийн эрх
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ea-text-3)" }}>
            «{orgName}»-ийн гишүүд, тэдний роль болон модуль бүрийн эрх:
            Байхгүй (нуугдана) → Унших → Бичих (ноорог) → Батлах (бүрэн).
            Мөр дээр давхар даралт — гишүүний профайл.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyIds.length > 0 && (
            <>
              <span className="text-xs" style={{ color: "var(--ea-text-3)" }}>
                {dirtyIds.length} гишүүний өөрчлөлт
              </span>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Хадгалж байна…" : "Хадгалах"}
              </Button>
            </>
          )}
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              <Icon name="add" size="sm" />
              Гишүүн нэмэх
            </Button>
          )}
        </div>
      </div>

      <DataGridDynamic<Row>
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(params) => params.data.membershipId}
        height="flex"
        rowHeight={44}
        wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        suppressCellFocus
        onRowDoubleClicked={(event: RowDoubleClickedEvent<Row>) => {
          const member = members.find(
            (entry) => entry.membershipId === event.data?.membershipId
          );
          if (member) setProfileMember(member);
        }}
      />

      {/* Хүлээгдэж буй урилгууд — бүртгүүлмэгц гишүүн болно */}
      {invitations.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold" style={{ color: "var(--ea-text-2)" }}>
            Хүлээгдэж буй урилга
          </h4>
          <ul className="space-y-1.5">
            {invitations.map((invitation) => (
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
                      act(() => cancelInvitation(invitation.id), "Урилга цуцлагдлаа")
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

      <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
        Роль нь суурь эрх (Нягтлан — бүх модульд Батлах, Үзэгч — Унших) бөгөөд
        модуль бүрээр нь нарийвчилна. Эзэмшигч, админ үргэлж бүрэн эрхтэй.
      </p>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          {inviteOpen && (
            <InviteBody
              orgName={orgName}
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
    </section>
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
          <Label>Роль</Label>
          <select
            className="ea-form-select"
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
            батална. Үзэгч — зөвхөн харна. Нэмсний дараа модуль бүрийн эрхийг
            матрицаас нарийвчилна.
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
            <div style={{ color: "var(--ea-text-4)" }}>Роль</div>
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
