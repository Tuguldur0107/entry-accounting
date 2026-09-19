"use client";

// Цалингийн тохиргоо (CLAUDE.md §7) — 2 таб:
//   Тооцоолол  — доод цалин, НДШ cap, татваргүй босго, цаг/өдрийн норм,
//                дундажийн сар, нэмэгдлийн коэффициентүүд (ХЗ 103·106·107·108)
//   GL данс    — §7-ийн журналын дансны РОЛЬУУД (кодод хатуу дугаар байхгүй)
//
// Тохиргоо нь ДАРААГИЙН бодолтоос эхэлж үйлчилнэ — аль хэдийн бодогдсон
// сарууд хадгалагдсан дүнгээрээ үлдэнэ (түүх хоцрохгүй).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AccountInput } from "@/components/account/account-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageTabs } from "@/components/ui/tabs";
import {
  savePayrollAccountSettings,
  savePayrollCalculationSettings,
  type PayrollSettingsView as PayrollSettings,
} from "@/lib/actions/payroll";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { fmtMnt } from "@/lib/grid/formatters";
import { buildSegCode } from "@/lib/grid/segments";
import { extractMainAccount } from "@/lib/reports/balances";

interface Props {
  settings: PayrollSettings;
  glAccounts: { number: string; name: string }[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
}

type Tab = "calc" | "accounts";

const TABS: { value: Tab; label: string }[] = [
  { value: "calc", label: "Тооцоолол" },
  { value: "accounts", label: "GL данс" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Хадгалж чадсангүй";
}

/** Үндсэн дансыг ИДЭВХТЭЙ сегментүүдийн default-той бүтэн код болгоно. */
function fullCode(
  main: string,
  activeSegIds: number[],
  defaultSegments: Record<number, string>
) {
  if (!main) return "";
  return buildSegCode({ ...defaultSegments, 3: main }, activeSegIds, defaultSegments);
}

export function PayrollSettingsView({
  settings,
  glAccounts,
  activeSegIds,
  segmentOptions,
  defaultSegments,
}: Props) {
  const [tab, setTab] = useState<Tab>("calc");
  const glNameMap = useMemo(
    () => new Map(glAccounts.map((account) => [account.number, account.name])),
    [glAccounts]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Цалингийн тохиргоо
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Эдгээр утга нь ДАРААГИЙН «Бодолт хийх»-ээс эхэлж үйлчилнэ — аль хэдийн
          бодогдсон сарууд хадгалагдсан дүнгээрээ үлдэнэ.
        </p>
      </div>

      <PageTabs tabs={TABS} value={tab} onChange={setTab} ariaLabel="Цалингийн тохиргоо" />

      {tab === "calc" ? (
        <CalculationSection settings={settings} />
      ) : (
        <AccountsSection
          settings={settings}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          defaultSegments={defaultSegments}
          glNameMap={glNameMap}
        />
      )}
    </section>
  );
}

// ── Тооцооллын үзүүлэлт + коэффициент ──────────────────────────────────────

type CalcKey =
  | "minimumWage"
  | "siCapMultiplier"
  | "monthlyTaxFree"
  | "standardMonthlyHours"
  | "monthlyWorkDays"
  | "averageEarningsMonths"
  | "overtimeMultiplier"
  | "restDayMultiplier"
  | "holidayMultiplier"
  | "nightBonusRate";

const CALC_FIELDS: {
  key: CalcKey;
  label: string;
  hint: string;
  group: "base" | "coefficient";
}[] = [
  {
    key: "minimumWage",
    label: "Хөдөлмөрийн хөлсний доод хэмжээ (₮)",
    hint: "НДШ-ийн дээд суурь = энэ × үржүүлэгч. 2025: 792,000₮.",
    group: "base",
  },
  {
    key: "siCapMultiplier",
    label: "НДШ дээд хязгаарын үржүүлэгч",
    hint: "Доод цалин × энэ тоо = НДШ ногдуулах дээд суурь (одоогийн хууль: 10).",
    group: "base",
  },
  {
    key: "monthlyTaxFree",
    label: "Сарын татваргүй босго (₮)",
    hint: "ХАОАТ-ын ногдох орлогоос хасагдана. 0 = идэвхгүй (2026 шинэчлэлт: 800,000₮).",
    group: "base",
  },
  {
    key: "standardMonthlyHours",
    label: "Сарын стандарт ажлын цаг",
    hint: "Цагийн хөлс = үндсэн цалин / энэ тоо. 22 өдөр × 8 цаг = 168.",
    group: "base",
  },
  {
    key: "monthlyWorkDays",
    label: "Сарын ажлын өдрийн норм",
    hint: "Өдрийн дундаж хөлс = сарын дундаж / энэ тоо (ээлжийн амралт, ХЧТА).",
    group: "base",
  },
  {
    key: "averageEarningsMonths",
    label: "Дундаж цалин бодох сарын тоо",
    hint: "Тайлант сараас өмнөх N сарын БОДИТ олголтын дундаж (ХЗ-ийн дундаж цалин хөлс).",
    group: "base",
  },
  {
    key: "overtimeMultiplier",
    label: "Илүү цаг",
    hint: "ХЗ 103 — хуулийн доод хэмжээ 1.5. Дээгүүр тогтоож болно.",
    group: "coefficient",
  },
  {
    key: "restDayMultiplier",
    label: "Амралтын өдөр",
    hint: "ХЗ 107 — хуулийн доод хэмжээ 1.5.",
    group: "coefficient",
  },
  {
    key: "holidayMultiplier",
    label: "Баярын өдөр",
    hint: "ХЗ 108 — хуулийн доод хэмжээ 2.0.",
    group: "coefficient",
  },
  {
    key: "nightBonusRate",
    label: "Шөнийн нэмэгдэл (хувь)",
    hint: "ХЗ 106 — цагийн хөлсний 0.2 (=20%) нэмэгдэл. Зөвхөн нэмэгдэл хэсэг.",
    group: "coefficient",
  },
];

function CalculationSection({ settings }: { settings: PayrollSettings }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [form, setForm] = useState(
    () =>
      Object.fromEntries(
        CALC_FIELDS.map((field) => [field.key, String(settings[field.key])])
      ) as Record<CalcKey, string>
  );

  const siCap = Number(form.minimumWage) * Number(form.siCapMultiplier);

  function save() {
    setError("");
    startTransition(async () => {
      try {
        await savePayrollCalculationSettings({
          minimumWage: Number(form.minimumWage),
          siCapMultiplier: Number(form.siCapMultiplier),
          monthlyTaxFree: Number(form.monthlyTaxFree),
          standardMonthlyHours: Number(form.standardMonthlyHours),
          monthlyWorkDays: Number(form.monthlyWorkDays),
          averageEarningsMonths: Number(form.averageEarningsMonths),
          overtimeMultiplier: Number(form.overtimeMultiplier),
          restDayMultiplier: Number(form.restDayMultiplier),
          holidayMultiplier: Number(form.holidayMultiplier),
          nightBonusRate: Number(form.nightBonusRate),
        });
        toast.success("Тооцооллын тохиргоо хадгалагдлаа");
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  const fieldsOf = (group: "base" | "coefficient") =>
    CALC_FIELDS.filter((field) => field.group === group);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid max-w-4xl gap-x-6 gap-y-4 pb-2 lg:grid-cols-2">
        <h2 className="text-sm font-medium text-[var(--ea-text-2)] lg:col-span-2">
          Тооцооллын үзүүлэлт
        </h2>
        {fieldsOf("base").map((field) => (
          <div key={field.key} className="grid gap-1.5">
            <Label title={field.hint}>{field.label}</Label>
            <Input
              value={form[field.key]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [field.key]: event.target.value }))
              }
              className="font-mono"
              inputMode="decimal"
            />
            <p className="truncate text-[11px] text-[var(--ea-text-4)]" title={field.hint}>
              {field.hint}
            </p>
          </div>
        ))}

        <p className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-3)] lg:col-span-2">
          НДШ ногдуулах дээд суурь:{" "}
          <span className="font-mono font-medium text-[var(--ea-text-1)]">
            {Number.isFinite(siCap) ? fmtMnt(siCap) : "—"}
          </span>{" "}
          (доод цалин × үржүүлэгч). Үүнээс дээш олголтод НДШ нэмэгдэхгүй.
        </p>

        <h2 className="mt-2 text-sm font-medium text-[var(--ea-text-2)] lg:col-span-2">
          Нэмэгдлийн коэффициент — хуулийн доод хэмжээнээс ДООШ тавигдахгүй
        </h2>
        {fieldsOf("coefficient").map((field) => (
          <div key={field.key} className="grid gap-1.5">
            <Label title={field.hint}>{field.label}</Label>
            <Input
              value={form[field.key]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [field.key]: event.target.value }))
              }
              className="font-mono"
              inputMode="decimal"
            />
            <p className="truncate text-[11px] text-[var(--ea-text-4)]" title={field.hint}>
              {field.hint}
            </p>
          </div>
        ))}

        {error && (
          <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger-fg)] lg:col-span-2">
            {error}
          </p>
        )}

        <div className="flex justify-end lg:col-span-2">
          <Button onClick={save} disabled={isPending}>
            Хадгалах
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── GL дансны рольууд ───────────────────────────────────────────────────────

