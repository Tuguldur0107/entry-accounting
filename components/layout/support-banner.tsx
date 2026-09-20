"use client";

// Дэмжлэгийн хандалтын баннер — оператор ӨӨР байгууллагын өгөгдөл дээр ажиллаж
// байгааг АЛХАМ ТУТАМД сануулна (санамсаргүй бичилтээс сэргийлнэ). Идэвхтэй
// сесс байхад л рендерлэгдэнэ; "Гарах" нь cookie-г цэвэрлэж аудитад бичнэ.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { exitSupportSession } from "@/lib/actions/support";
import { SUPPORT_ROLE_LABELS, type SupportRole } from "@/lib/platform/support";

function minutesLeft(endsAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 60_000));
}

export function SupportBanner({
  orgName,
  role,
  endsAt,
}: {
  orgName: string;
  role: SupportRole;
  endsAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const left = minutesLeft(endsAt, now);

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs md:px-6"
      style={{
        borderColor: "color-mix(in srgb, var(--ea-warning) 45%, transparent)",
        background: "color-mix(in srgb, var(--ea-warning) 12%, var(--ea-surface))",
        color: "var(--ea-text-2)",
      }}
    >
      <Icon name="shield" size="sm" style={{ color: "var(--ea-warning-fg)" }} />
      <span className="min-w-0 flex-1">
        <strong style={{ color: "var(--ea-warning-fg)" }}>Дэмжлэгийн хандалт</strong>
        {" — "}
        <strong>{orgName}</strong> байгууллагын өгөгдөл дээр ажиллаж байна (
        {SUPPORT_ROLE_LABELS[role]}). Үлдсэн хугацаа: {left} мин.
        {error ? <span style={{ color: "var(--ea-danger-fg)" }}> · {error}</span> : null}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await exitSupportSession();
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
        className="font-medium underline-offset-2 hover:underline disabled:opacity-60"
        style={{ color: "var(--ea-primary)" }}
      >
        {pending ? "Гарч байна…" : "Дэмжлэгээс гарах"}
      </button>
    </div>
  );
}
