'use client';

import * as React from 'react';
import { Icon } from "@/components/ui/icon";
import { useState } from 'react';
import Link from 'next/link';
import { EAMark, EAWordmark } from '@/components/auth/brand';
import { EAField, EAButton } from '@/components/auth/fields';
import { HeroPixelGrid } from '@/components/auth/hero-pixel-grid';
import { registerUser } from '@/lib/actions/auth';
import { ThemeToggle } from '@/components/theme-toggle';

export default function RegisterPage() {
  // registerUser амжилттай бол server action өөрөө redirect хийдэг тул router хэрэггүй
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
      // Урилгын линкээр (/register?invite=token) ирсэн бол token дамжуулна —
      // бүртгэл дуусмагц урьсан байгууллагад шууд элсэнэ.
      const invite =
        new URLSearchParams(window.location.search).get('invite') ?? undefined;
      const res = await registerUser({ name, email, password, invite });
      if (res?.error) { setError(res.error); setLoading(false); }
      // redirects on success
    } catch {
      setError('Алдаа гарлаа. Дахин оролдоно уу.');
      setLoading(false);
    }
  }

  return (
    // Дэвсгэрийг тодорхойлохгүй — аппын --ea-bg-gradient (globals.css → body) ил гарна
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header
        className="ea-glass"
        style={{ borderBottom: '1px solid var(--ea-border)', padding: '18px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <EAMark size={32} />
          <EAWordmark size={17} />
        </div>
        {/* Тусламж нь footer-т байгаа тул энд давхардуулахгүй */}
        <ThemeToggle />
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 24px' }}>
        {/* ea-glass — UI kit-ийн шилэн гадаргуу (нэвтрэх хуудастай ижил) */}
        <div className="ea-fade-up ea-glass" style={{
          width: '100%', maxWidth: 960,
          display: 'grid', gridTemplateColumns: '1.05fr 0.95fr',
          border: '1px solid var(--ea-border)',
          borderRadius: 'var(--ea-r-xl)', boxShadow: 'var(--ea-shadow-3)',
          overflow: 'hidden', minHeight: 620,
        }}>
          {/* Left */}
          <div style={{
            background: 'var(--ea-hero-gradient)',
            color: 'var(--ea-hero-fg)', padding: '36px 32px',
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

          {/* Right */}
          <div style={{ padding: '36px 40px', display: 'flex', flexDirection: 'column' }}>
            {/* <form> — Enter дарахад илгээгдэнэ, нууц үг хадгалагч танина */}
            <form className="ea-fade-up" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
              <h1 style={{ fontFamily: 'var(--ea-font-display)', fontSize: 24, fontWeight: 500, margin: 0, letterSpacing: '-0.01em' }}>
                Шинэ бүртгэл үүсгэх
              </h1>
              <p style={{ fontSize: 13, color: 'var(--ea-text-3)', margin: '6px 0 28px 0', lineHeight: 1.5 }}>
                Мэдээллээ оруулаад бүртгэлээ үүсгэнэ үү
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <EAField label="Нэр" value={name} onChange={setName} placeholder="Овог нэр" icon={<Icon name="user" />} autoComplete="name" autoFocus />
                <EAField label="И-мэйл" value={email} onChange={setEmail} placeholder="name@company.mn" icon={<Icon name="mail" />} autoComplete="email" />
                <EAField label="Нууц үг" type="password" value={password} onChange={(v) => { setPassword(v); setError(''); }} placeholder="8+ тэмдэгт"
                  icon={<Icon name="locked" />} autoComplete="new-password" error={error || undefined} />
              </div>

              <div style={{ marginTop: 24 }}>
                <EAButton type="submit" loading={loading} fullWidth disabled={!name.trim() || !email.trim() || !password}>
                  {loading ? 'Бүртгэж байна...' : <>{`Бүртгүүлэх`} <Icon name="arrowRight" /></>}
                </EAButton>
              </div>

              <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--ea-text-3)' }}>
                Бүртгэлтэй юу?{' '}
                <Link href="/login" style={{ fontWeight: 500, color: 'var(--ea-primary)' }}>Нэвтрэх</Link>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        className="ea-glass"
        style={{
          padding: '20px 32px', borderTop: '1px solid var(--ea-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, flexWrap: 'wrap',
          fontSize: 12, color: 'var(--ea-text-3)',
        }}
      >
        <span>© 2026 Entry Accounting · Бүх эрх хуулиар хамгаалагдсан</span>
        <a href="mailto:support@entry.mn" style={{ color: 'var(--ea-text-3)' }}>Тусламж</a>
      </footer>
    </div>
  );
}
