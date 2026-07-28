"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import {
  ICON_CATALOG,
  type IconCategory,
  type IconName,
} from "@/components/ui/icon-registry";

const categoryLabels: Record<IconCategory, string> = {
  action: "Үйлдэл",
  navigation: "Навигаци",
  status: "Төлөв",
  data: "Өгөгдөл",
  module: "Модуль",
  theme: "Систем",
};

export function IconKitView() {
  const [selected, setSelected] = useState<IconName>("show");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return ICON_CATALOG;
    return ICON_CATALOG.filter(
      (item) =>
        item.name.toLocaleLowerCase().includes(normalized) ||
        item.label.toLocaleLowerCase().includes(normalized) ||
        categoryLabels[item.category].toLocaleLowerCase().includes(normalized)
    );
  }, [query]);

  const grouped = useMemo(
    () =>
      (Object.keys(categoryLabels) as IconCategory[]).map((category) => ({
        category,
        items: filtered.filter((item) => item.category === category),
      })),
    [filtered]
  );

  return (
    <div className="space-y-5">
      <section
        className="ea-glass space-y-4 p-5"
        style={{
          border: "1px solid var(--ea-border)",
          borderRadius: "var(--ea-r-lg)",
        }}
      >
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Icon state contract
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            Default, hover, pressed, selected, disabled, loading болон semantic
            tone бүгд Icon Kit token-оос удирдагдана.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-5">
          <StateSample label="Default">
            <IconAction name="edit" label="Засах" />
          </StateSample>
          <StateSample label="Outline">
            <IconAction name="filter" label="Шүүх" variant="outline" />
          </StateSample>
          <StateSample label="Selected">
            <IconAction
              name="show"
              label="Харагдац"
              selected
              pressed
              variant="outline"
            />
          </StateSample>
          <StateSample label="Disabled">
            <IconAction name="delete" label="Устгах" disabled />
          </StateSample>
          <StateSample label="Loading">
            <IconAction name="refresh" label="Шинэчилж байна" loading />
          </StateSample>
          <StateSample label="Danger">
            <IconAction name="delete" label="Устгах" variant="danger" />
          </StateSample>
          <StateSample label="Solid">
            <IconAction name="add" label="Нэмэх" variant="solid" />
          </StateSample>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--ea-border)] bg-[var(--ea-bg-2)] p-3">
          <Icon name="info" tone="muted" label="Мэдээлэл" />
          <Icon name="success" tone="success" label="Амжилттай" />
          <Icon name="warning" tone="warning" label="Анхааруулга" />
          <Icon name="error" tone="danger" label="Алдаа" />
          <Button variant="outline">
            <Icon name="download" />
            Татах
          </Button>
          <Button>
            <Icon name="save" />
            Хадгалах
          </Button>
        </div>
      </section>

      <section
        className="ea-glass space-y-4 p-5"
        style={{
          border: "1px solid var(--ea-border)",
          borderRadius: "var(--ea-r-lg)",
        }}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Semantic icon catalog
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
              Page нь Lucide нэр биш semantic нэр сонгоно. Сонгосон:
              <code className="ml-1 text-[var(--ea-interactive)]">{selected}</code>
            </p>
          </div>
          <label className="grid gap-1 text-[11px] text-[var(--ea-text-3)]">
            Icon хайх
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="add, тайлан, status…"
              className="h-8 w-56 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2.5 text-sm text-[var(--ea-text-1)] outline-none focus:shadow-[var(--ea-focus)]"
            />
          </label>
        </div>

        {grouped.map(({ category, items }) =>
          items.length ? (
            <div key={category} className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--ea-text-2)]">
                {categoryLabels[category]} · {items.length}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {items.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => setSelected(item.name)}
                    data-selected={selected === item.name || undefined}
                    className="ea-interactive flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 py-3 text-center data-[selected=true]:ea-is-selected"
                    title={`${item.label} — ${item.name}`}
                  >
                    <Icon
                      name={item.name}
                      size="xl"
                      state={selected === item.name ? "selected" : "default"}
                      tone={selected === item.name ? "selected" : "default"}
                    />
                    <span className="max-w-full truncate font-mono text-[10px] text-[var(--ea-text-2)]">
                      {item.name}
                    </span>
                    <span className="max-w-full truncate text-[10px] text-[var(--ea-text-4)]">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null
        )}
      </section>
    </div>
  );
}

function StateSample({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-1.5">
      {children}
      <span className="text-[10px] text-[var(--ea-text-4)]">{label}</span>
    </div>
  );
}
