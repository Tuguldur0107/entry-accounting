"use client";

// Баталгаажаагүй и-мэйлийн баннер — топбарын доор нэг мөр. Нэвтрэлтийг
// ХААХГҮЙ, зөвхөн сануулга + «Дахин илгээх» (lib/actions/account-recovery).

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { resendVerificationEmail } from "@/lib/actions/account-recovery";

export function EmailVerifyBanner({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function resend() {
    startTransition(async () => {
      const res = await resendVerificationEmail();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSent(true);
      toast.success(`Баталгаажуулах линк ${email} хаягт илгээгдлээ`);
    });
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs md:px-6"
      style={{
        borderColor: "color-mix(in srgb, var(--ea-warning) 35%, transparent)",
        background: "color-mix(in srgb, var(--ea-warning) 8%, var(--ea-surface))",
        color: "var(--ea-text-2)",
      }}
    >
      <Icon name="warning" size="sm" style={{ color: "var(--ea-warning-fg)" }} />
      <span className="min-w-0 flex-1">
        <span className="font-mono">{email}</span> хаяг баталгаажаагүй байна — и-мэйл дэх линкийг нээнэ үү
        (мэдэгдэл, нууц үг сэргээх энэ хаягаар очно).
      </span>
      <Button size="xs" variant="outline" onClick={resend} disabled={pending || sent}>
        {sent ? "Илгээгдсэн" : pending ? "Илгээж байна…" : "Дахин илгээх"}
      </Button>
    </div>
  );
}
