// nextjs-port/components/auth/LoginShell.tsx
'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { EAField, EAButton } from './fields';
import { EAMark, EAWordmark } from './brand';
import { LedgerIllustration } from './LedgerIllustration';
import { MailIcon, LockIcon, ShieldIcon, ArrowRightIcon } from './icons';
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
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    setDateStr(new Date().toLocaleDateString(
      lang === 'mn' ? 'mn-MN' : lang === 'ru' ? 'ru-RU' : 'en-US',
      { month: 'short', day: 'numeric', year: 'numeric' }
    ));
  }, [lang]);

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
        <>
          <a onClick={() => setMode('signin')} style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer', color: 'var(--ea-primary)' }}>
            ← {lt.backToSignIn}
          </a>
          <div style={{ marginTop: 16, marginBottom: 22 }}>
            <h2 style={titleStyle}>{lt.forgotTitle}</h2>
            <p style={subStyle}>{lt.forgotSub}</p>
          </div>
          <EAField label={t.email} value={email} onChange={setEmail} placeholder={t.emailPh} icon={<MailIcon />} autoComplete="email" />
          <div style={{ marginTop: 22 }}>
            <EAButton onClick={sendReset} loading={loading} fullWidth>
              {loading ? t.loading : lt.sendLink}
            </EAButton>
          </div>
        </>
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
          <h2 style={titleStyle}>{lt.forgotSent}</h2>
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
      <div className="ea-fade-up">
        <h2 style={{ ...titleStyle, marginBottom: 6 }}>{lt.step2Title}</h2>
        <p style={subStyle}>{lt.step2Sub}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <EAField
            label={t.email}
            value={email}
            onChange={setEmail}
            placeholder={t.emailPh}
            icon={<MailIcon />}
            autoComplete="email"
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
          <a onClick={() => setMode('forgot')} style={{ fontSize: 13, fontWeight: 500, cursor: 'pointer', color: 'var(--ea-primary)' }}>
            {t.forgot}
          </a>
        </div>
        <div style={{ marginTop: 20 }}>
          <EAButton onClick={signIn} loading={loading} fullWidth>
            {loading ? t.loading : <>{t.signIn} <ArrowRightIcon /></>}
          </EAButton>
        </div>
        <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--ea-text-3)' }}>
          {t.noAccount} <a href="/register" style={{ fontWeight: 500, color: 'var(--ea-primary)' }}>{t.register}</a>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ea-bg)', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '18px 20px', background: 'var(--ea-surface)', borderBottom: '1px solid var(--ea-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <EAMark size={32} />
          <EAWordmark size={17} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, flexShrink: 0 }}>
          <a href="/support" className="hidden sm:inline" style={{ color: 'var(--ea-text-2)' }}>{t.support}</a>
          <a href="/terms"   className="hidden sm:inline" style={{ color: 'var(--ea-text-2)' }}>{t.terms}</a>
          <ThemeToggle />
        </div>
      </header>

      <main style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px' }}>
        <div className="ea-fade-up" style={{
          width: '100%', maxWidth: 900,
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          background: 'var(--ea-surface)', border: '1px solid var(--ea-border)',
          borderRadius: 'var(--ea-r-xl)', boxShadow: 'var(--ea-shadow-3)',
          overflow: 'hidden', minHeight: 560,
        }}>
          {/* Left panel */}
          <div style={{
            background: 'linear-gradient(165deg, var(--ea-primary) 0%, var(--ea-primary-700) 100%)',
            color: '#fff', padding: '40px 36px',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            position: 'relative', overflow: 'hidden',
          }}>
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.06 }}>
              {Array.from({ length: 22 }).map((_, i) => (
                <line key={i} x1="0" x2="100%" y1={i * 28 + 14} y2={i * 28 + 14} stroke="#fff" strokeWidth="1" />
              ))}
            </svg>

            <div style={{ position: 'relative' }}>
              <div style={{
                fontSize: 11, fontWeight: 600, letterSpacing: '0.16em',
                textTransform: 'uppercase', opacity: 0.72, marginBottom: 14,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#A7F3D0' }} />
                {lt.ledgerEyebrow}{dateStr ? ` · ${dateStr}` : ''}
              </div>
              <h2 style={{
                fontFamily: 'var(--ea-font-display)', fontSize: 28, fontWeight: 400,
                lineHeight: 1.2, letterSpacing: '-0.015em', margin: 0,
              }}>
                {t.welcomeTitle}{' '}
                <em style={{ fontWeight: 400, opacity: 0.95 }}>{t.welcomeTitle2}</em>
              </h2>
            </div>

            <div style={{ position: 'relative' }}>
              <LedgerIllustration lang={lang} />
            </div>

            <div style={{ position: 'relative', fontSize: 12, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldIcon width={13} height={13} /> {t.secure}
            </div>
          </div>

          {/* Right panel */}
          <div style={{ padding: '40px 44px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            {formBody()}
          </div>
        </div>
      </main>

      <footer style={{
        padding: '20px 32px', borderTop: '1px solid var(--ea-border)', background: 'var(--ea-surface)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: 'var(--ea-text-3)',
      }}>
        <span>{t.copyright}</span>
        <span style={{ display: 'inline-flex', gap: 18 }}>
          <a href="/terms"   style={{ color: 'var(--ea-text-3)' }}>{t.terms}</a>
          <a href="/privacy" style={{ color: 'var(--ea-text-3)' }}>{t.privacy}</a>
          <a href="/support" style={{ color: 'var(--ea-text-3)' }}>{t.support}</a>
        </span>
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
