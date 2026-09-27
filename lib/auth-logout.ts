// «Гарах» — ЦЭВЭР туслахууд (tests/auth-logout.test.ts).
//
// Гарах нь server action БИШ, энгийн form POST → `/api/auth/logout` route.
// Шалтгаан: server action-ийн ID нь build бүрд өөрчлөгддөг тул deploy-оос
// ӨМНӨ нээсэн таб «Гарах» дарахад сервер «Failed to find Server Action» гэж
// унаж хэрэглэгч гарч чаддаггүй байсан (2026-09-27, өдөрт олон deploy).
// Route-ийн URL хэзээ ч өөрчлөгдөхгүй тул аль ч хувилбарын табаас ажиллана.

export const LOGOUT_PATH = "/api/auth/logout";
export const DEFAULT_LOGOUT_REDIRECT = "/login";

/**
 * Гарсны дараа очих хаяг — зөвхөн ЭНЭ сайтын зам (`/…`). Гадны хост, `//evil`,
 * `/\evil`, протоколтой хаяг бүгд `/login` болно (open redirect хориг).
 */
export function safeLogoutRedirect(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_LOGOUT_REDIRECT;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_LOGOUT_REDIRECT;
  if (/[\u0000-\u001f]/.test(value)) return DEFAULT_LOGOUT_REDIRECT;
  return value;
}

/**
 * Өөр сайтаас хэрэглэгчийг албадан гаргах (logout CSRF)-аас сэргийлнэ.
 * Browser `Sec-Fetch-Site` илгээвэл түүгээр, үгүй бол `Origin`-ийг host-той
 * тулгана; хоёулаа байхгүй (хуучин browser) бол зөвшөөрнө — гарах нь
 * өгөгдөл өөрчлөхгүй, хамгийн муу тохиолдолд дахин нэвтэрнэ.
 */
export function isSameOriginLogout(headers: {
  secFetchSite: string | null;
  origin: string | null;
  host: string | null;
}): boolean {
  const site = headers.secFetchSite?.toLowerCase();
  if (site) return site === "same-origin" || site === "none";
  if (headers.origin && headers.host) {
    try {
      return new URL(headers.origin).host.toLowerCase() === headers.host.toLowerCase();
    } catch {
      return false;
    }
  }
  return true;
}
