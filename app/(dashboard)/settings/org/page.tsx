import { redirect } from "next/navigation";

// Байгууллагын удирдлага "Удирдлага" модуль руу нүүсэн — хуучин линк хэвээр ажиллана.
export default function OldOrgSettingsPage() {
  redirect("/admin/org");
}
