// Дэмжлэгийн линк хүчингүй болсон үеийн тайлбар хуудас (шалтгаан ИЛ).

import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SupportDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-xl border p-6"
        style={{
          background: "var(--ea-surface)",
          borderColor: "var(--ea-border)",
          boxShadow: "var(--ea-shadow-2)",
        }}
      >
        <h1 className="text-lg font-semibold" style={{ color: "var(--ea-text-1)" }}>
          Дэмжлэгийн хандалт нээгдсэнгүй
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--ea-danger-fg)" }}>
          {reason?.slice(0, 300) || "Линк хүчингүй байна"}
        </p>
        <p className="mt-3 text-sm" style={{ color: "var(--ea-text-3)" }}>
          Линк богино хугацаатай бөгөөд нэг хэрэглэгчид олгогддог. Entry
          Console-оос шинэ линк үүсгэнэ үү.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-9 items-center rounded-md px-3 text-sm"
          style={{ background: "var(--ea-primary)", color: "var(--ea-on-primary)" }}
        >
          Нүүр хуудас
        </Link>
      </div>
    </div>
  );
}
