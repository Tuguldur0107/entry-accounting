import { redirect } from "next/navigation";

// Аудитын мөр "Удирдлага" модуль руу нүүсэн — хуучин линк хэвээр ажиллана.
export default function OldAuditPage() {
  redirect("/admin/audit");
}
