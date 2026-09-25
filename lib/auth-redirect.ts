// Нэвтэрсэн хэрэглэгч /login, /register нээхэд самбар руу үсэргэх эсэх —
// ЦЭВЭР (edge proxy ба тест хоёулаа дуудна; DB/next импортгүй).
//
// Онцгой: «AI нягтлан» захиалгын линк (`/register?plan=skills` — entry.mn
// landing-ийн CTA). Үсэргэвэл нэвтэрсэн хэрэглэгч ЧИМЭЭГҮЙ өөрийн нягтлан
// бодох байгууллага руугаа орж, юу болсныг ойлгохгүй байв. Энэ линкийг
// бүртгэлийн хуудас ӨӨРӨӨ шийднэ: багцад нь аль хэдийн багтсан эсэхийг ИЛ
// хэлж, өөр и-мэйлээр шинэ бүртгэл үүсгэх замыг санал болгоно.

export function isSkillsSignupUrl(pathname: string, search: string): boolean {
  if (pathname !== "/register") return false;
  const params = new URLSearchParams(search);
  return params.get("plan") === "skills" && !params.get("invite");
}

/** Нэвтэрсэн хэрэглэгчийг энэ auth хуудаснаас самбар руу үсэргэх үү. */
export function redirectsSignedInUser(pathname: string, search: string): boolean {
  if (pathname !== "/login" && pathname !== "/register") return false;
  return !isSkillsSignupUrl(pathname, search);
}