type AccountKey =
  | "salaryExpenseAccountNumber"
  | "employerSiExpenseAccountNumber"
  | "siPayableAccountNumber"
  | "pitPayableAccountNumber"
  | "salaryPayableAccountNumber"
  | "deductionAccountNumber"
  | "employeePayableAccountNumber"
  | "sickBenefitAccountNumber";

const ACCOUNT_FIELDS: { key: AccountKey; label: string; hint: string }[] = [
  {
    key: "salaryExpenseAccountNumber",
    label: "Цалингийн зардал (Dr)",
    hint: "Нийт олголт энд дебетлэгдэнэ — §7 журналын эхний мөр.",
  },
  {
    key: "employerSiExpenseAccountNumber",
    label: "АО НДШ-ийн зардал (Dr)",
    hint: "Ажил олгогчийн НДШ — ажилтнаас суутгадаггүй, ТУСДАА зардал.",
  },
  {
    key: "siPayableAccountNumber",
    label: "НДШ өглөг (Cr)",
    hint: "Ажилтан + ажил олгогчийн НДШ хоёулаа. Дараа сарын 5-нд төлнө.",
  },
  {
    key: "pitPayableAccountNumber",
    label: "ХАОАТ өглөг (Cr)",
    hint: "Ажилтнаас суутгасан ХАОАТ. Дараа сарын 10-нд төлнө.",
  },
  {
    key: "salaryPayableAccountNumber",
    label: "Цалингийн өглөг (Cr)",
    hint: "Гарт олгох цалин. Нэхэмжлэх батлагдахад ажилтны өглөг рүү шилжинэ (клиринг).",
  },
  {
    key: "deductionAccountNumber",
    label: "Бусад суутгалын өглөг (Cr)",
    hint: "Зээл г.м — НДШ, ХАОАТ бодогдсоны ДАРАА гарт олгохоос хасагдана.",
  },
  {
    key: "employeePayableAccountNumber",
    label: "Ажилтны өглөг — нэхэмжлэх (Cr)",
    hint: "АР/АП модульд ажилтанд өгөх өглөг энд суудаг; кассаас үүнийг хаана.",
  },
  {
    key: "sickBenefitAccountNumber",
    label: "ХЧТА тэтгэмжийн зардал (Dr) — сонголтоор",
    hint: "Хоосон бол цалингийн зардлын данс хэрэглэгдэнэ. ХЧТА нь НДШ, ХАОАТ-гүй.",
  },
];

