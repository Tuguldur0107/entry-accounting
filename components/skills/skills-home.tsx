// «AI нягтлан» (skills) багцын ЦОРЫН ГАНЦ хуудас (app/(dashboard)/page.tsx):
// юу авах вэ → ① төлбөр (төлөв + сунгах) → ② ChatGPT / Claude-д холбох.
// Тусдаа «Багц, төлбөр» хуудас энэ багцад байхгүй (/settings/billing → энд).
// Холболт нь OAuth: хаягаа нэмээд Entry-ийн и-мэйл, нууц үгээр зөвшөөрнө —
// token хуулах, файл татах шаардлагагүй.
import type { ReactNode } from "react";

import { ConnectGuide } from "@/components/skills/connect-guide";
import { CopyValue } from "@/components/skills/copy-value";
import { StarterPrompts } from "@/components/onboarding/starter-prompts";
import { startersFor } from "@/lib/onboarding/first-run";
import { SkillsPay } from "@/components/skills/skills-pay";
import { Icon } from "@/components/ui/icon";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { Entitlements } from "@/lib/billing/entitlements";
import { featureUsable, KNOWLEDGE_READ_ONLY_MESSAGES } from "@/lib/billing/entitlements";
import type { SelfPayOptions } from "@/lib/billing/self-pay";

const card = "ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5";

const BENEFITS = [
  "Хууль, стандартын ишлэлтэй хариулт — AI таамаглахгүй",
  "НӨАТ, ХАОАТ, НДШ, ААНОАТ, IFRS — 2026 оны шинэчлэлттэй",
  "Юу ч суулгахгүй — 2 минутад холбогдоно",
];

function fmtDate(date: Date, withTime = false): string {
  return date.toLocaleString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  });
}

function Step({ n, title, aside, children }: { n: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full bg-[var(--ea-primary-50)] text-xs font-semibold text-[var(--ea-primary)]">
          {n}
        </span>
        <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">{title}</h2>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function SkillsHome({
  ent,
  mcpUrl,
  options,
  ready,
  canPay,
  paidThrough,
}: {
  ent: Entitlements;
  mcpUrl: string;
  options: SelfPayOptions;
  ready: boolean;
  canPay: boolean;
  /** Төлсөн хугацааны эцэс — байхгүй бол null. */
  paidThrough: Date | null;
}) {
  const usable = featureUsable(ent, "knowledge");
  const active = usable && ent.status === "active";

  let tone: StatusTone = "success";
  let badge = "Идэвхтэй";
  let status = paidThrough ? `${fmtDate(paidThrough)} хүртэл төлөгдсөн.` : "Идэвхтэй.";
  if (!usable) {
    tone = "danger";
    badge = "Хаалттай";
    status = ent.readOnlyReason ? KNOWLEDGE_READ_ONLY_MESSAGES[ent.readOnlyReason] : "Захиалга идэвхгүй байна.";
  } else if (ent.status === "trialing") {
    tone = "warning";
    badge = "Туршилт";
    status = ent.trialEndsAt ? `Үнэгүй туршилт ${fmtDate(ent.trialEndsAt, true)} хүртэл.` : "Үнэгүй туршилт.";
  } else if (ent.status === "past_due") {
    tone = "warning";
    badge = "Хугацаа дууссан";
    status = ent.graceEndsAt
      ? `Төлсөн хугацаа дууссан — ${fmtDate(ent.graceEndsAt)} хүртэл ажиллана, сунгана уу.`
      : "Төлсөн хугацаа дууссан — сунгана уу.";
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-[var(--ea-text-1)]">AI нягтлан</h1>
          <StatusBadge tone={tone} size="sm">
            {badge}
          </StatusBadge>
        </div>
        <p className="text-sm leading-relaxed text-[var(--ea-text-2)]">
          Өөрийн {"ChatGPT"} эсвэл {"Claude"}-д Монголын нягтлан бодох бүртгэл, татвар, цалингийн мэргэжлийн мэдлэгийг
          холбоно.
        </p>
        <ul className="space-y-1.5">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2 text-sm text-[var(--ea-text-2)]">
              <Icon name="success" size="sm" className="mt-0.5 shrink-0" style={{ color: "var(--ea-success-fg)" }} />
              {benefit}
            </li>
          ))}
        </ul>
      </header>

      <Step n={1} title="Төлбөр">
        <p className="text-xs" style={{ color: usable ? "var(--ea-text-3)" : "var(--ea-danger-fg)" }}>
          {status}
        </p>
        <SkillsPay options={options} ready={ready} canPay={canPay} renew={active} />
      </Step>

      <Step n={2} title={`${"ChatGPT"} / ${"Claude"}-д холбох`}>
        <CopyValue value={mcpUrl} />
        <ConnectGuide />
        <p className="text-xs text-[var(--ea-text-3)]">
          {usable
            ? "Нууц үгээ мартвал нэвтрэх хуудасны «Нууц үг сэргээх»-ээр шинэчилнэ."
            : "Төлбөр төлсний дараа холболт шууд ажиллана."}
        </p>
        <p className="text-xs font-medium text-[var(--ea-text-2)]">Холбосны дараа эхлээд ингэж асуугаарай:</p>
        <StarterPrompts prompts={startersFor({ knowledge: true })} columns={1} />
      </Step>
    </div>
  );
}
