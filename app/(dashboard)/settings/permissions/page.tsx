import { PermissionsSettings } from "@/components/settings/permissions-settings";
import { getOrgSettingsData } from "@/lib/actions/org";

// Хэрэглэгчдийн эрх — гишүүдийн удирдлага (урилга, роль, хасах) + модуль
// бүрийн эрхийн матриц НЭГ дор. Байгууллага хуудасны loader-тай НЭГ өгөгдөл.

export default async function PermissionsPage() {
  const data = await getOrgSettingsData();

  return (
    <PermissionsSettings
      // Гишүүд/роль серверт өөрчлөгдөхөд (refresh) формыг цэвэрхэн remount
      // хийнэ — доторх матрицын draft state найдвартай шинэчлэгдэнэ.
      key={JSON.stringify(
        data.members.map((member) => [
          member.membershipId,
          member.role,
          member.permissions,
        ])
      )}
      orgName={data.org.name}
      myRole={data.myRole}
      members={data.members}
      invitations={data.invitations}
    />
  );
}
