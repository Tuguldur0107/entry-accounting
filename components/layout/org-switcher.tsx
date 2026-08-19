"use client";

// Фаз 01 — Topbar-ийн байгууллага сонгогч. Сонголт нь ea-org cookie-д
// (switchOrganization action) хадгалагдаж, бүх хуудас тухайн org-ийн
// дата харуулна. Нэг байгууллагатай хэрэглэгчид товч мэт биш, зүгээр
// нэр харагдана (org гэдэг ойлголтыг анзаарахгүй ажиллах зарчим).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
} from "@/components/ui/dropdown";
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
    <div className="relative">
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        panelClassName="w-64"
        trigger={
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
        }
      >
        <DropdownLabel>Байгууллага</DropdownLabel>
        {orgs.map((org) => (
          <DropdownItem
            key={org.id}
            disabled={isPending}
            selected={org.id === activeOrgId}
            className="justify-between"
            onSelect={() => choose(org.id)}
          >
            <span className="truncate">{org.name}</span>
            {org.id === activeOrgId && <Icon name="approve" size="sm" />}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem
          className="text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]"
          onSelect={() => {
            setOpen(false);
            setCreateOpen(true);
          }}
        >
          <Icon name="add" size="sm" />
          Шинэ байгууллага
        </DropdownItem>
      </Dropdown>

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
