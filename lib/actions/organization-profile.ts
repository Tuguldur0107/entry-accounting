"use server";

// Компанийн мэдээлэл — нэхэмжлэх/хэвлэх маягтын толгой, тамга, гарын үсэг.
// Зургууд PNG, цэвэр base64-аар DB-д хадгалагдана (aiAttachments-тай ижил загвар).

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { resolveAiPostLimit } from "@/lib/ai/post-limit";
import { getActiveOrg, requireRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  organizationProfile,
  organizations,
  type CompanyBankAccount,
  type OrganizationProfile,
} from "@/lib/db/schema";
import { syncCompanySegmentValuesForGroup } from "@/lib/gl/segment-sync";
import { emitNotification } from "@/lib/notifications/emit";
import { syncQpayBankAccountsForOrg } from "@/lib/qpay/partner";
import { bankAccountsEqualForQpay } from "@/lib/qpay/provision";
import { actionError, type ActionResult } from "@/lib/action-result";


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

export async function getOrganizationProfile(): Promise<OrganizationProfile | null> {
  const { orgId } = await getActiveOrg();
  return (
    (await db.query.organizationProfile.findFirst({
      where: eq(organizationProfile.organizationId, orgId),
    })) ?? null
  );
}

export async function updateOrganizationProfile(data: {
  name: string;
  registerNo: string | null;
  vatPayerNo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** QPay мерчантын талбарууд (docs/deployment/qpay.md §2b) — undefined = хөндөхгүй. */
  mccCode?: string | null;
  cityCode?: string | null;
  districtCode?: string | null;
  bankAccounts: CompanyBankAccount[];
  /** undefined = хөндөхгүй, null = устгах, string = шинэ PNG base64. */
  logo?: string | null;
  stamp?: string | null;
  signatures: { name: string; title: string; image: string }[];
  autoStamp: boolean;
  /** Нэхэмжлэх илгээгч и-мэйл (verify хийгдсэн домэйн) — null бол env default. */
  invoiceFromEmail?: string | null;
  invoiceReplyTo?: string | null;
  emailDomainVerified?: boolean;
  /** «Том дүн» мэдэгдлийн босго (MNT); null = default 10 сая ₮ (D2). */
  largeAmountAlertMnt?: number | null;
  /** AI/MCP-ийн шууд батлах дээд хязгаар (MNT); null = default 10 сая ₮ (§9).
      Tool-оор өсгөх таазыг дуудагч (lib/ai/tools.ts) ӨМНӨӨ нь шалгана. */
  aiPostLimitMnt?: number | null;
  /** Хяналтын дансанд гар журнал: warn | block (SIM2-038). */
  controlAccountGuard?: "warn" | "block";
}): Promise<ActionResult<{ warning?: string }>> {
  try {
    return await updateOrganizationProfileCore(data);
  } catch (caught) {
    return actionError("updateOrganizationProfile", caught, "Тохиргоо хадгалагдсангүй");
  }
}

