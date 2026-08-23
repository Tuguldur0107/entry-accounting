// П19 — Хоосон төлөвийн НЭГДСЭН харагдац: "Мөр алга" гэхийн оронд дараагийн
// алхмыг заана (QBO загвар). Server/client аль алинд render хийгдэнэ —
// үйлдлүүд нь Link (href) эсвэл товч (onClick, client дотор) байж болно.

import type { ReactNode } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/icon";

export type EmptyStateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: IconName;
  primary?: boolean;
};

export function EmptyState({
  icon,
  title,
  description,
  actions = [],
  children,
}: {
  icon: IconName;
  title: string;
  description?: string;
  actions?: EmptyStateAction[];
  children?: ReactNode;
}) {
  const actionClass = (primary?: boolean) =>
    primary
      ? "ea-primary-button inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-[var(--primary-foreground)]"
      : "ea-interactive inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ea-border-strong)] px-3 text-xs font-medium text-[var(--ea-text-2)]";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[var(--ea-border)] px-6 py-14 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--ea-bg-2)] text-[var(--ea-text-3)]">
        <Icon name={icon} />
      </span>
      <div>
        <p className="text-sm font-medium text-[var(--ea-text-1)]">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--ea-text-3)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {actions.map((action) =>
            action.href ? (
              <Link
                key={action.label}
                href={action.href}
                className={actionClass(action.primary)}
                style={{ textDecoration: "none" }}
              >
                {action.icon ? <Icon name={action.icon} size="sm" /> : null}
                {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className={actionClass(action.primary)}
              >
                {action.icon ? <Icon name={action.icon} size="sm" /> : null}
                {action.label}
              </button>
            )
          )}
        </div>
      ) : null}
      {children}
    </div>
  );
}
