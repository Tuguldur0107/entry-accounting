"use server";

// Компанийн мэдээлэл — нэхэмжлэх/хэвлэх маягтын толгой, тамга, гарын үсэг.
// Зургууд PNG, цэвэр base64-аар DB-д хадгалагдана (aiAttachments-тай ижил загвар).

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getActiveOrg, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  companySettings,
  organizations,
  type CompanySettings,
} from "@/lib/db/schema";
import { syncCompanySegmentValuesForGroup } from "@/lib/gl/segment-sync";


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
  const { orgId } = await getActiveOrg();
  return (
    (await db.query.companySettings.findFirst({
      where: eq(companySettings.organizationId, orgId),
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
  /** Нэхэмжлэх илгээгч и-мэйл (verify хийгдсэн домэйн) — null бол env default. */
  invoiceFromEmail?: string | null;
  invoiceReplyTo?: string | null;
  emailDomainVerified?: boolean;
}) {
  // Компанийн мэдээлэл = тохиргоо — admin+.
  const { orgId, userId } = await requireRole("admin");

  if (data.logo) validatePngBase64(data.logo, "Лого");
  if (data.stamp) validatePngBase64(data.stamp, "Тамга");
  for (const signature of data.signatures) {
    if (!signature.name.trim()) throw new Error("Гарын үсгийн нэр хоосон байна");
    validatePngBase64(signature.image, `Гарын үсэг (${signature.name})`);
  }
  if (data.signatures.length > 4)
    throw new Error("Дээд тал нь 4 гарын үсэг хадгална");

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invoiceFromEmail = data.invoiceFromEmail?.trim() || null;
  const invoiceReplyTo = data.invoiceReplyTo?.trim() || null;
  if (invoiceFromEmail && !emailRe.test(invoiceFromEmail))
    throw new Error("Илгээгч и-мэйл хаяг буруу байна");
  if (invoiceReplyTo && !emailRe.test(invoiceReplyTo))
    throw new Error("Reply-to и-мэйл хаяг буруу байна");

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
    // undefined = хөндөхгүй (MCP хэсэгчилсэн update), null = цэвэрлэх.
    ...(data.invoiceFromEmail !== undefined && { invoiceFromEmail }),
    ...(data.invoiceReplyTo !== undefined && { invoiceReplyTo }),
    ...(data.emailDomainVerified !== undefined && {
      emailDomainVerified: data.emailDomainVerified,
    }),
    updatedAt: new Date(),
  };

  await db
    .insert(companySettings)
    .values({
      userId,
      organizationId: orgId,
      ...base,
      logo: data.logo ?? null,
      stamp: data.stamp ?? null,
    })
    .onConflictDoUpdate({
      target: companySettings.organizationId,
      set: {
        ...base,
        // undefined бол хуучин зургаа хадгална.
        ...(data.logo !== undefined && { logo: data.logo }),
        ...(data.stamp !== undefined && { stamp: data.stamp }),
      },
    });

  // Байгууллагын нэр/ТТД = компанийн нэр/регистр — нэг эх сурвалж.
  // (Switcher, жагсаалт, Удирдлага хуудас бүгд organizations-оос уншдаг.)
  if (base.name) {
    await db
      .update(organizations)
      .set({ name: base.name, registryNo: base.registerNo })
      .where(eq(organizations.id, orgId));
    // S1/S6 сегментийн утгын нэр нь компанийн нэрийг дагана — код хэвээр.
    try {
      await syncCompanySegmentValuesForGroup(orgId, userId);
    } catch (caught) {
      console.error("syncCompanySegmentValuesForGroup:", caught);
    }
  }

  revalidatePath("/settings/gl");
  revalidatePath("/settings/company");
  revalidatePath("/admin/org");
  revalidatePath("/", "layout");
}
