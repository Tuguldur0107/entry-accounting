"use client";

// Цалингийн тайлангийн хэсгийн таб — банкны олголт / цалингийн хуудас.
// Хоёр тайлан ӨӨР өгөгдөл ачаалдаг тул route параметрээр (`view`) солигдоно:
// зөвхөн тухайн табын өгөгдөл л сервер талд уншигдана.

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { PageTabs } from "@/components/ui/tabs";

export type PayrollReportView = "payment" | "payslip";

const TABS = [
  { value: "payment", label: "Банкны олголт" },
  { value: "payslip", label: "Цалингийн хуудас" },
] as const satisfies readonly { value: PayrollReportView; label: string }[];

export function PayrollReportTabs({ value }: { value: PayrollReportView }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  return (
    <PageTabs
      tabs={TABS}
      value={value}
      onChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("view", next);
        startTransition(() => router.replace(`/payroll/reports?${params}`));
      }}
      ariaLabel="Цалингийн тайлан"
    />
  );
}