function AccountsSection({
  settings,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  glNameMap,
}: {
  settings: PayrollSettings;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  glNameMap: Map<string, string>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [form, setForm] = useState(
    () =>
      Object.fromEntries(
        ACCOUNT_FIELDS.map((field) => [
          field.key,
          fullCode(settings[field.key] ?? "", activeSegIds, defaultSegments),
        ])
      ) as Record<AccountKey, string>
  );

  function save() {
    setError("");
    startTransition(async () => {
      try {
        await savePayrollAccountSettings({
          salaryExpenseAccountNumber: form.salaryExpenseAccountNumber,
          employerSiExpenseAccountNumber: form.employerSiExpenseAccountNumber,
          siPayableAccountNumber: form.siPayableAccountNumber,
          pitPayableAccountNumber: form.pitPayableAccountNumber,
          salaryPayableAccountNumber: form.salaryPayableAccountNumber,
          deductionAccountNumber: form.deductionAccountNumber,
          employeePayableAccountNumber: form.employeePayableAccountNumber,
          sickBenefitAccountNumber: form.sickBenefitAccountNumber,
        });
        toast.success("Дансны тохиргоо хадгалагдлаа");
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid max-w-4xl gap-x-6 gap-y-4 pb-2 lg:grid-cols-2">
        {ACCOUNT_FIELDS.map((field) => {
          const main = extractMainAccount(form[field.key] ?? "");
          const name = main ? glNameMap.get(main) : "";
          return (
            <div key={field.key} className="grid gap-1.5">
              <Label title={field.hint}>{field.label}</Label>
              <AccountInput
                value={form[field.key] ?? ""}
                onChange={(value) =>
                  setForm((current) => ({ ...current, [field.key]: value }))
                }
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder="Данс сонгох..."
              />
              <p
                className="truncate text-[11px] text-[var(--ea-text-4)]"
                title={field.hint}
              >
                {name || field.hint}
              </p>
            </div>
          );
        })}

        {error && (
          <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger-fg)] lg:col-span-2">
            {error}
          </p>
        )}

        <div className="flex justify-end lg:col-span-2">
          <Button onClick={save} disabled={isPending}>
            Хадгалах
          </Button>
        </div>
      </div>
    </div>
  );
}
