// Нүүрний «Өөрийн компаниа 15 минутад Entry-д» карт — анхны туршилтын гол зам
// нь AI-тай НЭВТРҮҮЛЭЛТ: ① ChatGPT / Claude-даа холбох → ② хуучин датагаа өгөх →
// ③ нээлтийн үлдэгдэл, тэнцэл. Демо компани ЭНЭ картад БАЙХГҮЙ — зохиомол дата
// үнэ цэнийг хойшлуулж холболтыг дахин хийлгэдэг (setup-checklist-ийн демо мөр ч
// карт харагдаж байхад нуугддаг).
// Алхам бүр өгөгдлөөс автоматаар ✓ (lib/onboarding/first-run.ts); гурвуул
// хийгдмэгц эсвэл «Дараа үзнэ» дармагц нуугдана. Server Component — товчнууд
// нь жижиг client хэсгүүд.
//
// Хөдөлгөөн (globals.css, prefers-reduced-motion-д унтарна): баганууд ээлжлэн
// гарч ирнэ (`ea-stagger`); ОДОО хийх алхам (`activeStepKey`) өргөн, хүрээ нь
// аяархан пульстэй; түүнээс хойшхи хийгдээгүй алхмууд бүдэг; ✓ болох мөчид
// тэмдэг нэг удаа «поп» (StepBadge).

import type { CSSProperties } from "react";
import Link from "next/link";

import { StarterPrompts } from "@/components/onboarding/starter-prompts";
import { StepBadge } from "@/components/onboarding/step-badge";
import { WelcomeDismiss } from "@/components/onboarding/welcome-dismiss";
import { ConnectGuide } from "@/components/skills/connect-guide";
import { CopyValue } from "@/components/skills/copy-value";
import { Icon } from "@/components/ui/icon";
import { activeStepKey, type FirstRunStep, type StarterPrompt } from "@/lib/onboarding/first-run";
import { cn } from "@/lib/utils";

export type WelcomeCardData = {
  steps: FirstRunStep[];
  mcpUrl: string;
  /** OAuth зөвшөөрөл идэвхтэй байгууллагад уягддаг — аль компанид холбогдохыг ил хэлнэ. */
  orgName: string;
  /** Багцаар шүүсэн бэлэн асуултууд — алхам бүр өөрийнхөө id-гаар сонгоно. */
  prompts: StarterPrompt[];
};

type StepTone = "active" | "done" | "later";

function StepHeader({ n, step }: { n: number; step: FirstRunStep }) {
  return (
    <div className="flex items-start gap-2">
      <StepBadge stepKey={step.key} n={n} done={step.done} />
      <div className="min-w-0">
        <h3
          className={cn(
            "text-sm font-semibold transition-colors duration-300",
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

/** Алхмын хайрцаг: идэвхтэй нь тод хүрээ + пульс, дараагийнх нь бүдэг (hover-т тодорно). */
function stepBoxClass(tone: StepTone) {
  return cn(
    "space-y-3 rounded-[var(--ea-r-md)] border p-3 transition-[opacity,border-color] duration-300",
    tone === "active" ? "ea-pulse-ring border-[var(--ea-primary)]" : "border-[var(--ea-border)]",
    tone === "later" && "opacity-60 hover:opacity-100 focus-within:opacity-100"
  );
}

export function WelcomeCard({ data }: { data: WelcomeCardData }) {
  const [connectStep, ...dataSteps] = data.steps;
  const doneCount = data.steps.filter((step) => step.done).length;
  const active = activeStepKey(data.steps);
  const toneOf = (step: FirstRunStep): StepTone =>
    step.done ? "done" : step.key === active ? "active" : "later";
  // Идэвхтэй багана өргөн (lg-ээс дээш); багана солигдоход grid зөөлөн шилжинэ.
  const columns = data.steps.map((step) => (step.key === active ? "1.5fr" : "1fr")).join(" ");
  const promptsOf = (step: FirstRunStep) =>
    step.promptIds
      .map((id) => data.prompts.find((prompt) => prompt.id === id))
      .filter((prompt): prompt is StarterPrompt => !!prompt);

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
            Өөрийн компаниа 15 минутад Entry-д
          </h2>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Хуучин програмын экспорт эсвэл Excel-ээ ChatGPT / Claude-даа өгөхөд AI нь данс, харилцагч,
            бараа, нээлтийн үлдэгдлийг Entry-д оруулна. Бүх бичилт НООРОГ болж орно — та шалгаж батална.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--ea-text-3)]">
            {doneCount}/{data.steps.length} хийгдсэн
          </span>
          <WelcomeDismiss />
        </div>
      </div>

      <div
        className="ea-stagger grid gap-3 transition-[grid-template-columns] duration-500 lg:grid-cols-[var(--ea-welcome-cols)]"
        style={{ "--ea-welcome-cols": columns } as CSSProperties}
      >
        {/* ① ChatGPT / Claude-даа холбох */}
        <div className={stepBoxClass(toneOf(connectStep))} style={{ "--ea-i": 0 } as CSSProperties}>
          <StepHeader n={1} step={connectStep} />
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

        {/* ② Хуучин датагаа өгөх · ③ Нээлтийн үлдэгдэл, тэнцэл */}
        {dataSteps.map((step, index) => (
          <div
            key={step.key}
            className={stepBoxClass(toneOf(step))}
            style={{ "--ea-i": index + 1 } as CSSProperties}
          >
            <StepHeader n={index + 2} step={step} />
            <StarterPrompts prompts={promptsOf(step)} columns={1} />
          </div>
        ))}
      </div>

      <p className="mt-3 border-t border-[var(--ea-border)] pt-3 text-xs text-[var(--ea-text-3)]">
        Бусад жишээ асуулт, бичилтийн горим, token —{" "}
        <Link href="/ai#starter-prompts" className="text-[var(--ea-primary)] underline-offset-2 hover:underline">
          AI холболт
        </Link>{" "}
        хуудсанд.
      </p>
    </section>
  );
}
