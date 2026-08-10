import { NextResponse, type NextRequest } from "next/server";

import { signOut } from "@/lib/auth";

// Ghost session — JWT нь хүчинтэй ч хэрэглэгч нь DB-ээс устсан үед
// getActiveOrg эндрүү чиглүүлдэг: session cookie-г цэвэрлээд login руу.
// (Server Component render дундаас cookie өөрчилж болдоггүй тул энэ
// route handler-ээр дамжина.)
export async function GET(request: NextRequest) {
  await signOut({ redirect: false });
  return NextResponse.redirect(new URL("/login", request.nextUrl));
}