async function updateOrganizationProfileCore(data: {
  name: string;
  registerNo: string | null;
  vatPayerNo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  mccCode?: string | null;
  cityCode?: string | null;
  districtCode?: string | null;
  bankAccounts: CompanyBankAccount[];
  /** undefined = хөндөхгүй, null = устгах, string = шинэ PNG base64. */
  logo?: string | null;
  stamp?: string | null;
  signatures: { name: string; title: string; image: string }[];
  autoStamp: boolean;
  /** Нэхэмжлэх илгээгч и-мэйл (verify хийгдсэн домэйн) — null бол env default. */
  invoiceFromEmail?: string | null;
  invoiceReplyTo?: string | null;
  emailDomainVerified?: boolean;
  /** «Том дүн» мэдэгдлийн босго (MNT); null = default 10 сая ₮ (D2). */
  largeAmountAlertMnt?: number | null;
  /** AI/MCP-ийн шууд батлах дээд хязгаар (MNT); null = default 10 сая ₮ (§9).
      Tool-оор өсгөх таазыг дуудагч (lib/ai/tools.ts) ӨМНӨӨ нь шалгана. */
  aiPostLimitMnt?: number | null;
  controlAccountGuard?: "warn" | "block";
}): Promise<{ warning?: string }> {
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
  if (
    data.largeAmountAlertMnt != null &&
    (!Number.isFinite(data.largeAmountAlertMnt) || data.largeAmountAlertMnt <= 0)
  )
    throw new Error("Том дүнгийн босго 0-ээс их тоо байна");
  if (
    data.aiPostLimitMnt != null &&
    (!Number.isFinite(data.aiPostLimitMnt) || data.aiPostLimitMnt <= 0)
  )
    throw new Error("AI-ийн батлах хязгаар 0-ээс их тоо байна");

  const cleanCode = (value: string | null | undefined, re: RegExp, label: string) => {
    const code = (value ?? "").trim();
    if (code && !re.test(code)) throw new Error(`${label} буруу хэлбэртэй: ${code}`);
    return code || null;
  };
  const mccCode = cleanCode(data.mccCode, /^\d{4}$/, "Бизнесийн ангилал (MCC)");
  const cityCode = cleanCode(data.cityCode, /^\d{4,6}$/, "Хот/аймгийн код");
  const districtCode = cleanCode(data.districtCode, /^\d{4,6}$/, "Дүүрэг/сумын код");
  // Данс: хоосон дугаартай мөр хасагдана; «үндсэн» нэг л (QPay төлбөр орох).
  const bankAccounts: CompanyBankAccount[] = data.bankAccounts
    .filter((account) => (account.accountNo ?? "").trim())
    .map((account) => ({
      bankName: (account.bankName ?? "").trim(),
      accountNo: account.accountNo.trim(),
      accountName: (account.accountName ?? "").trim(),
      ...((account.bankCode ?? "").trim() ? { bankCode: account.bankCode!.trim() } : {}),
      ...((account.iban ?? "").trim() ? { iban: account.iban!.trim().toUpperCase() } : {}),
      ...(account.isDefault ? { isDefault: true } : {}),
    }));
  {
    let seen = false;
    for (const account of bankAccounts) {
      if (!account.isDefault) continue;
      if (seen) delete account.isDefault;
      seen = true;
    }
  }

  // ӨМНӨХ мөр: AI хязгаарын өөрчлөлтийн аудит + QPay данс sync хэрэгтэй эсэх.
  const previousRow = await db.query.organizationProfile.findFirst({
    where: eq(organizationProfile.organizationId, orgId),
    columns: { aiPostLimitMnt: true, bankAccounts: true },
  });
  const previousLimit =
    data.aiPostLimitMnt === undefined ? null : resolveAiPostLimit(previousRow?.aiPostLimitMnt);

  const base = {
    name: data.name.trim(),
    registerNo: data.registerNo?.trim() || null,
    vatPayerNo: data.vatPayerNo?.trim() || null,
    address: data.address?.trim() || null,
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    ...(data.mccCode !== undefined && { mccCode }),
    ...(data.cityCode !== undefined && { cityCode }),
    ...(data.districtCode !== undefined && { districtCode }),
    bankAccounts,
    signatures: data.signatures,
    autoStamp: data.autoStamp,
    // undefined = хөндөхгүй (MCP хэсэгчилсэн update), null = цэвэрлэх.
    ...(data.invoiceFromEmail !== undefined && { invoiceFromEmail }),
    ...(data.invoiceReplyTo !== undefined && { invoiceReplyTo }),
    ...(data.emailDomainVerified !== undefined && {
      emailDomainVerified: data.emailDomainVerified,
    }),
    ...(data.largeAmountAlertMnt !== undefined && {
      largeAmountAlertMnt:
        data.largeAmountAlertMnt == null ? null : String(Math.round(data.largeAmountAlertMnt)),
    }),
    ...(data.aiPostLimitMnt !== undefined && {
      aiPostLimitMnt:
        data.aiPostLimitMnt == null ? null : String(Math.round(data.aiPostLimitMnt)),
    }),
    ...(data.controlAccountGuard !== undefined && {
      controlAccountGuard: data.controlAccountGuard === "block" ? "block" : "warn",
    }),
    updatedAt: new Date(),
  };

  await db
    .insert(organizationProfile)
    .values({
      userId,
      organizationId: orgId,
      ...base,
      logo: data.logo ?? null,
      stamp: data.stamp ?? null,
    })
    .onConflictDoUpdate({
      target: organizationProfile.organizationId,
      set: {
        ...base,
        // undefined бол хуучин зургаа хадгална.
        ...(data.logo !== undefined && { logo: data.logo }),
        ...(data.stamp !== undefined && { stamp: data.stamp }),
      },
    });

  // AI-ийн батлах хязгаар өөрчлөгдвөл — аудит + эзэн/админд мэдэгдэл.
  // Actor-ыг ХАСАХГҮЙ (§9d-ийн ХОЁР ДАХЬ үл хамаарах): энэ нь аюулгүй
  // байдлын хяналт тул өөрчилсөн хүнд өөрт нь ч баталгаа очих ёстой —
  // AI/MCP-ээр өөрчлөгдсөн үед token-ий эзэн тэр даруй харна.
  if (previousLimit !== null) {
    const nextLimit = resolveAiPostLimit(data.aiPostLimitMnt ?? null);
    if (nextLimit !== previousLimit) {
      const summary = `AI батлах хязгаар: ${previousLimit.toLocaleString("en-US")}₮ → ${nextLimit.toLocaleString("en-US")}₮`;
      await logAuditEvent({
        userId,
        organizationId: orgId,
        action: "ai_post_limit",
        entityType: "settings",
        entityId: orgId,
        summary,
      });
      await emitNotification(orgId, {
        type: "settings.ai_limit_changed",
        title:
          nextLimit > previousLimit
            ? "AI-ийн батлах хязгаар ӨСЛӨӨ"
            : "AI-ийн батлах хязгаар буурлаа",
        body: `${summary}. Энэ дүн хүртэлх бичилт «Шууд бичих» горимд нягтланчийн баталгаажуулалтгүй батлагдана.`,
        href: "/settings/company",
        entityType: "settings",
        entityId: orgId,
        dedupeKey: `ai-post-limit:${orgId}:${new Date().toISOString().slice(0, 16)}`,
        severity: "warning",
        audience: { kind: "roles", roles: ["owner", "admin"] },
        payload: { previousMnt: previousLimit, nextMnt: nextLimit },
      });
    }
  }

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

  // QPay мерчантын данс — Partner API-аар бүртгэгдсэн байгууллагад данс
  // өөрчлөгдвөл dashboard руу sync (best effort: алдаа = анхааруулга, хадгалалт
  // унахгүй; docs/deployment/qpay.md §2b).
  let warning: string | undefined;
  if (!bankAccountsEqualForQpay(previousRow?.bankAccounts ?? [], bankAccounts)) {
    const sync = await syncQpayBankAccountsForOrg(orgId, userId, bankAccounts);
    if (sync && "warning" in sync) warning = sync.warning;
  }

  revalidatePath("/settings/gl");
  revalidatePath("/settings/company");
  revalidatePath("/admin/org");
  revalidatePath("/", "layout");
  return warning ? { warning } : {};
}
