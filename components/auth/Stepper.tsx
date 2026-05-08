// nextjs-port/components/auth/Stepper.tsx
'use client';

import * as React from 'react';
import { CheckIcon } from './icons';

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                width: 22, height: 22, borderRadius: '50%',
                display: 'inline-grid', placeItems: 'center',
                fontWeight: 600, fontSize: 11,
                background: i < current ? 'var(--ea-primary)' : i === current ? 'var(--ea-surface)' : 'transparent',
                color: i < current ? '#fff' : i === current ? 'var(--ea-primary)' : 'var(--ea-text-4)',
                border: `1.5px solid ${i <= current ? 'var(--ea-primary)' : 'var(--ea-border-strong)'}`,
                fontFamily: 'var(--ea-font-mono)',
              }}
            >
              {i < current ? <CheckIcon width={11} height={11} /> : i + 1}
            </span>
            <span
              style={{
                color: i === current ? 'var(--ea-text-1)' : 'var(--ea-text-3)',
                fontWeight: i === current ? 600 : 500,
              }}
            >
              {s}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span
              style={{
                flex: 1, height: 1, minWidth: 16,
                background: i < current ? 'var(--ea-primary)' : 'var(--ea-border)',
              }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
