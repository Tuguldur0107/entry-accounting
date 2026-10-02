"use server";

// OAuth consent-ийн server action-ууд — /oauth/authorize хуудасны форм
// эндэх рүү илгээгдэнэ. Параметрүүдийг ДАХИН шалгаж (hidden input-ыг
// хэрэглэгч өөрчилж болно) code үүсгээд redirect_uri руу буцаана.

import { redirect } from "next/navigation";

import { auth, getActiveOrg } from "@/lib/auth";
import { resolveConsentOrg } from "@/lib/oauth/consent-org";
import {
  clientRedirectUris,
  createAuthCode,
  findOAuthClient,
  listConsentOrgs,
} from "@/lib/oauth/server";

/** Идэвхтэй байгууллага (ea-org) — гишүүнчлэлгүй/сонгоогүй бол null. */
async function activeOrgIdOrNull(): Promise<string | null> {
  try {
    return (await getActiveOrg()).orgId;
  } catch {
    return null;
  }
}

export async function approveOAuthRequest(formData: FormData) {
  // Token НЭГ байгууллагад уягдана. Олон байгууллагатай хэрэглэгч consent
  // хуудсанд компаниа ИЛ сонгоно (organization_id) — гишүүнчлэлээр ДАХИН
  // шалгана; вэбийн идэвхтэй байгууллага руу далдуур унахгүй.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Нэвтрэх шаардлагатай");

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

  const orgId = resolveConsentOrg(
    String(formData.get("organization_id") ?? ""),
    await listConsentOrgs(userId),
    await activeOrgIdOrNull()
  );
  if (!orgId) throw new Error("Холбох компаниа сонгоно уу (гишүүн байгууллага олдсонгүй)");

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
