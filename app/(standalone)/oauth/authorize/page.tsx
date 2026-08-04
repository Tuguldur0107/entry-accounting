// OAuth зөвшөөрлийн хуудас — claude.ai / Cowork "Connect" дарахад browser
// эндэ нээгдэнэ. Нэвтрээгүй бол login руу (callbackUrl-тэй) илгээж,
// нэвтэрснийхээ дараа энэ хуудас руу эргэж ирнэ. Зөвшөөрөхөд authorization
// code үүсч клиентийн redirect_uri руу буцна (lib/actions/oauth.ts).

import { redirect } from "next/navigation";

import { EAMark, EAWordmark } from "@/components/auth/brand";
import { Button } from "@/components/ui/button";
import { approveOAuthRequest } from "@/lib/actions/oauth";
import { auth } from "@/lib/auth";
import { clientRedirectUris, findOAuthClient } from "@/lib/oauth/server";

export const metadata = { title: "Холболт зөвшөөрөх — Entry Accounting" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstOf(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ea-bg)] p-6">
      <div className="w-full max-w-md rounded-xl border border-[var(--ea-border)] bg-[var(--ea-surface)] p-6 text-center">
        <p className="text-sm font-medium text-[var(--ea-danger)]">{message}</p>
        <p className="mt-2 text-xs text-[var(--ea-text-3)]">
          Холболтыг claude.ai / Cowork талаас дахин эхлүүлнэ үү.
        </p>
      </div>
    </main>
  );
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const clientId = firstOf(params.client_id);
  const redirectUri = firstOf(params.redirect_uri);
  const state = firstOf(params.state);
  const codeChallenge = firstOf(params.code_challenge);
  const codeChallengeMethod = firstOf(params.code_challenge_method) || "S256";
  const responseType = firstOf(params.response_type) || "code";

  const session = await auth();
  if (!session?.user?.id) {
    // Login-ий дараа энэ хуудас руу параметртэй нь буцаана.
    const here = `/oauth/authorize?${new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, firstOf(value)])
    ).toString()}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(here)}`);
  }

  // Параметрын шалгалт — redirect_uri баталгаажаагүй тохиолдолд ХЭЗЭЭ Ч
  // тийш нь redirect хийхгүй, зөвхөн энд алдаа үзүүлнэ (OAuth 2.1 дүрэм).
  const client = clientId ? await findOAuthClient(clientId) : null;
  if (!client) return <ErrorCard message="Клиент олдсонгүй (client_id хүчингүй)" />;
  if (!redirectUri || !clientRedirectUris(client).includes(redirectUri))
    return <ErrorCard message="redirect_uri бүртгэлтэй хаягуудтай таарахгүй байна" />;
  if (responseType !== "code")
    return <ErrorCard message="Зөвхөн response_type=code дэмжигдэнэ" />;
  if (!codeChallenge || codeChallengeMethod !== "S256")
    return <ErrorCard message="PKCE (S256 code_challenge) шаардлагатай" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ea-bg)] p-6">
      <div className="w-full max-w-md rounded-xl border border-[var(--ea-border)] bg-[var(--ea-surface)] p-6">
        <div className="flex items-center gap-2.5">
          <EAMark size={28} />
          <EAWordmark size={16} />
        </div>

        <h1 className="mt-5 text-base font-semibold text-[var(--ea-text-1)]">
          Холболт зөвшөөрөх үү?
        </h1>
        <p className="mt-2 text-sm text-[var(--ea-text-2)]">
          <span className="font-medium">{client.name}</span> таны Entry
          Accounting дахь дансанд хандахыг хүсэж байна.
        </p>

        <ul className="mt-4 space-y-1.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg)] p-3 text-xs text-[var(--ea-text-2)]">
          <li>• Журнал, нэхэмжлэх, касс, бараа, хөрөнгийн ноорог үүсгэх</li>
          <li>• Данс, харилцагч, бараа, журналын жагсаалт унших</li>
          <li>
            • Батлах үйлдэл зөвхөн таны сонгосон &quot;Шууд бичих&quot; горимд,
            10 сая ₮ хүртэл
          </li>
        </ul>

        <p className="mt-3 text-xs text-[var(--ea-text-3)]">
          Хэрэглэгч: {session.user.email ?? session.user.id}. Холболтыг хожим
          Тохиргоо хэсгээс таслах боломжтой.
        </p>

        <form action={approveOAuthRequest} className="mt-5 flex gap-2">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <Button
            type="submit"
            name="decision"
            value="deny"
            variant="outline"
            className="flex-1"
          >
            Татгалзах
          </Button>
          <Button type="submit" name="decision" value="approve" className="flex-1">
            Зөвшөөрөх
          </Button>
        </form>
      </div>
    </main>
  );
}
