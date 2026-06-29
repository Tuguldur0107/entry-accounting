"use client";

import dynamic from "next/dynamic";
import type { DataGridHandle, DataGridProps } from "./DataGrid";

const DataGridDynamicImpl = dynamic(
  () => import("./DataGrid").then((module) => module.DataGrid as never),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex w-full items-center justify-center"
        style={{ height: 360, color: "var(--ea-text-4)" }}
      >
        <span className="text-xs">Хүснэгт ачаалж байна...</span>
      </div>
    ),
  }
);

export const DataGridDynamic = DataGridDynamicImpl as unknown as <TData>(
  props: DataGridProps<TData> & { ref?: React.Ref<DataGridHandle> }
) => React.ReactElement;

export type { DataGridHandle, DataGridProps };

