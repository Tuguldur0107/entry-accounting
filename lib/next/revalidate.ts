// `revalidatePath`-ийн ХУУДАСНЫ КЭШ шинэчлэлт — хүсэлт/action-ийн ГАДНА (ticker,
// хуваарьт ажил: давтамжтай нэхэмжлэх г.м) дуудагдвал Next «static generation
// store missing» гэж ШИДДЭГ. Тэр үед шинэчлэх кэш байхгүй (хуудсууд динамик) тул
// зөвхөн тэр алдааг залгина — бичилт амжилттай атлаа action «алдаа» буцаахгүй.

import { revalidatePath } from "next/cache";

export function revalidatePathSafe(path: string): void {
  try {
    revalidatePath(path);
  } catch (error) {
    if (error instanceof Error && /static generation store missing/i.test(error.message)) return;
    throw error;
  }
}
