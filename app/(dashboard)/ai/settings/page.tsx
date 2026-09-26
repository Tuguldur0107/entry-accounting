import { redirect } from "next/navigation";

/** Хуучин «AI туслах → Тохиргоо» хаяг (deep link, «AI нягтлан»-ы заавар `?tab=mcp`) — одоо Тохиргоо → AI холболт. */
export default function AiSettingsRedirect() {
  redirect("/settings/ai");
}
