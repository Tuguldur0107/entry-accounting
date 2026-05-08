import { Skeleton } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="space-y-4">
      {/* Title */}
      <Skeleton style={{ width: 160, height: 22 }} />

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ background: "var(--ea-surface)", border: "1px solid var(--ea-border)", borderRadius: 8, padding: 16 }}>
            <Skeleton style={{ width: 80, height: 12, marginBottom: 10 }} />
            <Skeleton style={{ width: 120, height: 22 }} />
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: "var(--ea-surface)", border: "1px solid var(--ea-border)", borderRadius: 8, overflow: "hidden" }}>
        <div className="flex gap-4 px-4 py-2.5" style={{ background: "var(--ea-bg-2)", borderBottom: "1px solid var(--ea-border)" }}>
          {[120, 80, 80, 80].map((w, i) => (
            <Skeleton key={i} style={{ width: w, height: 13 }} />
          ))}
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4 px-4 py-2.5" style={{ borderTop: "1px solid var(--ea-border)" }}>
            {[120, 80, 80, 80].map((w, j) => (
              <Skeleton key={j} style={{ width: w, height: 13 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
