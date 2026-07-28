// nextjs-port/components/auth/LedgerIllustration.tsx
'use client';

import * as React from 'react';
import { LEDGER_T, type Lang } from '@/lib/i18n';

export function LedgerIllustration({
  lang,
  currencyAccent = 'var(--ea-hero-amount)',
}: {
  lang: Lang;
  currencyAccent?: string;
}) {
  const lt = LEDGER_T[lang];
  const rows = [
    { acc: lang === 'mn' ? 'Авлага'              : lang === 'ru' ? 'Дебиторы'      : 'Accounts receivable', dr: '9,240,000', cr: '' },
    { acc: lang === 'mn' ? 'Борлуулалтын орлого' : lang === 'ru' ? 'Выручка'       : 'Sales revenue',       dr: '',          cr: '8,400,000' },
    { acc: lang === 'mn' ? 'НӨАТ өглөг'          : lang === 'ru' ? 'НДС к уплате'  : 'VAT payable',         dr: '',          cr: '840,000' },
    { acc: lang === 'mn' ? 'Цалингийн зардал'    : lang === 'ru' ? 'Расходы з/п'   : 'Salary expense',      dr: '2,100,000', cr: '' },
    { acc: lang === 'mn' ? 'Цалингийн өглөг'     : lang === 'ru' ? 'Зарплата к/у'  : 'Salary payable',      dr: '',          cr: '2,100,000' },
  ];

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--ea-hero-surface)',
        border: '1px solid var(--ea-hero-border)',
        borderRadius: 12,
        padding: '14px 16px 16px 16px',
        backdropFilter: 'blur(12px)',
        fontFamily: 'var(--ea-font-mono)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span
          style={{
            fontFamily: 'var(--ea-font-sans)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            opacity: 0.7,
          }}
        >
          {lt.journal} · JE-2026-0428
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--ea-hero-accent)',
            background: 'color-mix(in srgb, var(--ea-success) 18%, transparent)',
            border: '1px solid color-mix(in srgb, var(--ea-success) 32%, transparent)',
            padding: '2px 8px',
            borderRadius: 999,
            fontFamily: 'var(--ea-font-sans)',
            fontWeight: 500,
          }}
        >
          ● {lt.autoPosted}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 100px 100px',
          fontSize: 10,
          fontWeight: 600,
          opacity: 0.55,
          fontFamily: 'var(--ea-font-sans)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          paddingBottom: 8,
          borderBottom: '1px solid var(--ea-hero-border)',
        }}
      >
        <span />
        <span style={{ textAlign: 'right' }}>{lt.accountDr}</span>
        <span style={{ textAlign: 'right' }}>{lt.accountCr}</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px 100px',
            padding: '8px 0',
            fontSize: 12,
            alignItems: 'center',
            borderBottom: i < rows.length - 1 ? '1px solid var(--ea-hero-border-soft)' : 'none',
            opacity: 0,
            animation: `ea-fadeUp 0.4s ease ${0.4 + i * 0.12}s forwards`,
          }}
        >
          <span style={{ fontFamily: 'var(--ea-font-sans)', fontSize: 13 }}>{r.acc}</span>
          <span style={{ textAlign: 'right', color: r.dr ? currencyAccent : 'var(--ea-hero-muted)' }}>{r.dr || '—'}</span>
          <span style={{ textAlign: 'right', color: r.cr ? currencyAccent : 'var(--ea-hero-muted)' }}>{r.cr || '—'}</span>
        </div>
      ))}
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: '1.5px double var(--ea-hero-rule-strong)',
          display: 'grid',
          gridTemplateColumns: '1fr 100px 100px',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ea-hero-fg)',
        }}
      >
        <span style={{ fontFamily: 'var(--ea-font-sans)', fontSize: 12, opacity: 0.85 }}>Total ₮</span>
        <span style={{ textAlign: 'right' }}>11,340,000</span>
        <span style={{ textAlign: 'right' }}>11,340,000</span>
      </div>
    </div>
  );
}
