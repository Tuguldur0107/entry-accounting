export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        background: "linear-gradient(90deg, var(--ea-bg-2) 25%, var(--ea-bg-3) 50%, var(--ea-bg-2) 75%)",
        backgroundSize: "200% 100%",
        animation: "ea-shimmer 1.4s ease infinite",
        borderRadius: 4,
        ...style,
      }}
    />
  );
}
