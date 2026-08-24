"use client";

// Системийн дууны унтраалга — feedback.ts-ийн дууг топбараас нэг товчоор
// хянана. Сонголт localStorage-д ("ea-sound") хадгалагдана.

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";
import { isSoundOn, setSoundOn, subscribeSound } from "@/lib/ui/feedback";

export function SoundToggle() {
  const soundOn = useSyncExternalStore(
    subscribeSound,
    isSoundOn,
    // SSR snapshot — client дээр эхний render-т ижил байлгаж hydration
    // зөрүүнээс сэргийлнэ (default нь ON).
    () => true
  );
  return (
    <button
      type="button"
      className="ea-icon-action flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[var(--ea-border)] text-[var(--ea-text-2)]"
      title={soundOn ? "Үйлдлийн дууг унтраах" : "Үйлдлийн дууг асаах"}
      aria-label={soundOn ? "Дуу унтраах" : "Дуу асаах"}
      onClick={() => setSoundOn(!soundOn)}
    >
      <Icon name={soundOn ? "soundOn" : "soundOff"} size="lg" className="pointer-events-none" />
    </button>
  );
}
