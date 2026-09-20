'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { LoginShell, type AuthHandlers } from '@/components/auth/LoginShell';
import { requestPasswordReset } from '@/lib/actions/account-recovery';

export default function LoginPage() {
  const router = useRouter();
  // Deployment-ийн лиценз — бүртгэлгүй хуулбарт нэвтрэх формын оронд
  // тайлбар үзүүлнэ (шалгалт нь server талд /api/health + authorize дотор;
  // энэ нь зөвхөн хэрэглэгчид ойлгомжтой болгох дэлгэц).
  const [licenseError, setLicenseError] = React.useState<string | null>(null);
  React.useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((health) => {
        if (health?.license && health.license.ok === false)
          setLicenseError(health.license.reason ?? 'Энэ хувилбар Entry-д бүртгэлгүй байна');
      })
      .catch(() => {});
  }, []);

  if (licenseError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--ea-bg)] px-4">
        <div className="max-w-md rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] p-8 text-center">
          <h1 className="text-lg font-semibold text-[var(--ea-danger-fg)]">
            {licenseError}
          </h1>
          <p className="mt-3 text-sm text-[var(--ea-text-3)]">
            Энэ систем Entry Console-оор идэвхжүүлэгдсэн байгууллагад л
            үйлчилнэ. Лиценз авах бол манай багтай холбогдоно уу.
          </p>
        </div>
      </div>
    );
  }

  const handlers: AuthHandlers = {
    verifyPassword: async (email, password) => {
      const res = await signIn('credentials', { identifier: email, password, redirect: false });
      if (res?.error) throw new Error('Нууц үг буруу байна');
      // callbackUrl — OAuth authorize зэрэг хуудаснаас ирсэн бол буцаана.
      // Зөвхөн дотоод зам ("/...") зөвшөөрнө — open redirect хаалттай.
      const callback = new URLSearchParams(window.location.search).get('callbackUrl');
      router.push(callback && callback.startsWith('/') && !callback.startsWith('//') ? callback : '/');
    },

    selectOrg: async () => {
      router.push('/');
    },

    sendResetEmail: async (email) => {
      // Server action: и-мэйл байгаа бол сэргээх линк (1 цаг) илгээнэ;
      // байхгүй хаягт ч «илгээлээ» гэж хариулна (enumeration хаалттай).
      const res = await requestPasswordReset(email);
      if (res.error) throw new Error(res.error);
    },
  };

  return <LoginShell lang="mn" handlers={handlers} />;
}
