import { signOut } from "@/lib/auth";
import { isSameOriginLogout, safeLogoutRedirect } from "@/lib/auth-logout";

// «Гарах» — form POST (lib/auth-logout.ts-ийн тайлбарыг үз). Session cookie-г
// цэвэрлээд 303-аар login (эсвэл `redirectTo` дотоод зам) руу. Location нь
// ХАРЬЦАНГУЙ — Railway proxy-ийн ард дотоод host руу үсрэхээс сэргийлнэ.
export async function POST(request: Request) {
  if (
    !isSameOriginLogout({
      secFetchSite: request.headers.get("sec-fetch-site"),
      origin: request.headers.get("origin"),
      host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    })
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let redirectTo: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("redirectTo");
    redirectTo = typeof value === "string" ? value : null;
  } catch {
    // Хоосон / form биш body — анхдагч руу.
  }

  await signOut({ redirect: false });
  return new Response(null, {
    status: 303,
    headers: { Location: safeLogoutRedirect(redirectTo), "Cache-Control": "no-store" },
  });
}
