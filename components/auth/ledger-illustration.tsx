import * as React from 'react';

const ROWS = [
  { acc: 'Касс',             dr: '4,200,000', cr: '' },
  { acc: 'Авлага',           dr: '',          cr: '4,200,000' },
  { acc: 'Бараа борлуулалт', dr: '',          cr: '8,400,000' },
  { acc: 'НӨАТ-ийн өглөг',   dr: '',          cr: '840,000' },
  { acc: 'Цалин',            dr: '2,100,000', cr: '' },
];

const ACCENT = '#FFD79A';

export function LedgerIllustration() {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.10)',
      borderRadius: 12, padding: '14px 16px 16px',
      backdropFilter: 'blur(12px)',
      fontFamily: 'var(--ea-font-mono)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', opacity: 0.7 }}>
          Журнал · JE-2026-0428
        </span>
        <span style={{
          fontSize: 10, color: '#A7F3D0',
          background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.32)',
          padding: '2px 8px', borderRadius: 999,
          fontFamily: 'var(--font-sans)', fontWeight: 500,
        }}>
          ● Бичигдсэн
        </span>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 100px 100px',
        fontSize: 10, fontWeight: 600, opacity: 0.55,
        fontFamily: 'var(--font-sans)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.10)',
      }}>
        <span />
        <span style={{ textAlign: 'right' }}>Дебет</span>
        <span style={{ textAlign: 'right' }}>Кредит</span>
      </div>
      {ROWS.map((r, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '1fr 100px 100px',
          padding: '8px 0', fontSize: 12, alignItems: 'center',
          borderBottom: i < ROWS.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
          opacity: 0,
          animation: `ea-fadeUp 0.4s ease ${0.4 + i * 0.1}s forwards`,
        }}>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}>{r.acc}</span>
          <span style={{ textAlign: 'right', color: r.dr ? ACCENT : 'rgba(255,255,255,0.25)' }}>{r.dr || '—'}</span>
          <span style={{ textAlign: 'right', color: r.cr ? ACCENT : 'rgba(255,255,255,0.25)' }}>{r.cr || '—'}</span>
        </div>
      ))}
      <div style={{
        marginTop: 10, paddingTop: 10,
        borderTop: '1.5px double rgba(255,255,255,0.30)',
        display: 'grid', gridTemplateColumns: '1fr 100px 100px',
        fontSize: 13, fontWeight: 600, color: '#fff',
      }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, opacity: 0.85 }}>Нийт ₮</span>
        <span style={{ textAlign: 'right' }}>6,300,000</span>
        <span style={{ textAlign: 'right' }}>13,440,000</span>
      </div>
    </div>
  );
}
