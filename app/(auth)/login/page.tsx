'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { LoginShell, type AuthHandlers } from '@/components/auth/LoginShell';

export default function LoginPage() {
  const router = useRouter();

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

    sendResetEmail: async () => {
      // TODO: implement password reset
    },
  };

  return <LoginShell lang="mn" handlers={handlers} />;
}
