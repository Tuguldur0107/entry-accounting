"use client";

// Анхны туршилтын алхмын дугаар / ✓ тэмдэг. ✓ болох МӨЧИД нэг л удаа «поп»
// хийнэ: аль алхмыг ✓-тэй харсныг төхөөрөмж дээр (localStorage) санадаг тул
// нүүр нээх бүрд дахин хөдлөхгүй. Хадгалалт унавал (private горим) зүгээр л
// попгүй харагдана — картын төлөв өгөгдлөөс, энд зөвхөн хөдөлгөөн.

import { useEffect, useRef } from "react";

import { Icon } from "@/components/ui/icon";
import type { FirstRunStepKey } from "@/lib/onboarding/first-run";
import { cn } from "@/lib/utils";

const SEEN_KEY = "ea-welcome-done-seen";

function readSeen(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function StepBadge({ stepKey, n, done }: { stepKey: FirstRunStepKey; n: number; done: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!done) return;
    const seen = readSeen();
    if (seen.includes(stepKey)) return;
    // setState-гүй: класс DOM-д шууд — дахин рендер хийх шаардлагагүй нэг удаагийн хөдөлгөөн.
    ref.current?.classList.add("ea-pop");
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, stepKey]));
    } catch {
      // хадгалж чадаагүй бол дараа дахин поп хийнэ — хор хөнөөлгүй
    }
  }, [done, stepKey]);

  return (
    <span
      ref={ref}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors duration-300",
        done ? "bg-[var(--ea-success)] text-white" : "bg-[var(--ea-primary-50)] text-[var(--ea-primary)]"
      )}
    >
      {done ? <Icon name="approve" size="xs" label="Хийгдсэн" /> : n}
    </span>
  );
}
