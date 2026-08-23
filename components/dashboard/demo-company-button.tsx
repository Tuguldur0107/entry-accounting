"use client";

// П20 — "Демо компани" товч: бэлэн дататай демо байгууллага үүсгээд
// (эсвэл байгааг нь идэвхжүүлээд) шууд тийш шилжинэ. Seed нь server
// action дотор tool давхаргаар явдаг тул хэдэн секунд үргэлжилнэ.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { createDemoCompany } from "@/lib/actions/demo";

export function DemoCompanyButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await createDemoCompany();
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(
            result.existed
              ? "Демо компани руу шилжлээ"
              : "Демо компани бэлэн боллоо — 2 сарын жишээ дататай"
          );
          router.refresh();
        })
      }
    >
      <Icon name={isPending ? "loading" : "company"} size="sm" className={isPending ? "animate-spin" : undefined} />
      {isPending ? "Демо бэлдэж байна…" : "Демо компани дээр турших"}
    </Button>
  );
}
