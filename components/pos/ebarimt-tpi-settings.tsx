"use client";

// POS тохиргоо → eBarimt → «ТЕГ-ийн тулгалт (TPI)» (docs/dev/ebarimt-tax-reconcile.md).
// Байгууллагын өөрийн ITC нэвтрэлтээр ТЕГ-ээс нэхэмжлэх ба төлбөрийн баримтыг өдөр
// бүр татаж, порталын «Үлдэгдэл»-ийг Entry-ийн авлагатай тулгана. ЗӨВХӨН унших.
// Нууц үг / X-API-KEY write-only — хоосон бол хуучнаа хадгална. Админ+ л.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FormField, SwitchField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips } from "@/components/ui/tabs";
import {
  deleteEbarimtTpiConnection,
  getEbarimtTpiConnection,
  saveEbarimtTpiConnection,
  syncEbarimtTaxNow,
  testEbarimtTpiConnection,
} from "@/lib/actions/ebarimt-tpi";
import type { EbarimtTpiConnectionView } from "@/lib/ebarimt/tax-reconcile";
import { feedback } from "@/lib/ui/feedback";

const ENVIRONMENT_OPTIONS = [
  { value: "production" as const, label: "Бодит орчин" },
  { value: "staging" as const, label: "Туршилтын орчин" },
];

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", dateStyle: "short", timeStyle: "short" }) : "—";

