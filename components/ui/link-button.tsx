// Товч шиг харагдах Link — Button-ы variant стилийг navigation-д.
// (Өмнө нь close-wizard, tax-info дотор тус тусдаа хувилбартай байсан.)

import type { ReactNode } from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";

export function LinkButton({
  href,
  icon,
  children,
}: {
  href: string;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={buttonVariants({ variant: "outline", size: "sm" })}
      style={{ textDecoration: "none" }}
    >
      {icon ? (
        <Icon name={icon} size="sm" className="text-[var(--ea-text-3)]" />
      ) : null}
      {children}
    </Link>
  );
}
