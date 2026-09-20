// Нууц үг сэргээх — и-мэйлийн линкээс (/reset-password?token=…). Нэвтрэлт
// шаардахгүй (proxy.ts isPublicAccountPage); token нэг удаа, 1 цаг.
import { Suspense } from "react";

import ResetPasswordForm from "./reset-password-form";

export const metadata = { title: "Нууц үг сэргээх — Entry Accounting" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
