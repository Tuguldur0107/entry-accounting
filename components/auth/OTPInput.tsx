// nextjs-port/components/auth/OTPInput.tsx
'use client';

import * as React from 'react';

export function OTPInput({
  value,
  onChange,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const chars = (value || '').padEnd(length, ' ').slice(0, length).split('');

  const set = (i: number, v: string) => {
    const s = (value || '').split('');
    s[i] = v;
    const next = s.join('').slice(0, length);
    onChange(next);
    if (v && i < length - 1) refs.current[i + 1]?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === 'Backspace' && !chars[i].trim() && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const txt = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (txt) {
      e.preventDefault();
      onChange(txt);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${length}, 1fr)`, gap: 10 }}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={(chars[i] || '').trim()}
          onChange={(e) => set(i, e.target.value.replace(/\D/g, '').slice(-1))}
          onKeyDown={(e) => onKey(e, i)}
          onPaste={onPaste}
          inputMode="numeric"
          maxLength={1}
          onFocus={(e) => (e.target.style.boxShadow = 'var(--ea-focus)')}
          onBlur={(e) => (e.target.style.boxShadow = 'none')}
          style={{
            width: '100%',
            height: 56,
            textAlign: 'center',
            fontSize: 22,
            fontWeight: 600,
            fontFamily: 'var(--ea-font-mono)',
            color: 'var(--ea-text-1)',
            background: 'var(--ea-surface)',
            border: `1.5px solid ${chars[i].trim() ? 'var(--ea-primary)' : 'var(--ea-border-strong)'}`,
            borderRadius: 10,
            outline: 'none',
            transition: 'all .15s ease',
          }}
        />
      ))}
    </div>
  );
}
