import { Skeleton } from "@/components/ui/skeleton";

export default function JournalLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <Skeleton style={{ width: 140, height: 22 }} />
        <Skeleton style={{ width: 120, height: 36, borderRadius: 8 }} />
      </div>

      {/* Voucher cards */}
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            background: "var(--ea-surface)",
            border: "1px solid var(--ea-border)",
            borderRadius: 8,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          {/* Card header */}
          <div
            style={{ background: "var(--ea-bg-2)", borderBottom: "1px solid var(--ea-border)", padding: "10px 16px" }}
            className="flex items-center gap-4"
          >
            <Skeleton style={{ width: 90, height: 14 }} />
            <Skeleton style={{ width: 180, height: 14 }} />
            <Skeleton style={{ width: 60, height: 20, borderRadius: 99, marginLeft: "auto" }} />
          </div>
          {/* Lines */}
          {[1, 2, 3].map((j) => (
            <div key={j} className="flex items-center gap-4 px-4 py-2.5" style={{ borderTop: j > 1 ? "1px solid var(--ea-border)" : undefined }}>
              <Skeleton style={{ width: 200, height: 13 }} />
              <Skeleton style={{ width: 80, height: 13, marginLeft: "auto" }} />
              <Skeleton style={{ width: 80, height: 13 }} />
              <Skeleton style={{ width: 120, height: 13 }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
