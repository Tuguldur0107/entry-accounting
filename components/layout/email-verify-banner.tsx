"use client";

// Баталгаажаагүй и-мэйлийн сануулга — топбарын доор НЭГ нимгэн мөр (36px,
// truncate). Нэвтрэлтийг ХААХГҮЙ, зөвхөн «Илгээх» (lib/actions/account-recovery).
// Хаавал 7 хоног нуугдана (UI гайдын карт 11) — байнга харагддаг сануулгад
// хүн дасаж анзаарахаа больдог; бүтэн тайлбар нь title/aria-д үлдэнэ.

import { useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { resendVerificationEmail } from "@/lib/actions/account-recovery";

const DISMISS_KEY = "ea-email-verify-dismissed-until";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const listeners = new Set<() => void>();

function readDismissed(): boolean {
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dismissForAWeek() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
  } catch {
    /* private горим — энэ удаад л нуугдана */
  }
  listeners.forEach((listener) => listener());
}

export function EmailVerifyBanner({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [hidden, setHidden] = useState(false);
  // SSR snapshot = харагдана (hydration зөрөхгүй); client дээр localStorage.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => false);

  if (dismissed || hidden) return null;

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

  const detail = `${email} хаяг баталгаажаагүй байна — и-мэйл дэх линкийг нээнэ үү (мэдэгдэл, нууц үг сэргээх энэ хаягаар очно).`;

  return (
    <div
      role="status"
      className="flex h-9 items-center gap-2 border-b px-3 text-xs md:px-6"
      style={{
        borderColor: "color-mix(in srgb, var(--ea-warning) 35%, transparent)",
        background: "color-mix(in srgb, var(--ea-warning) 8%, var(--ea-surface))",
        color: "var(--ea-text-2)",
      }}
    >
      <Icon name="warning" size="sm" style={{ color: "var(--ea-warning-fg)" }} aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={detail}>
        И-мэйлээ баталгаажуулна уу
        <span className="hidden text-[var(--ea-text-3)] sm:inline"> · {email}</span>
      </span>
      <Button size="xs" variant="outline" onClick={resend} disabled={pending || sent} title={detail}>
        {sent ? "Илгээгдсэн" : pending ? "Илгээж байна…" : "Илгээх"}
      </Button>
      <IconAction
        name="close"
        size="xs"
        label="Сануулгыг 7 хоног нуух"
        tooltip="Сануулгыг 7 хоног нуух"
        onClick={() => {
          dismissForAWeek();
          setHidden(true);
        }}
      />
    </div>
  );
}
