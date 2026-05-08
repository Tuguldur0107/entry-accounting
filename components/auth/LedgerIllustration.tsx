// nextjs-port/components/auth/LedgerIllustration.tsx
'use client';

import * as React from 'react';
import { LEDGER_T, type Lang } from '@/lib/i18n';

export function LedgerIllustration({
  lang,
  currencyAccent = '#FFD79A',
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
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
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
            color: '#A7F3D0',
            background: 'rgba(16,185,129,0.18)',
            border: '1px solid rgba(16,185,129,0.32)',
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
          borderBottom: '1px solid rgba(255,255,255,0.10)',
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
            borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
            opacity: 0,
            animation: `ea-fadeUp 0.4s ease ${0.4 + i * 0.12}s forwards`,
          }}
        >
          <span style={{ fontFamily: 'var(--ea-font-sans)', fontSize: 13 }}>{r.acc}</span>
          <span style={{ textAlign: 'right', color: r.dr ? currencyAccent : 'rgba(255,255,255,0.25)' }}>{r.dr || '—'}</span>
          <span style={{ textAlign: 'right', color: r.cr ? currencyAccent : 'rgba(255,255,255,0.25)' }}>{r.cr || '—'}</span>
        </div>
      ))}
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: '1.5px double rgba(255,255,255,0.30)',
          display: 'grid',
          gridTemplateColumns: '1fr 100px 100px',
          fontSize: 13,
          fontWeight: 600,
          color: '#fff',
        }}
      >
        <span style={{ fontFamily: 'var(--ea-font-sans)', fontSize: 12, opacity: 0.85 }}>Total ₮</span>
        <span style={{ textAlign: 'right' }}>11,340,000</span>
        <span style={{ textAlign: 'right' }}>11,340,000</span>
      </div>
    </div>
  );
}
