"use client";

// «Хуулах» товчны түр ✓ төлөв: хуулсны дараа FLASH_MS хугацаанд тэр түлхүүр
// «хуулагдсан» гэж харагдана. Хуулах + алдааны мэдэгдэл НЭГ газар — MCP хаяг
// (CopyValue) ба бэлэн асуултууд (StarterPrompts) хоёулаа үүгээр.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const FLASH_MS = 1500;

export function useCopyFlash(successMessage?: string) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        toast.error("Хуулж чадсангүй — текстийг гараар сонгож хуулна уу");
        return;
      }
      if (successMessage) toast.success(successMessage);
      setCopiedKey(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedKey(null), FLASH_MS);
    },
    [successMessage]
  );

  return { copiedKey, copy };
}
