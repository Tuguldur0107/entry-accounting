"use client";

// Модулийн тохиргоо (Тохиргоо → Модулийн тохиргоо) — системд ашиглах
// модулиудыг бүлэглэн асааж унтраана:
//   Цөм (GL) — унтраах боломжгүй
//   Үндсэн нягтлан бодох бүртгэлийн багц — багцаараа эсвэл нэг нэгээр
//   Нэмэлт — Групп компанийн бүртгэл (AGIS), AI туслах
// Унтраасан модуль навигаци (switcher, палитр, "+ Шинэ", топбарын AI товч)-
// иас нуугдана; өмнө нь бичсэн дата болон шууд линк хэвээр үлдэнэ.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { batchSaveModuleConfigs } from "@/lib/actions/gl";
import {
  APP_MODULE_DEFS,
  APP_MODULE_GROUP_LABELS,
  type AppModuleGroup,
} from "@/lib/constants/app-modules";
import { cn } from "@/lib/utils";

interface ModuleConfigRow {
  moduleKey: string;
  isEnabled: boolean;
}

const GROUP_ORDER: AppModuleGroup[] = ["core", "accounting", "extra"];

export function ModuleSettings({ configs }: { configs: ModuleConfigRow[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const initial = useMemo(() => {
    const byKey = new Map(configs.map((row) => [row.moduleKey, row.isEnabled]));
    return Object.fromEntries(
      APP_MODULE_DEFS.map((def) => [
        def.key,
        def.locked ? true : byKey.get(def.key) ?? true,
      ])
    ) as Record<string, boolean>;
  }, [configs]);

  const [draft, setDraft] = useState<Record<string, boolean>>(initial);

  const dirtyKeys = APP_MODULE_DEFS.filter(
    (def) => !def.locked && draft[def.key] !== initial[def.key]
  ).map((def) => def.key);

  const accountingDefs = APP_MODULE_DEFS.filter(
    (def) => def.group === "accounting"
  );
  const accountingAllOn = accountingDefs.every((def) => draft[def.key]);

  function toggle(key: string) {
    setDraft((current) => ({ ...current, [key]: !current[key] }));
  }

  /** Багцын master switch — бүгдийг зэрэг асааж/унтраана. */
  function toggleAccountingBundle() {
    const next = !accountingAllOn;
    setDraft((current) => ({
      ...current,
      ...Object.fromEntries(accountingDefs.map((def) => [def.key, next])),
    }));
  }

  function cancel() {
    setDraft(initial);
  }

  async function save() {
    setSaving(true);
    try {
      const result = await batchSaveModuleConfigs(
        dirtyKeys.map((key) => ({ moduleKey: key, isEnabled: draft[key] }))
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      // Навигацийн харагдац layout-аас ирдэг тул серверийн өгөгдлийг сэргээнэ.
      router.refresh();
      toast.success("Модулийн тохиргоо хадгалагдлаа");
    } catch {
      toast.error("Модулийн тохиргоо хадгалагдсангүй");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Модулийн тохиргоо
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ea-text-3)" }}>
            Системд ашиглах модулиудыг идэвхжүүлнэ. Унтраасан модуль навигациас
            нуугдана — өмнө нь бичсэн дата болон шууд линк хэвээр үлдэнэ.
          </p>
        </div>
        {dirtyKeys.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--ea-text-3)" }}>
              {dirtyKeys.length} өөрчлөлт
            </span>
            <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
              Болих
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        )}
      </div>

      {GROUP_ORDER.map((group) => {
        const defs = APP_MODULE_DEFS.filter((def) => def.group === group);
        const meta = APP_MODULE_GROUP_LABELS[group];
        return (
          <div key={group}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
                  {meta.title}
                </h2>
                <p className="text-xs" style={{ color: "var(--ea-text-3)" }}>
                  {meta.description}
                </p>
              </div>
              {group === "accounting" && (
                <label className="flex shrink-0 items-center gap-2 text-xs text-[var(--ea-text-2)]">
                  Багцаараа
                  <Switch
                    checked={accountingAllOn}
                    onCheckedChange={toggleAccountingBundle}
                  />
                </label>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {defs.map((def) => {
                const on = draft[def.key];
                const isDirty = !def.locked && on !== initial[def.key];
                return (
                  <div
                    key={def.key}
                    className={cn(
                      "rounded-md border bg-[var(--ea-surface)] px-4 py-3 transition-opacity",
                      !on && "opacity-50",
                      isDirty
                        ? "border-[var(--ea-primary)]"
                        : "border-[var(--ea-border)]"
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-xs font-bold uppercase text-[var(--ea-primary)]">
                        {def.key}
                      </span>
                      <Switch
                        checked={on}
                        disabled={def.locked}
                        onCheckedChange={() => toggle(def.key)}
                      />
                    </div>
                    <div className="text-sm font-medium leading-tight text-[var(--ea-text-2)]">
                      {def.nameMn}
                    </div>
                    <div className="mt-1 text-[11px] leading-tight text-[var(--ea-text-4)]">
                      {def.name}
                    </div>
                    <div className="mt-1.5 text-[11px] leading-tight text-[var(--ea-text-4)]">
                      {def.description}
                    </div>
                    {def.locked && (
                      <div className="mt-1.5 text-[11px] text-[var(--ea-text-3)]">
                        Системийн суурь — унтраах боломжгүй
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
