'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { AuthPageShell } from '@/components/auth/auth-page-shell';
import { EAField, EAButton } from '@/components/auth/fields';
import { Icon } from '@/components/ui/icon';
import { resetPassword } from '@/lib/actions/account-recovery';

export default function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (password.length < 8) { setError('Нууц үг 8-аас доошгүй тэмдэгттэй байна'); return; }
    if (password !== confirm) { setError('Нууц үг давхар бичилттэй таарахгүй байна'); return; }
    setError(''); setLoading(true);
    const res = await resetPassword({ token, password });
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setDone(true);
  }

  if (!token) {
    return (
      <AuthPageShell title="Сэргээх линк дутуу байна">
        <p style={subStyle}>Линк бүтэн хуулагдаагүй бололтой. И-мэйл дэх линкийг дахин дарна уу эсвэл шинэ хүсэлт илгээнэ үү.</p>
        <BackToLogin />
      </AuthPageShell>
    );
  }

  if (done) {
    return (
      <AuthPageShell title="Нууц үг солигдлоо" icon="success">
        <p style={subStyle}>Шинэ нууц үгээрээ нэвтэрнэ үү.</p>
        <BackToLogin primary />
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title="Шинэ нууц үг">
      <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
        <EAField label="Шинэ нууц үг" type="password" value={password} onChange={setPassword} placeholder="8+ тэмдэгт" icon={<Icon name="locked" />} autoComplete="new-password" autoFocus hint="8-аас доошгүй тэмдэгт" />
        <div style={{ marginTop: 14 }}>
          <EAField label="Давтан бичих" type="password" value={confirm} onChange={setConfirm} placeholder="Дахин бичнэ үү" icon={<Icon name="locked" />} autoComplete="new-password" error={error} />
        </div>
        <div style={{ marginTop: 22 }}>
          <EAButton type="submit" loading={loading} fullWidth>
            {loading ? 'Хадгалж байна…' : 'Нууц үг солих'}
          </EAButton>
        </div>
      </form>
      <BackToLogin />
    </AuthPageShell>
  );
}

const subStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.7, color: 'var(--ea-text-3)', margin: '8px 0 20px' };

function BackToLogin({ primary }: { primary?: boolean }) {
  return (
    <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: 'var(--ea-text-3)' }}>
      <Link href="/login" style={{ fontWeight: 500, color: 'var(--ea-primary)' }}>
        {primary ? 'Нэвтрэх' : '← Нэвтрэх рүү буцах'}
      </Link>
    </div>
  );
}
