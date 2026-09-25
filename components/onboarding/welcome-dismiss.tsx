"use client";

// «Entry-г 5 минутад мэдэр» картыг хаах — хэрэглэгчийн түвшинд (dismissWelcome).

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { dismissWelcome } from "@/lib/actions/first-run";

export function WelcomeDismiss() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await dismissWelcome();
          if (result.error) {
            toast.error(result.error);
            return;
          }
          router.refresh();
        })
      }
    >
      Дараа үзнэ
    </Button>
  );
}
