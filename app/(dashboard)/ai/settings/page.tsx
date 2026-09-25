import { redirect } from "next/navigation";

/** Хуучин «AI туслах → Тохиргоо» хаяг (deep link, «AI нягтлан»-ы заавар `?tab=mcp`) — одоо /ai нэг хуудас. */
export default function AiSettingsRedirect() {
  redirect("/ai");
}
