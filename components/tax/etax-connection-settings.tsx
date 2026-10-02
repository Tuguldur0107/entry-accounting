"use client";

// eTax холболтын тохиргоо (docs/dev/etax.md) — байгууллагын ITC (auth.itc.gov.mn)
// нэвтрэлт. Нууц үг write-only — хоосон бол хуучнаа хадгална. Админ+ л. «Шалгах» нь
// зөвхөн Keycloak-аас token авна — ТЕГ рүү юу ч илгээхгүй.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FormField, SwitchField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips } from "@/components/ui/tabs";
import { deleteEtaxConnection, saveEtaxConnection, testEtaxConnection } from "@/lib/actions/etax";
import { fmtDateTimeUb } from "@/lib/format/datetime";
import type { EtaxConnectionView } from "@/lib/itc/etax/types";
import { feedback } from "@/lib/ui/feedback";

const ENVIRONMENT_OPTIONS = [
  { value: "production" as const, label: "Бодит орчин" },
  { value: "staging" as const, label: "Туршилтын орчин" },
];

export function EtaxConnectionSettings({ connection }: { connection: EtaxConnectionView | null }) {
  const router = useRouter();
  const [environment, setEnvironment] = useState<"production" | "staging">(connection?.environment ?? "production");
  const [username, setUsername] = useState(connection?.username ?? "");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(connection?.isEnabled ?? true);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const { error } = await saveEtaxConnection({ environment, username, password, isEnabled: enabled });
      if (error) {
        feedback.error(error);
        return;
      }
      setPassword("");
      feedback.saved("eTax холболт хадгалагдлаа");
      router.refresh();
    });
  }

  function check() {
    startTransition(async () => {
      const { error, expiresAt } = await testEtaxConnection();
      if (error || !expiresAt) feedback.error(error ?? "eTax нэвтрэлт амжилтгүй");
      else feedback.saved(`ITC нэвтрэлт амжилттай — token ${fmtDateTimeUb(expiresAt) ?? ""} хүртэл`);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("eTax холболтыг устгах уу? Илгээлтийн түүх хэвээр үлдэнэ.")) return;
    startTransition(async () => {
      const { error } = await deleteEtaxConnection();
      if (error) feedback.error(error);
      else {
        setUsername("");
        setPassword("");
        feedback.saved("eTax холболт устгагдлаа");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 rounded-lg border p-4" style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">ITC нэвтрэлт (eTax)</h2>
          <p className="text-xs text-[var(--ea-text-3)]">
            etax.mta.mn-д нэвтэрдэг нэвтрэх нэр, нууц үг — Нэвтрэлтийн нэгдсэн систем (auth.itc.gov.mn). Нууц үг шифртэй
            хадгалагдана, хэзээ ч харагдахгүй.
          </p>
        </div>
        {connection ? (
          connection.lastCheckError ? (
            <StatusBadge tone="danger" size="sm">
              Шалгалт алдаатай
            </StatusBadge>
          ) : connection.lastCheckOkAt ? (
            <StatusBadge tone="success" size="sm">
              Нэвтрэлт шалгагдсан
            </StatusBadge>
          ) : (
            <StatusBadge tone="muted" size="sm">
              Шалгаагүй
            </StatusBadge>
          )
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Орчин" className="md:col-span-2">
          <FilterChips options={ENVIRONMENT_OPTIONS} value={environment} onChange={setEnvironment} />
        </FormField>
        <FormField label="Нэвтрэх нэр" htmlFor="etax-username">
          <Input id="etax-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField
          label="Нууц үг"
          htmlFor="etax-password"
          hint={connection?.hasPassword ? "Хадгалагдсан — солих бол шинээр бичнэ" : "Анх холбоход заавал"}
        >
          <Input
            id="etax-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </FormField>
        <SwitchField label="Идэвхтэй" checked={enabled} onChange={setEnabled} className="md:col-span-2" />
      </div>

      {connection ? (
        <div className="text-xs text-[var(--ea-text-3)]">
          Сүүлийн шалгалт: {fmtDateTimeUb(connection.lastCheckAt) ?? "—"}
          {connection.lastCheckError ? (
            <span className="ml-2 text-[var(--ea-danger-fg)]">{connection.lastCheckError}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={isPending}>
          Хадгалах
        </Button>
        <Button size="sm" variant="outline" onClick={check} disabled={isPending || !connection}>
          Нэвтрэлт шалгах
        </Button>
        {connection ? (
          <Button size="sm" variant="ghost" onClick={remove} disabled={isPending}>
            Устгах
          </Button>
        ) : null}
      </div>
    </div>
  );
}
