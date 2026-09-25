// Багц, төлбөр — байгууллагын харагдац (server component, ui-kit-ээр).
import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { BillingOverview } from "@/lib/actions/billing";
import { READ_ONLY_MESSAGES } from "@/lib/billing/entitlements";
import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  PLAN_LABELS,
  graceDaysFor,
  PLANS,
  STATUS_LABELS,
  type PlanId,
  type SubscriptionStatus,
} from "@/lib/billing/plans";
import { DEPLOYMENT_MODE_LABELS } from "@/lib/deployment-mode";

const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = {
  trialing: "warning",
  active: "success",
  past_due: "warning",
  suspended: "danger",
  cancelled: "muted",
};

const fmt = (value: number) => value.toLocaleString("en-US");

export function BillingOverviewView({
  overview,
  selfPay,
}: {
  overview: BillingOverview;
  /** QPay-ээр өөрөө төлөх хэсэг (saas) — components/settings/billing-self-pay.tsx. */
  selfPay?: ReactNode;
}) {
  const { entitlements: ent } = overview;
  const seatsLimit = ent.limits.seats;
  const seatsLabel = seatsLimit === null ? `${overview.seatsUsed} / хязгааргүй` : `${overview.seatsUsed} / ${seatsLimit}`;
  const endsAt = ent.trialEndsAt ?? ent.graceEndsAt;

  return (
    <div className="max-w-2xl space-y-6">
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Багц, төлбөр — {overview.orgName}</h2>
          <StatusBadge tone={STATUS_TONE[ent.status]} size="sm">
            {STATUS_LABELS[ent.status]}
          </StatusBadge>
          {!ent.writable ? (
            <StatusBadge tone="danger" size="sm">
              Зөвхөн унших
            </StatusBadge>
          ) : null}
        </div>
        {ent.mode === "dedicated" ? (
          <p className="text-xs text-[var(--ea-text-3)]">
            {DEPLOYMENT_MODE_LABELS.dedicated} — багцын хязгаар энэ сервист үйлчлэхгүй; лиценз (`ENTRY_LICENSE`) удирдана.
          </p>
        ) : null}
        <dl className="grid gap-2 text-xs sm:grid-cols-[180px_1fr]">
          <dt className="text-[var(--ea-text-3)]">Багц</dt>
          <dd className="font-mono text-[var(--ea-text-1)]">{PLAN_LABELS[ent.planId]}</dd>
          <dt className="text-[var(--ea-text-3)]">Суудал (ашиглаж буй / төлсөн)</dt>
          <dd className="font-mono text-[var(--ea-text-1)]">
            {seatsLabel}
            <span className="ml-2 text-[var(--ea-text-4)]">гишүүд {overview.membersCount} + хүлээгдэж буй урилга</span>
          </dd>
          {overview.pricePerSeatMnt ? (
            <>
              <dt className="text-[var(--ea-text-3)]">Үнэ</dt>
              <dd className="font-mono text-[var(--ea-text-1)]">{fmt(overview.pricePerSeatMnt)} ₮ / хэрэглэгч / сар</dd>
            </>
          ) : null}
          {endsAt ? (
            <>
              <dt className="text-[var(--ea-text-3)]">{ent.status === "trialing" ? "Туршилт дуусах" : "Бичих эрх хаагдах"}</dt>
              <dd className="font-mono text-[var(--ea-text-1)]">
                {endsAt.toISOString().slice(0, 10)}
                {ent.daysLeft !== null ? ` (${ent.daysLeft} хоног)` : ""}
              </dd>
            </>
          ) : null}
          {overview.note ? (
            <>
              <dt className="text-[var(--ea-text-3)]">Тэмдэглэл</dt>
              <dd className="text-[var(--ea-text-1)]">{overview.note}</dd>
            </>
          ) : null}
        </dl>
        {ent.readOnlyReason ? (
          <p className="rounded-md border px-3 py-2 text-xs" style={{ borderColor: "var(--ea-danger)", color: "var(--ea-danger-fg)" }}>
            {READ_ONLY_MESSAGES[ent.readOnlyReason]}
          </p>
        ) : null}
      </section>

      {selfPay}

      <section className="ea-glass space-y-3 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Боломжууд</h2>
        <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
          {FEATURE_KEYS.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <Icon
                name={ent.features[key] ? "success" : "minus"}
                size="sm"
                style={{ color: ent.features[key] ? "var(--ea-success-fg)" : "var(--ea-text-4)" }}
              />
              <span style={{ color: ent.features[key] ? "var(--ea-text-1)" : "var(--ea-text-4)" }}>
                {FEATURE_LABELS[key]}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-[var(--ea-text-4)]">
          Компанийн тоо: {ent.limits.companies === null ? "хязгааргүй" : ent.limits.companies}. Идэвхтэй хугацаанд багц солих,
          суудал нэмэх, {PLAN_LABELS.enterprise} гэрээ бол{" "}
          <a href="mailto:support@entry.mn" className="text-[var(--ea-primary)]">support@entry.mn</a>.
        </p>
      </section>

      {ent.mode === "saas" ? <PlanComparison overview={overview} /> : null}
    </div>
  );
}

/** SIM2-049: багцын харьцуулалт + туршилт дуусахад юу болох. */
const SALE_PLANS: PlanId[] = ["standard", "platform", "enterprise"];

function PlanComparison({ overview }: { overview: BillingOverview }) {
  const { entitlements: ent, planPrices } = overview;
  return (
    <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
      <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Багцууд</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {SALE_PLANS.map((planId) => {
          const plan = PLANS[planId];
          const price = planPrices[planId];
          const current = ent.planId === planId;
          const missing = FEATURE_KEYS.filter((key) => !plan.features[key]);
          return (
            <div
              key={planId}
              className="space-y-2 rounded-md border p-3 text-xs"
              style={{ borderColor: current ? "var(--ea-primary)" : "var(--ea-border)" }}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--ea-text-1)]">{PLAN_LABELS[planId]}</span>
                {current ? (
                  <StatusBadge tone="success" size="sm">
                    Одоогийн
                  </StatusBadge>
                ) : null}
              </div>
              <p className="font-mono text-[var(--ea-text-1)]">
                {price === null ? "Хэлэлцээрээр" : `${fmt(price)} ₮ / хэрэглэгч / сар`}
              </p>
              <p className="text-[var(--ea-text-3)]">
                Компани: {plan.limits.companies === null ? "хязгааргүй" : plan.limits.companies}
              </p>
              <p className="text-[var(--ea-text-3)]">
                {missing.length === 0
                  ? "Бүх боломж"
                  : `Ороогүй: ${missing.map((key) => FEATURE_LABELS[key]).join(", ")}`}
              </p>
              {!current ? (
                <a
                  href={`mailto:support@entry.mn?subject=${encodeURIComponent(`${PLAN_LABELS[planId]} багц — ${overview.orgName}`)}`}
                  className="inline-block text-[var(--ea-primary)]"
                >
                  Багц сонгох →
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-[var(--ea-text-3)]">
        Туршилт дуусахад: өгөгдөл устахгүй — бичилт түр хаагдаж, унших, тайлан, экспорт, сар хаалт нээлттэй
        хэвээр. Төлсөн хугацаа дуусахад {graceDaysFor(ent.planId)} хоногийн хугацаа олгоно. QPay-ээр төлмөгц багц шууд
        идэвхжиж бичих эрх сэргэнэ.
      </p>
    </section>
  );
}
