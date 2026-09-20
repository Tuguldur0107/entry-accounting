// Deployment-ийн ГОРИМ — хоёр төрлийн хэрэглэгчийг хольж хутгахгүйн ил тэмдэг.
//
//   saas       Entry-ийн үндсэн сервис (entry.mn): олон байгууллага НЭГ DB-д,
//              хэн ч өөрөө бүртгүүлж өөрийн байгууллагаа үүсгэнэ (tenant),
//              и-мэйл баталгаажуулалт бодитой (Resend тохируулагдсан).
//   dedicated  Эх код авсан харилцагчийн (Builder) сервис — тусдаа DB, нэг
//              байгууллага: эхний хэрэглэгч чөлөөтэй, дараа нь зөвхөн урилгаар.
//
// Env: ENTRY_DEPLOYMENT_MODE=saas|dedicated. Байхгүй бол `dedicated` —
// одоо ажиллаж буй харилцагчийн deploy-ууд өөрчлөлт мэдрэхгүй; үндсэн
// SaaS сервис дээр ИЛ тохируулна (docs/deployment/README.md).
// Энэ горим нь ЗӨВХӨН бүртгэл/баталгаажуулалтын зан төлөвт нөлөөлнө —
// өгөгдлийн тусгаарлалт (organizationId) хоёр горимд ижил хатуу.

export type DeploymentMode = "saas" | "dedicated";

type ModeEnv = { ENTRY_DEPLOYMENT_MODE?: string };

export function deploymentMode(env: ModeEnv = process.env as ModeEnv): DeploymentMode {
  return (env.ENTRY_DEPLOYMENT_MODE ?? "").trim().toLowerCase() === "saas" ? "saas" : "dedicated";
}

export const DEPLOYMENT_MODE_LABELS: Record<DeploymentMode, string> = {
  saas: "SaaS (олон байгууллага, чөлөөт бүртгэл)",
  dedicated: "Тусдаа сервис (нэг байгууллага, урилгаар)",
};

/**
 * Бүртгэлийн горимын ЦЭВЭР шийдвэр (тесттэй):
 *   saas → үргэлж нээлттэй · ENTRY_OPEN_REGISTRATION → нээлттэй ·
 *   dedicated → хэрэглэгчгүй бол нээлттэй, үгүй бол урилгаар.
 */
export function resolveRegistrationMode(input: {
  mode: DeploymentMode;
  forcedOpen: boolean;
  userCount: number;
}): "open" | "invite" {
  if (input.mode === "saas" || input.forcedOpen) return "open";
  return input.userCount === 0 ? "open" : "invite";
}
