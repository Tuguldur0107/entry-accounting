import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/lib/auth.config";

// Edge-safe NextAuth instance — uses only JWT decoding, no DB/bcrypt.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname, search } = req.nextUrl;

  const isAuthPage = pathname === "/login" || pathname === "/register";
  // Нэвтрэлтгүй нээгддэг бусад хуудас — сэргээх/баталгаажуулах линкүүд
  // (нэвтэрсэн хэрэглэгч ч нээж болно, redirect хийхгүй).
  const isPublicAccountPage =
    pathname === "/reset-password" || pathname === "/verify-email";

  if (!isLoggedIn && !isAuthPage && !isPublicAccountPage) {
    const login = new URL("/login", req.nextUrl);
    // Нэвтэрснийхээ дараа очих гэж байсан хуудас руугаа буцна (OAuth
    // authorize зэрэг параметртэй урсгалд заавал хэрэгтэй).
    login.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(login);
  }

  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/gl/journal", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  // .well-known — OAuth discovery. /invoice/[token] — харилцагчид илгээсэн
  // нэхэмжлэхийн НЭЭЛТТЭЙ линк тул нэвтрэлт шаардахгүй. Таб/апп дүрс
  // (favicon.ico, icon.svg, apple-icon.png) нэвтрэлтгүй хуудсанд ч
  // (/login, /register) ачаалагдах ёстой — редирект хийвэл browser
  // login HTML-ийг дүрс гэж авч таб дүрсгүй үлддэг.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|\\.well-known|invoice).*)",
  ],
};
