"use client";

// Голомт банкны API (Фаз 1 — ЗӨВХӨН унших; docs/dev/bank-api.md):
//   GolomtConnectionDialog — холболтын тохиргоо (admin+): орчин, нэвтрэх нэр,
//     нууц үг / session key / IV key (write-only — дахин харагдахгүй), шалгах.
//   GolomtFetchDialog — огнооны муж сонгоод хуулга татах; үр дүн нь файлын
//     импорттой ижил хянах хүснэгт рүү орно (GL-д шууд бичихгүй).

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, SwitchField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  deleteGolomtConnection,
  fetchGolomtStatement,
  saveGolomtConnection,
  testGolomtConnection,
} from "@/lib/actions/bank-api";
import {
  GOLOMT_ENVIRONMENTS,
  GOLOMT_ENVIRONMENT_LABELS,
  GOLOMT_STATEMENT_MAX_DAYS,
  golomtStatementRangeError,
  type GolomtAccountSummary,
  type GolomtConnectionView,
  type GolomtEnvironment,
} from "@/lib/bank/golomt/constants";
import type { ParsedBankStatement } from "@/lib/cash/bank-statement-types";
import { fmtDateTimeUb } from "@/lib/format/datetime";
import { ulaanbaatarToday } from "@/lib/periods/document-date";
import { feedback } from "@/lib/ui/feedback";

type TestResult = {
  accounts: GolomtAccountSummary[];
  matched: { cashAccountName: string; accountId: string; found: boolean }[];
};

