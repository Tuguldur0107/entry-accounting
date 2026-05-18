import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) redirect("/login");

  const joined = user.createdAt.toISOString().slice(0, 10);

  return (
    <section
      style={{
        background: "var(--ea-surface)",
        border: "1px solid var(--ea-border)",
        borderRadius: 8,
        padding: 24,
        maxWidth: 560,
      }}
    >
      <h2 className="text-base font-medium mb-1" style={{ color: "var(--ea-text-1)" }}>
        Хэрэглэгчийн профайл
      </h2>
      <p className="text-xs mb-5" style={{ color: "var(--ea-text-3)" }}>
        Таны бүртгэлийн үндсэн мэдээлэл.
      </p>

      <dl className="grid grid-cols-[160px_1fr] gap-y-3 gap-x-4 text-sm">
        <dt style={{ color: "var(--ea-text-3)" }}>Нэр</dt>
        <dd style={{ color: "var(--ea-text-1)" }}>{user.name}</dd>

        <dt style={{ color: "var(--ea-text-3)" }}>Имэйл</dt>
        <dd style={{ color: "var(--ea-text-1)" }}>{user.email}</dd>

        <dt style={{ color: "var(--ea-text-3)" }}>Бүртгэгдсэн огноо</dt>
        <dd style={{ color: "var(--ea-text-1)" }}>{joined}</dd>
      </dl>
    </section>
  );
}
