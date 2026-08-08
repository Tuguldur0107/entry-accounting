"use client";

// Фаз 01 — Topbar-ийн байгууллага сонгогч. Сонголт нь ea-org cookie-д
// (switchOrganization action) хадгалагдаж, бүх хуудас тухайн org-ийн
// дата харуулна. Нэг байгууллагатай хэрэглэгчид товч мэт биш, зүгээр
// нэр харагдана (org гэдэг ойлголтыг анзаарахгүй ажиллах зарчим).

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
import { Icon } from "@/components/ui/icon";
import {
  createOrganization,
  switchOrganization,
  type OrgSummary,
} from "@/lib/actions/org";
import { cn } from "@/lib/utils";

export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: OrgSummary[];
  activeOrgId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [registryNo, setRegistryNo] = useState("");
  const [isPending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const active = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  if (!active) return null;

  function choose(orgId: string) {
    setOpen(false);
    if (orgId === activeOrgId) return;
    startTransition(async () => {
      try {
        await switchOrganization(orgId);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Шилжиж чадсангүй"
        );
      }
    });
  }

  function create() {
    startTransition(async () => {
      try {
        await createOrganization({ name, registryNo });
        toast.success("Байгууллага үүсч, түүн рүү шилжлээ");
        setCreateOpen(false);
        setName("");
        setRegistryNo("");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Үүсгэж чадсангүй"
        );
      }
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ea-interactive flex max-w-44 items-center gap-1.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--ea-text-1)]"
        aria-haspopup="menu"
        aria-expanded={open}
        title={active.name}
      >
        <Icon name="company" size="sm" />
        <span className="truncate">{active.name}</span>
        <span aria-hidden style={{ color: "var(--ea-text-4)" }}>
          ⌄
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-md border p-1.5"
            style={{
              borderColor: "var(--ea-border)",
              background: "var(--ea-surface)",
              boxShadow: "var(--ea-shadow-3)",
            }}
          >
            <div
              className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--ea-text-3)" }}
            >
              Байгууллага
            </div>
            {orgs.map((org) => (
              <button
                key={org.id}
                type="button"
                role="menuitem"
                disabled={isPending}
                onClick={() => choose(org.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs",
                  org.id === activeOrgId
                    ? "bg-[var(--ea-selected-bg)] text-[var(--ea-interactive)]"
                    : "text-[var(--ea-text-1)] hover:bg-[var(--ea-hover-subtle)]"
                )}
              >
                <span className="truncate">{org.name}</span>
                {org.id === activeOrgId && <Icon name="approve" size="sm" />}
              </button>
            ))}
            <div
              className="my-1 border-t"
              style={{ borderColor: "var(--ea-border)" }}
            />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-[var(--ea-text-3)] hover:bg-[var(--ea-hover-subtle)] hover:text-[var(--ea-text-1)]"
            >
              <Icon name="add" size="sm" />
              Шинэ байгууллага
            </button>
          </div>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Шинэ байгууллага</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Нэр</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Жишээ ХХК"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>ТТД (заавал биш)</Label>
              <Input
                value={registryNo}
                onChange={(event) => setRegistryNo(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Болих
            </Button>
            <Button onClick={create} disabled={isPending || !name.trim()}>
              Үүсгэх
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
