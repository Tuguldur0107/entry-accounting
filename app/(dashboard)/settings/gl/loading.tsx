import { Skeleton } from "@/components/ui/skeleton";

export default function GlSettingsLoading() {
  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-5">
        {[100, 80, 80].map((w, i) => (
          <Skeleton key={i} style={{ width: w, height: 32, borderRadius: 6 }} />
        ))}
      </div>

      {/* Rows */}
      <div style={{ background: "var(--ea-surface)", border: "1px solid var(--ea-border)", borderRadius: 8, overflow: "hidden" }}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-2.5"
            style={{ borderTop: i > 1 ? "1px solid var(--ea-border)" : undefined }}
          >
            <Skeleton style={{ width: 90, height: 13 }} />
            <Skeleton style={{ width: 160, height: 13 }} />
            <Skeleton style={{ width: 40, height: 20, borderRadius: 99, marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
