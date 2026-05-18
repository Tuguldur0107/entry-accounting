"use client";

import dynamic from "next/dynamic";
import type { EaGridProps, EaGridHandle } from "./EaGrid";

// SSR-safe entry point. AG Grid touches `document` during module init, so
// every callsite imports the grid via this dynamic wrapper.
const EaGridDynamicImpl = dynamic(() => import("./EaGrid").then((m) => m.EaGrid as never), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center w-full"
      style={{ height: 360, color: "var(--ea-text-4)" }}
    >
      <span className="text-xs">Хүснэгт ачаалж байна…</span>
    </div>
  ),
});

export const EaGridDynamic = EaGridDynamicImpl as unknown as <TData>(
  props: EaGridProps<TData> & { ref?: React.Ref<EaGridHandle> }
) => React.ReactElement;

export type { EaGridProps, EaGridHandle };
