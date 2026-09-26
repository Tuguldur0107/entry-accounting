import { redirect } from "next/navigation";

/** Хуучин /ai хаяг (хавчуурга, гадны заавар) — «AI холболт» Тохиргоо руу шилжсэн. */
export default function AiRedirect() {
  redirect("/settings/ai");
}
