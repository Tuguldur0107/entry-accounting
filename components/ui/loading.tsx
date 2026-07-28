"use client";

// Уншиж байгаа төлөв — 3 хэлбэр, бүгд --ea-* токеноор.
//   <Spinner />                  — зөвхөн эргэлдэх дугуй (товч дотор г.м.)
//   <LoadingInline />            — дугуй + "Уншиж байна…" текст (жижиг хэсэгт)
//   <LoadingBlock />             — хуудас/панелийн төвд байрлах бүтэн блок
//   <LoadingRows count={5} />    — хүснэгтийн мөрийн skeleton

import { cn } from "@/lib/utils";

export function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Уншиж байна"
      className={cn("inline-block shrink-0 animate-spin rounded-full", className)}
      style={{
        width: size,
        height: size,
        border: `${Math.max(1.5, size / 10)}px solid var(--ea-border-strong)`,
        borderTopColor: "var(--ea-primary)",
      }}
    />
  );
}

export function LoadingInline({
  label = "Уншиж байна…",
  size = 14,
  className,
}: {
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-xs", className)}
      style={{ color: "var(--ea-text-3)" }}
    >
      <Spinner size={size} />
      {label}
    </span>
  );
}

export function LoadingBlock({
  label = "Уншиж байна…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-40 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className
      )}
    >
      <Spinner size={26} />
      <span className="text-sm" style={{ color: "var(--ea-text-3)" }}>
        {label}
      </span>
    </div>
  );
}

/** Хүснэгт ачаалж байх үеийн мөрийн skeleton. */
export function LoadingRows({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 p-3", className)} aria-label="Уншиж байна">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-8 animate-pulse rounded-md"
          style={{
            background: "var(--ea-bg-2)",
            // Мөр бүр өөр өргөнтэй — жинхэнэ өгөгдөл шиг харагдана
            width: `${100 - (i % 3) * 8}%`,
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </div>
  );
}