export function EbarimtTpiSettings() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [connection, setConnection] = useState<EbarimtTpiConnectionView | null>(null);
  const [environment, setEnvironment] = useState<"production" | "staging">("production");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isPending, startTransition] = useTransition();

  function apply(next: EbarimtTpiConnectionView | null) {
    setConnection(next);
    if (next) {
      setEnvironment(next.environment);
      setUsername(next.username);
      setEnabled(next.isEnabled);
    }
    setPassword("");
    setApiKey("");
  }

  useEffect(() => {
    let cancelled = false;
    void getEbarimtTpiConnection().then((result) => {
      if (cancelled) return;
      if (result.error) setForbidden(result.error);
      else apply(result.connection ?? null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function save() {
    startTransition(async () => {
      const { error, connection: saved } = await saveEbarimtTpiConnection({ environment, username, password, apiKey, isEnabled: enabled });
      if (error || !saved) {
        feedback.error(error ?? "ТЕГ-ийн TPI холболт хадгалагдсангүй");
        return;
      }
      apply(saved);
      feedback.saved("ТЕГ-ийн TPI холболт хадгалагдлаа");
      router.refresh();
    });
  }

  function test() {
    startTransition(async () => {
      const result = await testEbarimtTpiConnection();
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved(
        result.invoicesToday === null
          ? "ITC нэвтрэлт амжилттай — борлуулалтын задаргааны сервис зөвхөн 01:00–07:00 цагт ажилладаг тул өгөгдлийг тэр цагт шалгана"
          : `ТЕГ-тэй холбогдлоо — өнөөдрийн нэхэмжлэх ${result.invoicesToday}${result.skipped ? `, танигдаагүй мөр ${result.skipped}` : ""}`
      );
    });
  }

  function sync() {
    startTransition(async () => {
      const { error, days, invoices, payments, summary, caughtUp } = await syncEbarimtTaxNow();
      if (error || !days || !summary) {
        feedback.error(error ?? "ТЕГ-ээс татаж чадсангүй");
      } else {
        feedback.saved(
          `${days.length} өдөр татав: нэхэмжлэх ${invoices}, төлбөрийн баримт ${payments}; зөрүүтэй ${summary.problems}${caughtUp ? "" : " — үлдсэнийг хуваарьт татлага үргэлжлүүлнэ"}`
        );
      }
      const refreshed = await getEbarimtTpiConnection();
      if (!refreshed.error) apply(refreshed.connection ?? null);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("ТЕГ-ийн TPI холболтыг устгах уу? Нууц мэдээлэл устна, татсан баримт үлдэнэ.")) return;
    startTransition(async () => {
      const result = await deleteEbarimtTpiConnection();
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      apply(null);
      setUsername("");
      feedback.saved("ТЕГ-ийн TPI холболт устгагдлаа");
      router.refresh();
    });
  }

  if (!loaded) return null;

  return (
    <div className="space-y-3 rounded-md border border-[var(--ea-border)] p-3">
      <div>
        <div className="text-sm font-semibold text-[var(--ea-text-1)]">ТЕГ-ийн тулгалт — нэхэмжлэхийн үлдэгдэл (TPI)</div>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          ТЕГ-ээс нэхэмжлэх ба түүний төлбөрийн баримтыг өдөр бүр шөнө (01:00–07:00 — ТЕГ-ийн сервисийн цаг) автоматаар татаж, ТЕГ-ийн порталын
          «Үлдэгдэл»-ийг Entry-ийн авлагын үлдэгдэлтэй тулгана. Зөрүүг (порталд гараар нэмсэн төлөлт, ТЕГ-д хүрээгүй
          баримт) «Анхаарах» ба Авлага → eBarimt-д шалтгаантай нь харуулна. ТЕГ-д юу ч бичихгүй.
        </p>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Нэвтрэлт: байгууллагын eBarimt-д эрхтэй ITC хэрэглэгч. X-API-KEY-г ITC олгоно (posapi@itc.gov.mn); хоосон
          бол серверийн тохиргоогоор.
        </p>
      </div>
      {forbidden ? (
        <div className="text-xs text-[var(--ea-text-3)]">Энэ холболтыг зөвхөн админ тохируулна.</div>
      ) : (
        <>
          {connection && (
            <div className="space-y-1 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={connection.lastSyncError ? "danger" : connection.lastSyncOkAt ? "success" : "muted"} size="sm">
                  {connection.lastSyncError ? "Алдаатай" : connection.lastSyncOkAt ? "Татаж байна" : "Татаагүй"}
                </StatusBadge>
                <span className="text-[var(--ea-text-3)]">
                  Сүүлд амжилттай: {formatTime(connection.lastSyncOkAt)} · {connection.syncFrom ?? "—"} → {connection.syncedThrough ?? "—"}
                </span>
                {connection.summary && (
                  <span className={connection.summary.problems ? "text-[var(--ea-danger-fg)]" : "text-[var(--ea-text-3)]"}>
                    Тулгасан {connection.summary.checked}, зөрүүтэй {connection.summary.problems}
                  </span>
                )}
              </div>
              {connection.lastSyncError && <div className="text-[var(--ea-danger-fg)]">{connection.lastSyncError}</div>}
              {connection.lastSyncSkipped > 0 && (
                <div className="text-[var(--ea-warning-fg)]">
                  ТЕГ-ийн хариунаас {connection.lastSyncSkipped} мөр танигдаагүй тул алгасав — тулгалт бүрэн биш байж болно
                </div>
              )}
            </div>
          )}
          <FormField label="Орчин">
            <FilterChips options={ENVIRONMENT_OPTIONS} value={environment} onChange={setEnvironment} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="ITC нэвтрэх нэр">
              <Input value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
            </FormField>
            <FormField label="Нууц үг" hint={connection?.hasPassword ? "Хадгалагдсан — солих бол л бичнэ" : "Анх холбоход заавал"}>
              <Input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <FormField
              label="X-API-KEY"
              hint={
                connection?.hasApiKey
                  ? "Байгууллагын түлхүүр хадгалагдсан — солих бол л бичнэ"
                  : connection?.serverApiKey
                    ? "Хоосон — серверийн түлхүүрээр"
                    : "Серверт ч тохируулаагүй — ITC-ээс авна"
              }
            >
              <Input type="password" value={apiKey} autoComplete="off" onChange={(e) => setApiKey(e.target.value)} />
            </FormField>
          </div>
          <SwitchField label="Өдөр бүр автоматаар татах" checked={enabled} onChange={setEnabled} />
          <div className="flex flex-wrap justify-end gap-2">
            {connection && (
              <>
                <Button variant="outline" onClick={remove} disabled={isPending}>
                  Устгах
                </Button>
                <Button variant="outline" onClick={test} disabled={isPending}>
                  Холболт шалгах
                </Button>
                <Button variant="outline" onClick={sync} disabled={isPending || !connection.isEnabled}>
                  Одоо татах
                </Button>
              </>
            )}
            <Button onClick={save} disabled={isPending}>
              {isPending ? "Түр хүлээнэ үү…" : "Хадгалах"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
