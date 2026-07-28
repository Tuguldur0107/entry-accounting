// nextjs-port/components/auth/brand.tsx
import * as React from 'react';

// Geometric "E" mark — square with two stacked accent lines
export function EAMark({ size = 32 }: { size?: number }) {
  const r = size * 0.18;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-label="Entry Accounting">
      <rect x="2" y="2" width="36" height="36" rx={r} fill="var(--ea-primary)" />
      <rect x="11" y="11" width="18" height="3" rx="1" fill="var(--ea-hero-fg)" />
      <rect x="11" y="18.5" width="13" height="3" rx="1" fill="var(--ea-hero-fg)" opacity="0.8" />
      <rect x="11" y="26" width="18" height="3" rx="1" fill="var(--ea-hero-fg)" />
    </svg>
  );
}

export function EAWordmark({ size = 18 }: { size?: number }) {
  return (
    <span
      style={{
        fontFamily: 'var(--ea-font-display)',
        fontSize: size,
        fontWeight: 500,
        letterSpacing: '-0.005em',
        color: 'var(--ea-text-1)',
        lineHeight: 1,
      }}
    >
      Entry <em style={{ fontStyle: 'italic', fontWeight: 400 }}>Accounting</em>
    </span>
  );
}
