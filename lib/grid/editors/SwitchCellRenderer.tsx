"use client";

import type { CustomCellRendererProps } from "ag-grid-react";
import { Switch } from "@/components/ui/switch";

export function SwitchCellRenderer(
  props: CustomCellRendererProps<Record<string, unknown>, boolean> & {
    onToggle?: (rowData: Record<string, unknown> | null, next: boolean) => void;
    disabled?: boolean;
  }
) {
  const checked = !!props.value;
  return (
    <div className="flex items-center justify-center h-full">
      <Switch
        checked={checked}
        disabled={props.disabled}
        onCheckedChange={(next) => props.onToggle?.(props.data ?? null, next)}
      />
    </div>
  );
}
