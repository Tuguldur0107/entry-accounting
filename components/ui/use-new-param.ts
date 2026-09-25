"use client";

// «+ Шинэ» (F2) цэс ба хоосон төлөвийн CTA `?new=1`-тэй жагсаалтын хуудас руу
// үсэрдэг — үүсгэх цонхыг шууд нээнэ (SIM2-032). inventory-movements-view-ийн
// хэв маяг: state-ээ render үед тохируулж (effect дотор setState-гүй),
// параметрыг URL-ээс цэвэрлэнэ — refresh/буцахад цонх дахин нээгдэхгүй.

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useNewParam(onNew: () => void) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const wantsNew = searchParams.get("new") !== null;
  const [prevWantsNew, setPrevWantsNew] = useState(false);
  if (wantsNew !== prevWantsNew) {
    setPrevWantsNew(wantsNew);
    if (wantsNew) onNew();
  }
  useEffect(() => {
    if (searchParams.get("new") === null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }, [searchParams, pathname, router]);
}