export function GolomtConnectionDialog({
  open,
  onOpenChange,
  connection,
  defaultRegisterNo,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: GolomtConnectionView | null;
  defaultRegisterNo: string;
  onChanged: (connection: GolomtConnectionView | null) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [environment, setEnvironment] = useState<GolomtEnvironment>(
    connection?.environment ?? "uat"
  );
  const [username, setUsername] = useState(connection?.username ?? "");
  const [password, setPassword] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const [ivKey, setIvKey] = useState("");
  const [clientId, setClientId] = useState(connection?.clientId ?? "");
  const [registerNo, setRegisterNo] = useState(
    connection?.registerNo || defaultRegisterNo
  );
  const [isEnabled, setIsEnabled] = useState(connection?.isEnabled ?? true);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const secretHint = connection?.hasSecrets
    ? "Хадгалагдсан — солих бол л шинээр бичнэ"
    : null;

  function save() {
    setError("");
    startTransition(async () => {
      const result = await saveGolomtConnection({
        environment,
        username,
        password,
        sessionKey,
        ivKey,
        clientId,
        registerNo,
        isEnabled,
      });
      const { connection: saved, error: saveError } = result;
      if (saveError || !saved) {
        setError(saveError ?? "Голомтын холболт хадгалагдсангүй");
        feedback.error();
        return;
      }
      setPassword("");
      setSessionKey("");
      setIvKey("");
      setTestResult(null);
      onChanged(saved);
      feedback.saved("Голомтын холболт хадгалагдлаа");
    });
  }

  function test() {
    setError("");
    setTestResult(null);
    startTransition(async () => {
      const { accounts, matched, error: testError } = await testGolomtConnection();
      if (testError || !accounts || !matched) {
        setError(testError ?? "Голомт банктай холбогдож чадсангүй");
        feedback.error();
        return;
      }
      setTestResult({ accounts, matched });
      feedback.saved("Голомт банктай амжилттай холбогдлоо");
    });
  }

  async function remove() {
    const ok = await confirm({
      title: "Голомтын холболтыг устгах уу?",
      description:
        "Хадгалсан нэвтрэх нэр, нууц үг, түлхүүрүүд устна. Өмнө импортолсон хуулга хэвээр үлдэнэ.",
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteGolomtConnection();
      if (result.error) {
        setError(result.error);
        feedback.error();
        return;
      }
      onChanged(null);
      onOpenChange(false);
      feedback.saved("Голомтын холболт устгагдлаа");
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Голомт банкны API холболт</DialogTitle>
            <DialogDescription>
              Банкнаас өгсөн эрхээр дансны хуулгыг шууд татна. Зөвхөн унших
              эрх — Entry гүйлгээ хийхгүй, гүйлгээний түлхүүр (X-GOLOMT-KEY)
              энд оруулахгүй.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Орчин" htmlFor="golomt-env">
              <select
                id="golomt-env"
                value={environment}
                onChange={(event) =>
                  setEnvironment(event.target.value as GolomtEnvironment)
                }
                className="ea-form-select w-full"
              >
                {GOLOMT_ENVIRONMENTS.map((value) => (
                  <option key={value} value={value}>
                    {GOLOMT_ENVIRONMENT_LABELS[value]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Байгууллагын регистр" htmlFor="golomt-register">
              <Input
                id="golomt-register"
                value={registerNo}
                onChange={(event) => setRegisterNo(event.target.value)}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Нэвтрэх нэр (username)" htmlFor="golomt-username">
              <Input
                id="golomt-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
              />
            </FormField>
            <FormField label="Нууц үг" hint={secretHint} htmlFor="golomt-password">
              <Input
                id="golomt-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </FormField>
            <FormField label="Session key" hint={secretHint} htmlFor="golomt-session">
              <Input
                id="golomt-session"
                type="password"
                value={sessionKey}
                onChange={(event) => setSessionKey(event.target.value)}
                autoComplete="off"
              />
            </FormField>
            <FormField label="IV key" hint={secretHint} htmlFor="golomt-iv">
              <Input
                id="golomt-iv"
                type="password"
                value={ivKey}
                onChange={(event) => setIvKey(event.target.value)}
                autoComplete="off"
              />
            </FormField>
            <FormField
              label="Client ID"
              hint="Банкнаас өгсөн бол — хоосон бол банкны хариунаас авна"
              htmlFor="golomt-client"
              className="sm:col-span-2"
            >
              <Input
                id="golomt-client"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                autoComplete="off"
              />
            </FormField>
          </div>

          <SwitchField
            label="Идэвхтэй"
            hint="Унтраавал «Голомтоос татах» товч ажиллахгүй (тохиргоо хадгалагдсан хэвээр)."
            checked={isEnabled}
            onChange={setIsEnabled}
            disabled={isPending}
          />

          {connection && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ea-text-3)]">
              {connection.lastCheckError ? (
                <StatusBadge tone="danger" size="sm" icon="error">
                  Сүүлийн оролдлого амжилтгүй
                </StatusBadge>
              ) : connection.lastCheckedAt ? (
                <StatusBadge tone="success" size="sm" icon="success">
                  Холбогдсон
                </StatusBadge>
              ) : (
                <StatusBadge tone="muted" size="sm">
                  Шалгаагүй
                </StatusBadge>
              )}
              {connection.lastCheckedAt && (
                <span>{fmtDateTimeUb(connection.lastCheckedAt)}</span>
              )}
              {connection.lastCheckError && (
                <span className="w-full text-[var(--ea-danger-fg)]">
                  {connection.lastCheckError}
                </span>
              )}
            </div>
          )}

          {testResult && (
            <div className="space-y-1 rounded-md border border-[var(--ea-border)] px-3 py-2 text-xs text-[var(--ea-text-2)]">
              <p className="font-medium text-[var(--ea-text-1)]">
                Банкны харилцах данс: {testResult.accounts.length}
              </p>
              {testResult.matched.length === 0 ? (
                <p className="text-[var(--ea-text-3)]">
                  Кассын модульд Голомтын данс (банк + дансны дугаартай) алга —
                  Мөнгөн хөрөнгө → Данс хэсэгт нэмнэ үү.
                </p>
              ) : (
                testResult.matched.map((item) => (
                  <p key={`${item.cashAccountName}-${item.accountId}`}>
                    {item.cashAccountName} · {item.accountId} —{" "}
                    {item.found ? (
                      <span className="text-[var(--ea-success-fg)]">олдсон</span>
                    ) : (
                      <span className="text-[var(--ea-warning-fg)]">
                        энэ эрхэд харагдахгүй байна
                      </span>
                    )}
                  </p>
                ))
              )}
            </div>
          )}

          {error && (
            <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger-fg)]">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex gap-2">
              {connection && (
                <Button variant="outline" onClick={() => void remove()} disabled={isPending}>
                  <Icon name="delete" size="sm" />
                  Устгах
                </Button>
              )}
              {connection && (
                <Button variant="outline" onClick={test} disabled={isPending}>
                  <Icon name="refresh" size="sm" />
                  Шалгах
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Болих
              </Button>
              <Button onClick={save} disabled={isPending}>
                <Icon name="save" size="sm" />
                Хадгалах
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </>
  );
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function GolomtFetchDialog({
  open,
  onOpenChange,
  cashAccountId,
  cashAccountLabel,
  onFetched,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cashAccountId: string;
  cashAccountLabel: string;
  onFetched: (statement: ParsedBankStatement, skipped: number) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [today] = useState(() => ulaanbaatarToday());
  const [startDate, setStartDate] = useState(() => monthStart(today));
  const [endDate, setEndDate] = useState(today);
  const [error, setError] = useState("");

  function submit() {
    const rangeError = golomtStatementRangeError(startDate, endDate, today);
    if (rangeError) {
      setError(rangeError);
      return;
    }
    setError("");
    startTransition(async () => {
      const { statement, skipped, error: fetchError } = await fetchGolomtStatement({
        cashAccountId,
        startDate,
        endDate,
      });
      if (fetchError || !statement) {
        setError(fetchError ?? "Голомтоос хуулга татаж чадсангүй");
        feedback.error();
        return;
      }
      onFetched(statement, skipped ?? 0);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Голомтоос хуулга татах</DialogTitle>
          <DialogDescription>
            {cashAccountLabel} — өмнө импортолсон гүйлгээ автоматаар алгасагдана.
            Татсаны дараа данс оноож «Хадгалах» дарахад л GL-д бичигдэнэ.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Эхлэх огноо" htmlFor="golomt-start">
            <Input
              id="golomt-start"
              type="date"
              value={startDate}
              max={today}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </FormField>
          <FormField label="Дуусах огноо" htmlFor="golomt-end">
            <Input
              id="golomt-end"
              type="date"
              value={endDate}
              max={today}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </FormField>
        </div>
        <p className="text-[11px] text-[var(--ea-text-4)]">
          Нэг удаад {GOLOMT_STATEMENT_MAX_DAYS} хоног хүртэл.
        </p>
        {error && (
          <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger-fg)]">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button onClick={submit} disabled={isPending}>
            <Icon name={isPending ? "loading" : "download"} size="sm" />
            {isPending ? "Татаж байна…" : "Татах"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
