"use server";

// Компанийн мэдээлэл — нэхэмжлэх/хэвлэх маягтын толгой, тамга, гарын үсэг.
// Зургууд PNG, цэвэр base64-аар DB-д хадгалагдана (aiAttachments-тай ижил загвар).

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companySettings, type CompanySettings } from "@/lib/db/schema";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  return session.user.id;
}

/** ~1MB-аас том зураг татгалзана — PDF/DB-ийг дэмий бүдүүрүүлэхгүй. */
const MAX_IMAGE_BYTES = 1_000_000;

function validatePngBase64(image: string, label: string) {
  const bytes = Math.ceil((image.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES)
    throw new Error(`${label}: зураг 1MB-аас том байна (${Math.round(bytes / 1024)}KB)`);
  // PNG magic number: 89 50 4E 47 → base64 "iVBORw"
  if (!image.startsWith("iVBORw"))
    throw new Error(`${label}: зөвхөн PNG формат дэмжинэ`);
}

export async function getCompanySettings(): Promise<CompanySettings | null> {
  const userId = await requireUser();
  return (
    (await db.query.companySettings.findFirst({
      where: eq(companySettings.userId, userId),
    })) ?? null
  );
}

export async function updateCompanySettings(data: {
  name: string;
  registerNo: string | null;
  vatPayerNo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bankAccounts: { bankName: string; accountNo: string; accountName: string }[];
  /** undefined = хөндөхгүй, null = устгах, string = шинэ PNG base64. */
  logo?: string | null;
  stamp?: string | null;
  signatures: { name: string; title: string; image: string }[];
  autoStamp: boolean;
}) {
  const userId = await requireUser();

  if (data.logo) validatePngBase64(data.logo, "Лого");
  if (data.stamp) validatePngBase64(data.stamp, "Тамга");
  for (const signature of data.signatures) {
    if (!signature.name.trim()) throw new Error("Гарын үсгийн нэр хоосон байна");
    validatePngBase64(signature.image, `Гарын үсэг (${signature.name})`);
  }
  if (data.signatures.length > 4)
    throw new Error("Дээд тал нь 4 гарын үсэг хадгална");

  const base = {
    name: data.name.trim(),
    registerNo: data.registerNo?.trim() || null,
    vatPayerNo: data.vatPayerNo?.trim() || null,
    address: data.address?.trim() || null,
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    bankAccounts: data.bankAccounts.filter((account) => account.accountNo.trim()),
    signatures: data.signatures,
    autoStamp: data.autoStamp,
    updatedAt: new Date(),
  };

  await db
    .insert(companySettings)
    .values({
      userId,
      ...base,
      logo: data.logo ?? null,
      stamp: data.stamp ?? null,
    })
    .onConflictDoUpdate({
      target: companySettings.userId,
      set: {
        ...base,
        // undefined бол хуучин зургаа хадгална.
        ...(data.logo !== undefined && { logo: data.logo }),
        ...(data.stamp !== undefined && { stamp: data.stamp }),
      },
    });

  revalidatePath("/settings/company");
}
