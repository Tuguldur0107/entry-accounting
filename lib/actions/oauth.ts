"use server";

// OAuth consent-ийн server action-ууд — /oauth/authorize хуудасны форм
// эндэх рүү илгээгдэнэ. Параметрүүдийг ДАХИН шалгаж (hidden input-ыг
// хэрэглэгч өөрчилж болно) code үүсгээд redirect_uri руу буцаана.

import { redirect } from "next/navigation";

import { getActiveOrg } from "@/lib/auth";
import {
  clientRedirectUris,
  createAuthCode,
  findOAuthClient,
} from "@/lib/oauth/server";

export async function approveOAuthRequest(formData: FormData) {
  // Фаз 01 (Шат 6): consent хуудас хэрэглэгчийн session-тэй ажилладаг тул
  // идэвхтэй байгууллагыг эндээс аваад code → token-д уяна.
  const { userId, orgId } = await getActiveOrg();

  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = String(formData.get("state") ?? "");
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const decision = String(formData.get("decision") ?? "");

  const client = await findOAuthClient(clientId);
  if (!client || !clientRedirectUris(client).includes(redirectUri))
    throw new Error("Клиент эсвэл redirect_uri хүчингүй байна");

  const target = new URL(redirectUri);
  if (state) target.searchParams.set("state", state);

  if (decision !== "approve") {
    target.searchParams.set("error", "access_denied");
    redirect(target.toString());
  }

  if (!codeChallenge) throw new Error("PKCE code_challenge шаардлагатай");

  const code = await createAuthCode({
    clientId,
    userId,
    organizationId: orgId,
    redirectUri,
    codeChallenge,
  });
  target.searchParams.set("code", code);
  redirect(target.toString());
}
