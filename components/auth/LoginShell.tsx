// nextjs-port/components/auth/LoginShell.tsx
'use client';

import * as React from 'react';
import { useState } from 'react';
import { EAField, EAButton } from './fields';
import { EAMark, EAWordmark } from './brand';
import { HeroPixelGrid } from './hero-pixel-grid';
import { MailIcon, LockIcon, ArrowRightIcon } from './icons';
import { T, LEDGER_T, type Lang } from '@/lib/i18n';
import { ThemeToggle } from '@/components/theme-toggle';

export type AuthHandlers = {
  verifyPassword: (email: string, password: string) => Promise<void>;
  selectOrg: (orgId: string) => Promise<void>;
  sendResetEmail: (email: string) => Promise<void>;
};

type Mode = 'signin' | 'forgot' | 'forgot-sent';

export function LoginShell({
  lang = 'mn',
  initialEmail = '',
  handlers,
}: {
  lang?: Lang;
  initialEmail?: string;
  handlers: AuthHandlers;
}) {
  const t = T[lang];
  const lt = LEDGER_T[lang];

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState(initialEmail);
  const [pw, setPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    try {
      await handlers.verifyPassword(email, pw);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const sendReset = async () => {
    setLoading(true);
    try {
      await handlers.sendResetEmail(email);
      setMode('forgot-sent');
    } finally {
      setLoading(false);
    }
  };

  const formBody = () => {
    if (mode === 'forgot') {
      return (
        // <form> — Enter дарахад илгээгдэнэ, нууц үг хадгалагч танина
        <form onSubmit={(e) => { e.preventDefault(); sendReset(); }}>
          <button
            type="button"
            onClick={() => setMode('signin')}
            style={linkButtonStyle}
          >
            ← {lt.backToSignIn}
          </button>
          <div style={{ marginTop: 16, marginBottom: 22 }}>
            <h1 style={titleStyle}>{lt.forgotTitle}</h1>
            <p style={subStyle}>{lt.forgotSub}</p>
          </div>
          <EAField label={t.email} value={email} onChange={setEmail} placeholder={t.emailPh} icon={<MailIcon />} autoComplete="email" autoFocus />
          <div style={{ marginTop: 22 }}>
            <EAButton type="submit" loading={loading} fullWidth>
              {loading ? t.loading : lt.sendLink}
            </EAButton>
          </div>
        </form>
      );
    }

    if (mode === 'forgot-sent') {
      return (
        <div className="ea-fade-up">
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'color-mix(in srgb, var(--ea-success) 12%, var(--ea-surface))', color: 'var(--ea-success)',
            display: 'grid', placeItems: 'center',
            border: '1px solid color-mix(in srgb, var(--ea-success) 35%, transparent)', marginBottom: 18,
          }}>
            <MailIcon width={26} height={26} />
          </div>
          <h1 style={titleStyle}>{lt.forgotSent}</h1>
          <p style={{ ...subStyle, marginBottom: 22 }}>
            <b style={{ color: 'var(--ea-text-1)', fontWeight: 600 }}>{email}</b> {lt.forgotSentBody}
          </p>
          <EAButton onClick={() => setMode('signin')} variant="secondary" fullWidth>
            {lt.backToSignIn}
          </EAButton>
        </div>
      );
    }

    return (
      // <form> — Enter дарахад нэвтэрнэ, нууц үг хадгалагч (1Password г.м.) танина
      <form className="ea-fade-up" onSubmit={(e) => { e.preventDefault(); signIn(); }}>
        <h1 style={{ ...titleStyle, marginBottom: 6 }}>{lt.step2Title}</h1>
        <p style={subStyle}>{lt.step2Sub}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <EAField
            label={t.email}
            value={email}
            onChange={setEmail}
            placeholder={t.emailPh}
            icon={<MailIcon />}
            autoComplete="email"
            autoFocus
          />
          <EAField
            label={t.password}
            type="password"
            value={pw}
            onChange={(v) => { setPw(v); setPwError(''); }}
            placeholder={t.passwordPh}
            icon={<LockIcon />}
            autoComplete="current-password"
            error={pwError}
          />
        </div>
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <button type="button" onClick={() => setMode('forgot')} style={linkButtonStyle}>
            {t.forgot}
          </button>
        </div>
        <div style={{ marginTop: 20 }}>
          <EAButton type="submit" loading={loading} fullWidth>
            {loading ? t.loading : <>{t.signIn} <ArrowRightIcon /></>}
          </EAButton>
        </div>
        <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--ea-text-3)' }}>
          {t.noAccount} <a href="/register" style={{ fontWeight: 500, color: 'var(--ea-primary)' }}>{t.register}</a>
        </div>
      </form>
    );
  };

  return (
    // Дэвсгэрийг тодорхойлохгүй — аппын --ea-bg-gradient (globals.css → body)
    // ил гарна. Өмнө нь var(--ea-bg) хатуу тавьснаас градиент далдардаг байсан.
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        className="ea-glass"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '18px 20px', borderBottom: '1px solid var(--ea-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <EAMark size={32} />
          <EAWordmark size={17} />
        </div>
        {/* Тусламж / Үйлчилгээний нөхцөл нь footer-т байгаа тул энд давхардуулахгүй */}
        <ThemeToggle />
      </header>

      <main style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px' }}>
        {/* ea-glass — UI kit-ийн шилэн гадаргуу (аппын бусад карттай ижил) */}
        <div className="ea-fade-up ea-glass" style={{
          width: '100%', maxWidth: 900,
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          border: '1px solid var(--ea-border)',
          borderRadius: 'var(--ea-r-xl)', boxShadow: 'var(--ea-shadow-3)',
          overflow: 'hidden', minHeight: 560,
        }}>
          {/* Left panel */}
          <div style={{
            background: 'var(--ea-hero-gradient)',
            color: 'var(--ea-hero-fg)', padding: '40px 36px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            position: 'relative', overflow: 'hidden',
          }}>
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.06 }}>
              {Array.from({ length: 22 }).map((_, i) => (
                <line key={i} x1="0" x2="100%" y1={i * 28 + 14} y2={i * 28 + 14} stroke="var(--ea-hero-fg)" strokeWidth="1" />
              ))}
            </svg>

            {/* Текстгүй чимэглэл — 64×64 нүдний самбар, олон нүд нийлж дүрс болно */}
            <HeroPixelGrid className="relative" />
          </div>

          {/* Right panel */}
          <div style={{ padding: '40px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {formBody()}
          </div>
        </div>
      </main>

      <footer
        className="ea-glass"
        style={{
          padding: '20px 32px', borderTop: '1px solid var(--ea-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap',
          fontSize: 12, color: 'var(--ea-text-3)',
        }}
      >
        <span>{t.copyright}</span>
        {/* Зөвхөн ажилладаг холбоос. /terms, /privacy хуудас хараахан байхгүй
            тул тэдгээрийг түр хассан — үүсгэсний дараа буцааж нэмнэ. */}
        <a href="mailto:support@entry.mn" style={{ color: 'var(--ea-text-3)' }}>
          {t.support}
        </a>
      </footer>
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--ea-font-display)',
  fontSize: 24, fontWeight: 500, margin: 0, letterSpacing: '-0.01em',
};

const subStyle: React.CSSProperties = {
  fontSize: 13, color: 'var(--ea-text-3)', margin: '6px 0 22px 0', lineHeight: 1.5,
};

// Текст мэт харагдах товч — <a onClick> биш: гараас Tab-аар хүрч, Enter-ээр ажиллана
const linkButtonStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, cursor: 'pointer', color: 'var(--ea-primary)',
  background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
};
