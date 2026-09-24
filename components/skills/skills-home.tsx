// «AI нягтлан» (skills) багцын нүүр — мэдлэгийн санг өөрийн ChatGPT / Claude-д
// холбох заавар. Нягтлан бодох систем энэ багцад ороогүй тул модулийн самбарын
// оронд энэ хуудас гарна (app/(dashboard)/page.tsx). Холболт нь OAuth:
// хэрэглэгч URL-ыг нэмээд «Connect» дарахад Entry-д нэвтэрч зөвшөөрнө — token
// хуулах, файл татах шаардлагагүй.
import { CopyValue } from "@/components/skills/copy-value";
import { LinkButton } from "@/components/ui/link-button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Entitlements } from "@/lib/billing/entitlements";
import { featureUsable, KNOWLEDGE_READ_ONLY_MESSAGES } from "@/lib/billing/entitlements";
import { PLANS } from "@/lib/billing/plans";

const card =
  "ea-glass space-y-3 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5";

function fmtEnds(date: Date): string {
  return date.toLocaleString("mn-MN", { timeZone: "Asia/Ulaanbaatar", dateStyle: "medium", timeStyle: "short" });
}

const EXAMPLES = [
  "НӨАТ-ын тайланг хэзээ, яаж тушаах вэ? Хоцорвол торгууль хэд вэ?",
  "2026 онд цалингийн ХАОАТ-ыг шатлалаар хэрхэн тооцох вэ? Жишээгээр.",
  "IAS 16-аар үндсэн хөрөнгийн элэгдлийг татварын элэгдлээс юугаараа ялгаатай бүртгэх вэ?",
  "Импортын барааны гаалийн татвар өртөгт шингэх үү? Журналын бичилтийг харуул.",
];

export function SkillsHome({ ent, mcpUrl }: { ent: Entitlements; mcpUrl: string }) {
  const usable = featureUsable(ent, "knowledge");
  const price = PLANS.skills.pricePerSeatMnt ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--ea-text-1)]">AI нягтлан</h1>
          {usable ? (
            <StatusBadge tone={ent.status === "trialing" ? "warning" : "success"} size="sm">
              {ent.status === "trialing" ? "Туршилт" : "Идэвхтэй"}
            </StatusBadge>
          ) : (
            <StatusBadge tone="danger" size="sm">
              Хаалттай
            </StatusBadge>
          )}
        </div>
        <p className="text-sm leading-relaxed text-[var(--ea-text-3)]">
          Entry-ийн нягтлан бодох бүртгэл, IFRS, Монголын татвар, НДШ, цалингийн мэргэжлийн
          мэдлэгийг өөрийн {"ChatGPT"} эсвэл {"Claude"}-д холбоно. Юу ч татахгүй, суулгахгүй — AI тань
          асуулт бүрт эх сурвалжийн ишлэлтэй хариулна.
        </p>
        {ent.status === "trialing" && ent.trialEndsAt && usable ? (
          <p className="text-xs text-[var(--ea-warning-fg)]">
            Туршилт {fmtEnds(ent.trialEndsAt)}-д дуусна. Үргэлжлүүлэх үнэ — {price.toLocaleString("en-US")}₮ / сар.
          </p>
        ) : null}
        {!usable && ent.readOnlyReason ? (
          <p className="text-xs text-[var(--ea-danger-fg)]">{KNOWLEDGE_READ_ONLY_MESSAGES[ent.readOnlyReason]}</p>
        ) : null}
      </header>

      <section className={card}>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">1. Холболтын хаяг</h2>
        <CopyValue value={mcpUrl} />
        <p className="text-xs text-[var(--ea-text-3)]">
          Нэвтрэлт нь аюулгүй холболтоор ({"OAuth"}) явна: доорх алхмаар хаягаа нэмээд холбоход Entry-д
          нэвтэрч зөвшөөрөл өгнө. Нууц түлхүүр хуулах шаардлагагүй.
        </p>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">2а. Claude-д холбох</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[var(--ea-text-2)]">
          <li>
            {"claude.ai"} → {"Settings → Connectors"} → {"Add custom connector"}
          </li>
          <li>
            Нэр: <strong>{"Entry"}</strong>, хаяг: дээрх холболтын хаяг → нэмнэ
          </li>
          <li>
            {"Connect"} дарж Entry-д нэвтрээд зөвшөөрнө
          </li>
          <li>Шинэ чатанд холболтоо идэвхжүүлээд асуултаа бичнэ</li>
        </ol>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">2б. ChatGPT-д холбох</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-[var(--ea-text-2)]">
          <li>
            {"ChatGPT"} → {"Settings → Apps & Connectors"} → {"Advanced settings"} → {"Developer mode"} асаана
          </li>
          <li>
            {"Create"} → нэр: <strong>{"Entry"}</strong>, хаяг: дээрх холболтын хаяг, нэвтрэлт: {"OAuth"}
          </li>
          <li>Entry-д нэвтэрч зөвшөөрнө</li>
          <li>Чатанд холболтоо сонгоод асуултаа бичнэ</li>
        </ol>
        <p className="text-xs text-[var(--ea-text-4)]">
          Гаднын холболт нэмэх боломж таны {"ChatGPT"} багцаас хамаарна — цэсний нэр шинэчлэлтээр өөрчлөгдөж болно.
        </p>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Жишээ асуултууд</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-[var(--ea-text-2)]">
          {EXAMPLES.map((example) => (
            <li key={example}>{example}</li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Бүртгэлээ ч AI-аараа хөтлөх үү?</h2>
        <p className="text-sm text-[var(--ea-text-3)]">
          Entry Accounting системийг ашиглавал AI тань журнал бичих, нэхэмжлэх, цалин, НӨАТ-ын тайлан бэлтгэх
          хүртэл хийнэ — мэдлэгийн сан нь системийн багц бүрд үнэгүй дагалдана.
        </p>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/settings/billing" icon="settings">
            Багц, төлбөр
          </LinkButton>
        </div>
      </section>
    </div>
  );
}
