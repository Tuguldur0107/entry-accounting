import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/icon";
import { TaxPageHeader } from "@/components/tax/tax-info";
import { getPeriodSelection } from "@/lib/periods/selection";
import { computeTaxDeadlines, type TaxDeadlineKey } from "@/lib/tax/calendar";

// Татварын нэгдсэн самбар: ойрын тайлангийн хугацаанууд + татвар бүрийн
// хураангуй карт. Хувь хэмжээ knowledge/01-онол-хууль-стандарт/tax/-аас —
// лавлагаа зорилготой, тооцоолол нь тухайн хуудас/модульдаа.

const DEADLINE_HREF: Record<TaxDeadlineKey, string> = {
  vat: "/tax/vat",
  pit: "/tax/pit",
  si: "/tax/ndsh",
  cit: "/tax/cit",
};

const TAX_CARDS: {
  href: string;
  icon: IconName;
  title: string;
  rate: string;
  description: string;
}[] = [
  {
    href: "/tax/vat",
    icon: "report",
    title: "НӨАТ",
    rate: "10%",
    description:
      "Сарын тайлан, тооцооны журнал — борлуулалт, худалдан авалтаас автоматаар.",
  },
  {
    href: "/tax/pit",
    icon: "user",
    title: "ХХОАТ (цалин)",
    rate: "10–20%",
    description:
      "Цалингийн суутгал — 2026 оноос шатлалт хувь. Тоо нь цалингийн бодолтоос.",
  },
  {
    href: "/tax/ndsh",
    icon: "shield",
    title: "НДШ",
    rate: "11.5% + 12.5–14.5%",
    description:
      "Ажилтан + ажил олгогчийн шимтгэл, дээд хязгаартай. Тоо нь цалингийн бодолтоос.",
  },
  {
    href: "/tax/cit",
    icon: "company",
    title: "ААНОАТ",
    rate: "10% / 25%",
    description:
      "Аж ахуйн нэгжийн орлогын татвар — улирлын урьдчилгаа, жилийн тайлан.",
  },
  {
    href: "/tax/wht",
    icon: "document",
    title: "Суутган татвар",
    rate: "10% / 20%",
    description:
      "Гэрээлэгч, ногдол ашиг, роялти, гадаад төлбөрөөс суутгах татвар.",
  },
  {
    href: "/tax/property",
    icon: "fixedAsset",
    title: "Хөрөнгийн татвар",
    rate: "0.1–1%",
    description: "Газар, барилгын үл хөдлөх хөрөнгийн жилийн албан татвар.",
  },
  {
    href: "/tax/customs",
    icon: "packageReceipt",
    title: "Гаалийн татвар",
    rate: "Барааны ангиллаар",
    description:
      "Импортын гаалийн татвар, импортын НӨАТ, онцгой албан татвар.",
  },
];

export default async function TaxDashboardPage() {
  // Улаанбаатарын өнөөдөр — системийн периодын сонголттой НЭГ эх сурвалж.
  const { today } = await getPeriodSelection();
  const deadlines = computeTaxDeadlines(today);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <TaxPageHeader
        title="Татварын самбар"
        subtitle="Бүх татварын нэгдсэн харагдац — ойрын тайлангийн хугацаа, татвар бүрийн лавлагаа."
      />

      <section>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
          Ойрын тайлангийн хугацаа
        </h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {deadlines.map((deadline) => (
            <Link
              key={deadline.key}
              href={DEADLINE_HREF[deadline.key]}
              className="rounded-lg border p-3 hover:bg-[var(--ea-hover-subtle)]"
              style={{
                borderColor: "var(--ea-border)",
                background: "var(--ea-surface)",
              }}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-[var(--ea-text-1)]">
                  {deadline.label}
                </span>
                <span
                  className="text-xs font-medium"
                  style={{
                    color:
                      deadline.daysLeft <= 5
                        ? "var(--ea-warning-fg)"
                        : "var(--ea-text-3)",
                  }}
                >
                  {deadline.daysLeft} хоног
                </span>
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--ea-text-3)" }}>
                {deadline.period} · {deadline.dueDate}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
          Татварын төрлүүд
        </h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TAX_CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="rounded-lg border p-4 hover:bg-[var(--ea-hover-subtle)]"
              style={{
                borderColor: "var(--ea-border)",
                background: "var(--ea-surface)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon
                    name={card.icon}
                    size="sm"
                    className="text-[var(--ea-interactive)]"
                  />
                  <span className="text-sm font-semibold text-[var(--ea-text-1)]">
                    {card.title}
                  </span>
                </div>
                <span
                  className="text-xs font-medium"
                  style={{ color: "var(--ea-text-3)" }}
                >
                  {card.rate}
                </span>
              </div>
              <p className="mt-2 text-xs" style={{ color: "var(--ea-text-3)" }}>
                {card.description}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
