'use client';

import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EAMark, EAWordmark } from '@/components/auth/brand';
import { EAField, EAButton } from '@/components/auth/fields';
import { LedgerIllustration } from '@/components/auth/LedgerIllustration';
import { MailIcon, LockIcon, ArrowRightIcon, ShieldIcon } from '@/components/auth/icons';
import { registerUser } from '@/lib/actions/auth';
import { ThemeToggle } from '@/components/theme-toggle';

const UserIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

const STATS = [
  { v: '47',  l: 'бичилт' },
  { v: '128', l: 'данс' },
  { v: '12',  l: 'тайлан' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !email.trim() || !password) { setError('Бүх талбарыг бөглөнө үү'); return; }
    if (password.length < 8) { setError('Нууц үг 8+ тэмдэгт байна'); return; }
    setError(''); setLoading(true);
    try {
      const res = await registerUser({ name, email, password });
      if (res?.error) { setError(res.error); setLoading(false); }
      // redirects on success
    } catch {
      setError('Алдаа гарлаа. Дахин оролдоно уу.');
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ea-bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: 'var(--ea-surface)', borderBottom: '1px solid var(--ea-border)', padding: '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <EAMark size={32} />
          <EAWordmark size={17} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
          <a href="mailto:support@entry.mn" style={{ color: 'var(--ea-text-2)' }}>Тусламж</a>
          <ThemeToggle />
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px' }}>
        <div className="ea-fade-up" style={{
          width: '100%', maxWidth: 960,
          display: 'grid', gridTemplateColumns: '1.05fr 0.95fr',
          background: 'var(--ea-surface)', border: '1px solid var(--ea-border)',
          borderRadius: 'var(--ea-r-xl)', boxShadow: 'var(--ea-shadow-3)',
          overflow: 'hidden', minHeight: 620,
        }}>
          {/* Left */}
          <div style={{
            background: 'var(--ea-hero-gradient)',
            color: '#fff', padding: '36px 32px',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 20,
            position: 'relative', overflow: 'hidden',
          }}>
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.06 }}>
              {Array.from({ length: 22 }).map((_, i) => (
                <line key={i} x1="0" x2="100%" y1={i * 28 + 14} y2={i * 28 + 14} stroke="#fff" strokeWidth="1" />
              ))}
            </svg>
            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', opacity: 0.72, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#A7F3D0' }} />
                Шинэ бүртгэл · {new Date().toLocaleDateString('mn-MN', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <h2 style={{ fontFamily: 'var(--ea-font-display)', fontSize: 30, fontWeight: 400, lineHeight: 1.18, letterSpacing: '-0.015em', margin: 0 }}>
                Нягтлан бодох{' '}<em style={{ fontWeight: 400, opacity: 0.95 }}>бүртгэл эхлүүлье</em>
              </h2>
            </div>
            <div style={{ position: 'relative' }}><LedgerIllustration lang="mn" /></div>
            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', opacity: 0.6, marginBottom: 10 }}>
                Өнөөдөр хийгдсэн ажил
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
                {STATS.map((s, i) => (
                  <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}>
                    <div style={{ fontFamily: 'var(--ea-font-mono)', fontSize: 18, fontWeight: 500 }}>{s.v}</div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{s.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldIcon width={13} height={13} /> Энэхүү холболт нь SSL/TLS-ээр хамгаалагдсан
              </div>
            </div>
          </div>

          {/* Right */}
          <div style={{ padding: '36px 40px', display: 'flex', flexDirection: 'column' }}>
            <div className="ea-fade-up">
              <h2 style={{ fontFamily: 'var(--ea-font-display)', fontSize: 24, fontWeight: 500, margin: 0, letterSpacing: '-0.01em' }}>
                Шинэ бүртгэл үүсгэх
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ea-text-3)', margin: '6px 0 28px 0', lineHeight: 1.5 }}>
                Мэдээллээ оруулаад бүртгэлээ үүсгэнэ үү
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <EAField label="Нэр" value={name} onChange={setName} placeholder="Овог нэр" icon={<UserIcon />} autoComplete="name" autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
                <EAField label="И-мэйл" value={email} onChange={setEmail} placeholder="name@company.mn" icon={<MailIcon />} autoComplete="email"
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
                <EAField label="Нууц үг" type="password" value={password} onChange={(v) => { setPassword(v); setError(''); }} placeholder="8+ тэмдэгт"
                  icon={<LockIcon />} autoComplete="new-password" error={error || undefined}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()} />
              </div>

              <div style={{ marginTop: 24 }}>
                <EAButton onClick={handleSubmit} loading={loading} fullWidth disabled={!name.trim() || !email.trim() || !password}>
                  {loading ? 'Бүртгэж байна...' : <>{`Бүртгүүлэх`} <ArrowRightIcon /></>}
                </EAButton>
              </div>

              <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--ea-text-3)' }}>
                Бүртгэлтэй юу?{' '}
                <Link href="/login" style={{ fontWeight: 500, color: 'var(--ea-primary)' }}>Нэвтрэх</Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        padding: '20px 32px', borderTop: '1px solid var(--ea-border)', background: 'var(--ea-surface)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: 'var(--ea-text-3)',
      }}>
        <span>© 2026 Entry Accounting · Бүх эрх хуулиар хамгаалагдсан</span>
      </footer>
    </div>
  );
}
