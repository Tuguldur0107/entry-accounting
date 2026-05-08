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
      router.push('/gl/journal');
    },

    selectOrg: async () => {
      router.push('/gl/journal');
    },

    sendResetEmail: async () => {
      // TODO: implement password reset
    },
  };

  return <LoginShell lang="mn" handlers={handlers} />;
}
