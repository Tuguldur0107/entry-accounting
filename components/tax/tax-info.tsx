// Татвар модулийн хуудсуудын НЭГДСЭН presentational хэсгүүд — server
// component (интерактивгүй). Хууль-лавлагааны агуулга knowledge/tax/-аас
// ирдэг; хувь хэмжээ энд харуулахаас өөр тооцоололд ХЭРЭГЛЭГДЭХГҮЙ
// (effective-date guardrail — бодит тооцоо тухайн модульдаа).

import type { ReactNode } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/icon";

export function TaxPageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">{title}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--ea-text-3)" }}>
        {subtitle}
      </p>
    </div>
  );
}

/** Толгойн товч факт — хувь, хугацаа г.м (VAT-ийн SummaryCard-тай ижил хэлбэр). */
export function TaxStatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}
    >
      <div className="text-xs" style={{ color: "var(--ea-text-3)" }}>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-[var(--ea-text-1)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs" style={{ color: "var(--ea-text-3)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** Гарчигтай хэсэг — доторх мөрүүд нь label→value хос. */
export function TaxSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--ea-border)", background: "var(--ea-surface)" }}
    >
      <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">{title}</h2>
      <div className="mt-3 space-y-0">{children}</div>
    </section>
  );
}

/** label → value мөр (лавлагааны хос багана). */
export function TaxFactRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 border-b py-2 text-sm last:border-b-0"
      style={{ borderColor: "var(--ea-border)" }}
    >
      <span style={{ color: "var(--ea-text-3)" }}>{label}</span>
      <span className="text-right font-medium text-[var(--ea-text-1)]">
        {value}
      </span>
    </div>
  );
}

/** GL бичилтийн жишээ — monospace блок. */
export function TaxGlExample({
  title,
  lines,
}: {
  title: string;
  lines: string[];
}) {
  return (
    <div>
      <div className="text-xs font-medium" style={{ color: "var(--ea-text-3)" }}>
        {title}
      </div>
      <pre
        className="mt-1.5 overflow-x-auto rounded-md border p-3 font-mono text-xs leading-relaxed text-[var(--ea-text-1)]"
        style={{ borderColor: "var(--ea-border)", background: "var(--ea-bg)" }}
      >
        {lines.join("\n")}
      </pre>
    </div>
  );
}

/** Холбогдох модуль руу үсрэх жижиг линк товч. */
export function TaxModuleLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-[var(--ea-text-1)] hover:bg-[var(--ea-hover-subtle)]"
      style={{ borderColor: "var(--ea-border)" }}
    >
      <Icon name={icon} size="sm" className="text-[var(--ea-text-3)]" />
      {children}
    </Link>
  );
}
