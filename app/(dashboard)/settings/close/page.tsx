import { redirect } from "next/navigation";

// Сар хаалт 2026-08-д Системийн хяналт модуль руу нүүсэн — хуучин
// bookmark/линкүүд шинэ байрлал руу чиглэнэ.
export default function LegacyClosePage() {
  redirect("/close");
}
