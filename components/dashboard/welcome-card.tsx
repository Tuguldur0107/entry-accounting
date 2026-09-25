// Нүүрний «Entry-г 5 минутад мэдэр» карт — анхны туршилтын НЭГ зам:
// ① бэлэн дататай турших → ② ChatGPT / Claude-даа холбох → ③ эхний асуулт.
// Алхам бүр өгөгдлөөс автоматаар ✓ (lib/onboarding/first-run.ts); гурвуул
// хийгдмэгц эсвэл «Дараа үзнэ» дармагц нуугдана. Server Component — товчнууд
// нь жижиг client хэсгүүд.

import Link from "next/link";

import { DemoCompanyButton } from "@/components/dashboard/demo-company-button";
import { StarterPrompts } from "@/components/onboarding/starter-prompts";
import { WelcomeDismiss } from "@/components/onboarding/welcome-dismiss";
import { ConnectGuide } from "@/components/skills/connect-guide";
import { CopyValue } from "@/components/skills/copy-value";
import { Icon } from "@/components/ui/icon";
import type { FirstRunStep, StarterPrompt } from "@/lib/onboarding/first-run";
import { cn } from "@/lib/utils";

export type WelcomeCardData = {
  steps: FirstRunStep[];
  mcpUrl: string;
  /** OAuth зөвшөөрөл идэвхтэй байгууллагад уягддаг — аль компанид холбогдохыг ил хэлнэ. */
  orgName: string;
  isDemoOrg: boolean;
  prompts: StarterPrompt[];
};

function StepHeader({ n, step }: { n: number; step: FirstRunStep }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
          step.done
            ? "bg-[var(--ea-success)] text-white"
            : "bg-[var(--ea-primary-50)] text-[var(--ea-primary)]"
        )}
      >
        {step.done ? <Icon name="approve" size="xs" /> : n}
      </span>
      <div className="min-w-0">
        <h3
          className={cn(
            "text-sm font-semibold",
            step.done ? "text-[var(--ea-text-3)] line-through" : "text-[var(--ea-text-1)]"
          )}
        >
          {step.title}
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--ea-text-3)]">{step.hint}</p>
      </div>
    </div>
  );
}

export function WelcomeCard({ data }: { data: WelcomeCardData }) {
  const [tryStep, connectStep, askStep] = data.steps;
  const doneCount = data.steps.filter((step) => step.done).length;

  return (
    <section
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--ea-primary)", background: "var(--ea-surface)" }}
      aria-labelledby="welcome-title"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="welcome-title" className="flex items-center gap-2 text-base font-semibold text-[var(--ea-text-1)]">
            <Icon name="ai" size="sm" className="text-[var(--ea-primary)]" />
            Entry-г 5 минутад мэдэр
          </h2>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Нягтлан бодох бүртгэлээ өөрийн ChatGPT / Claude-аас асууж, тайлан гаргуулж, баримт
            ноороглуулна. AI-ийн бичилт анхдагчаар НООРОГ — та шалгаж батална.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--ea-text-3)]">{doneCount}/3 хийгдсэн</span>
          <WelcomeDismiss />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* ① Бэлэн дататай турших */}
        <div className="space-y-3 rounded-[var(--ea-r-md)] border border-[var(--ea-border)] p-3">
          <StepHeader n={1} step={tryStep} />
          {tryStep.done ? (
            <p className="text-xs text-[var(--ea-text-3)]">
              {data.isDemoOrg
                ? "Та одоо демо компанид байна. Өөрийн компани руугаа топбарын компанийн сонгогчоор шилжинэ."
                : "Бэлэн. Демо ба өөрийн компанийн хооронд топбарын компанийн сонгогчоор шилжинэ."}
            </p>
          ) : (
            <DemoCompanyButton />
          )}
        </div>

        {/* ② ChatGPT / Claude-даа холбох */}
        <div className="space-y-3 rounded-[var(--ea-r-md)] border border-[var(--ea-border)] p-3">
          <StepHeader n={2} step={connectStep} />
          {connectStep.done ? (
            <p className="text-xs text-[var(--ea-text-3)]">
              Холбогдсон. Өөр компанид холбох, token авах бол{" "}
              <Link href="/ai" className="text-[var(--ea-primary)] underline-offset-2 hover:underline">
                AI холболт
              </Link>{" "}
              хуудас.
            </p>
          ) : (
            <>
              <CopyValue value={data.mcpUrl} />
              <ConnectGuide />
              <p className="text-[11px] text-[var(--ea-text-3)]">
                Зөвшөөрөх үед идэвхтэй компани — «{data.orgName}» — руу холбогдоно.
              </p>
            </>
          )}
        </div>

        {/* ③ Эхний асуулт */}
        <div className="space-y-3 rounded-[var(--ea-r-md)] border border-[var(--ea-border)] p-3">
          <StepHeader n={3} step={askStep} />
          <StarterPrompts prompts={data.prompts.slice(0, 4)} columns={1} />
          <Link
            href="/ai#starter-prompts"
            className="inline-flex items-center gap-1 text-xs text-[var(--ea-primary)] underline-offset-2 hover:underline"
          >
            Бүх жишээ асуулт
            <Icon name="chevronRight" size="xs" />
          </Link>
        </div>
      </div>
    </section>
  );
}
