"use client";

// Формын талбарын НЭГДСЭН жааз — Label + input + hint. Өмнө нь POS-ийн
// тохиргоо, хөнгөлөлтийн дүрмийн диалог, ээлжийн диалог тус бүр ижил `Field` /
// `SwitchField` хувилбараа давтан бичдэг байсан (COMPONENT-RECOMMENDATIONS P1
// «FormField»). Шинэ форм бичихдээ энийг compose хийнэ — өөрийн Field
// бичихийг хориглоно.

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function FormField({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  /** Талбарын доорх тайлбар (жижиг, бүдэг). */
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-[var(--ea-text-4)]">{hint}</p> : null}
    </div>
  );
}

export function SwitchField({
  label,
  hint,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("flex items-start gap-2", className)}>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(!!value)}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm">{label}</span>
        {hint ? <span className="block text-[11px] text-[var(--ea-text-4)]">{hint}</span> : null}
      </span>
    </label>
  );
}
