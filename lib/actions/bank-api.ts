"use server";

// Банкны API холболт (Фаз 1 — Голомт OBI, ЗӨВХӨН унших) — docs/dev/bank-api.md.
// Тохиргоо хадгалах/шалгах/устгах нь admin+, хуулга татах нь кассын write эрх.
// Татсан хуулга ШУУД GL-д бичигдэхгүй: файлын импорттой ижил хянах → данс
// оноох → «Хадгалах» (saveBankStatement) урсгалаар явна. Бүгд ActionResult.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { encryptSecret } from "@/lib/ai/crypto";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction, requireRole } from "@/lib/auth";
import { GolomtApiError, GolomtClient } from "@/lib/bank/golomt/client";
import {
  GOLOMT_BANK_KEY,
  fetchGolomtStatementForOrg,
  golomtCredentialsFromRow,
  loadGolomtConnectionRow,
  recordGolomtCheck,
  toGolomtConnectionView,
} from "@/lib/bank/golomt/connection";
import {
  golomtAccountId,
  golomtStatementRangeError,
  isGolomtCashAccount,
  isGolomtEnvironment,
  type GolomtAccountCheck,
  type GolomtConnectionView,
  type GolomtEnvironment,
} from "@/lib/bank/golomt/constants";
import type { ParsedBankStatement } from "@/lib/cash/bank-statement-types";
import { db } from "@/lib/db";
import {
  bankApiConnections,
  cashAccounts,
  organizationProfile,
} from "@/lib/db/schema";
import { ulaanbaatarToday } from "@/lib/periods/document-date";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Тодорхойгүй алдаа";
}

/** Холболтын тохиргоо (нууц утгагүй). Тохируулаагүй бол null. */
export async function getGolomtConnection(): Promise<
  ActionResult<{ connection: GolomtConnectionView | null; defaultRegisterNo: string }>
> {
  try {
    const { orgId } = await requireModuleAction("cash", "read");
    const [row, profile] = await Promise.all([
      loadGolomtConnectionRow(orgId),
      db.query.organizationProfile.findFirst({
        where: eq(organizationProfile.organizationId, orgId),
        columns: { registerNo: true },
      }),
    ]);
    return {
      connection: row ? toGolomtConnectionView(row) : null,
      defaultRegisterNo: profile?.registerNo ?? "",
    };
  } catch (caught) {
    return actionError("getGolomtConnection", caught, "Голомтын холболтыг уншиж чадсангүй");
  }
}

/**
 * Хадгалах — нууц үг / session key / IV key ХООСОН бол хуучнаа хөндөхгүй
 * (write-only талбар), шинэ утга бол шифрлэж бичнэ. Анх үүсгэхэд гурвуулаа заавал.
 */
export async function saveGolomtConnection(input: {
  environment: GolomtEnvironment;
  username: string;
  password?: string | null;
  sessionKey?: string | null;
  ivKey?: string | null;
  clientId?: string | null;
  registerNo: string;
  isEnabled: boolean;
}): Promise<ActionResult<{ connection: GolomtConnectionView }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    if (!isGolomtEnvironment(input.environment)) throw new Error("Орчноо сонгоно уу");
    const username = cleanText(input.username);
    if (!username) throw new Error("Нэвтрэх нэрээ оруулна уу");
    const registerNo = cleanText(input.registerNo).toUpperCase();
    if (!/^[0-9A-ZА-ЯӨҮЁ]{7,14}$/u.test(registerNo))
      throw new Error("Байгууллагын регистрийн дугаараа зөв оруулна уу");
    const password = cleanText(input.password);
    const sessionKey = cleanText(input.sessionKey);
    const ivKey = cleanText(input.ivKey);
    if (sessionKey && ![16, 24, 32].includes(Buffer.byteLength(sessionKey, "utf8")))
      throw new Error("Session key 16, 24 эсвэл 32 тэмдэгт байх ёстой");
    if (ivKey && Buffer.byteLength(ivKey, "utf8") !== 16)
      throw new Error("IV key 16 тэмдэгт байх ёстой");

    const existing = await loadGolomtConnectionRow(orgId);
    if (!existing && (!password || !sessionKey || !ivKey))
      throw new Error("Анх холбоход нууц үг, session key, IV key гурвуулаа заавал");

    const patch = {
      environment: input.environment,
      username,
      clientId: cleanText(input.clientId) || null,
      registerNo,
      isEnabled: !!input.isEnabled,
      userId,
      updatedAt: new Date(),
      ...(password ? { passwordEnc: encryptSecret(password) } : {}),
      ...(sessionKey ? { sessionKeyEnc: encryptSecret(sessionKey) } : {}),
      ...(ivKey ? { ivKeyEnc: encryptSecret(ivKey) } : {}),
      // Тохиргоо өөрчлөгдсөн — өмнөх шалгалтын үр дүн хүчингүй.
      lastCheckedAt: null,
      lastCheckError: null,
    };

    let id: string;
    if (existing) {
      await db
        .update(bankApiConnections)
        .set(patch)
        .where(eq(bankApiConnections.id, existing.id));
      id = existing.id;
    } else {
      const [created] = await db
        .insert(bankApiConnections)
        .values({
          ...patch,
          organizationId: orgId,
          bank: GOLOMT_BANK_KEY,
          passwordEnc: encryptSecret(password),
          sessionKeyEnc: encryptSecret(sessionKey),
          ivKeyEnc: encryptSecret(ivKey),
        })
        .returning({ id: bankApiConnections.id });
      id = created.id;
    }

    // Нууцын УТГА хэзээ ч аудитад орохгүй — зөвхөн аль талбар шинэчлэгдсэн.
    const changedSecrets = [
      password && "нууц үг",
      sessionKey && "session key",
      ivKey && "IV key",
    ].filter(Boolean);
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: existing ? "update" : "create",
      entityType: "bank_api_connection",
      entityId: id,
      summary: `Голомт банкны API холболт ${existing ? "шинэчлэгдэв" : "үүсгэгдэв"} — ${input.environment}, ${input.isEnabled ? "идэвхтэй" : "идэвхгүй"}${changedSecrets.length ? `; шинэ: ${changedSecrets.join(", ")}` : ""}`,
    });

    revalidatePath("/cash/statements");
    const saved = await loadGolomtConnectionRow(orgId);
    if (!saved) throw new Error("Голомтын холболт хадгалагдсангүй");
    return { connection: toGolomtConnectionView(saved) };
  } catch (caught) {
    return actionError("saveGolomtConnection", caught, "Голомтын холболт хадгалагдсангүй");
  }
}

/**
 * Холболт шалгах — нэвтэрч, кассын Голомтын данс бүрийг дугаараар нь
 * OPERACCTDET + ACCTBALINQ-ээр шалгана (ACCTLST Entry-ийн эрхэд нээгдээгүй —
 * docs/dev/bank-api.md §3). Нэвтрэлт унавал бүхэлдээ алдаа; данс тус бүрийн
 * алдаа тухайн мөрөнд, сүүлийн шалгалтын төлөвт эхний алдаа нь бичигдэнэ.
 */
export async function testGolomtConnection(): Promise<
  ActionResult<{ accounts: GolomtAccountCheck[]; connection: GolomtConnectionView }>
> {
  let connectionId: string | null = null;
  try {
    const { orgId } = await requireRole("admin");
    const row = await loadGolomtConnectionRow(orgId);
    if (!row) throw new Error("Эхлээд Голомтын холболтоо хадгална уу");
    connectionId = row.id;
    const client = new GolomtClient(golomtCredentialsFromRow(row));
    await client.login();

    const cashRows = await db.query.cashAccounts.findMany({
      where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
    });
    const accounts: GolomtAccountCheck[] = [];
    // Дараалан — банкны нэг session-оор, зэрэгцээ ачаалал үүсгэхгүй.
    for (const account of cashRows.filter((item) => isGolomtCashAccount(item))) {
      const accountId = golomtAccountId(account.accountNumber) ?? "";
      const check: GolomtAccountCheck = {
        cashAccountName: account.name,
        accountId,
        cashCurrency: account.currency.toUpperCase(),
        ok: false,
        accountName: "",
        currency: "",
        status: "",
        availableBalance: null,
        error: null,
      };
      try {
        const details = await client.accountDetails(accountId);
        check.accountName = details.accountName;
        check.currency = details.currency;
        check.status = details.status;
        check.availableBalance = await client.availableBalance(accountId);
        check.ok = true;
      } catch (caught) {
        // Банкны алдаа (эрхгүй, регистр зөрсөн г.м.) тухайн дансанд; бусад нь шидэгдэнэ.
        if (!(caught instanceof GolomtApiError)) throw caught;
        check.error = caught.message;
      }
      accounts.push(check);
    }
    const firstError = accounts.find((item) => item.error);
    await recordGolomtCheck(
      row.id,
      firstError ? `${firstError.cashAccountName}: ${firstError.error}` : null
    );
    revalidatePath("/cash/statements");
    // Шалгалтын шинэ төлөвийг (огноо, алдаа) цонхонд шууд харуулна.
    const checked = await loadGolomtConnectionRow(orgId);
    return { accounts, connection: toGolomtConnectionView(checked ?? row) };
  } catch (caught) {
    if (connectionId) await recordGolomtCheck(connectionId, errorText(caught)).catch(() => {});
    return actionError("testGolomtConnection", caught, "Голомт банктай холбогдож чадсангүй");
  }
}

export async function deleteGolomtConnection(): Promise<ActionResult<{ ok: true }>> {
  try {
    const { orgId, userId } = await requireRole("admin");
    const row = await loadGolomtConnectionRow(orgId);
    if (!row) return { ok: true };
    await db.delete(bankApiConnections).where(eq(bankApiConnections.id, row.id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "delete",
      entityType: "bank_api_connection",
      entityId: row.id,
      summary: "Голомт банкны API холболт устгагдав (нууц мэдээлэл хамт устсан)",
    });
    revalidatePath("/cash/statements");
    return { ok: true };
  } catch (caught) {
    return actionError("deleteGolomtConnection", caught, "Голомтын холболт устгагдсангүй");
  }
}

/**
 * Голомтоос хуулга татах — өмнө импортлогдсон гүйлгээг (externalRef) алгасаж,
 * файлын импорттой ИЖИЛ хэлбэрээр буцаана. GL-д юу ч бичихгүй.
 */
export async function fetchGolomtStatement(input: {
  cashAccountId: string;
  startDate: string;
  endDate: string;
}): Promise<ActionResult<{ statement: ParsedBankStatement; skipped: number }>> {
  let connectionId: string | null = null;
  try {
    const { orgId, userId } = await requireModuleAction("cash", "write");
    const rangeError = golomtStatementRangeError(
      cleanText(input.startDate),
      cleanText(input.endDate),
      ulaanbaatarToday()
    );
    if (rangeError) throw new Error(rangeError);

    const [row, cashAccount] = await Promise.all([
      loadGolomtConnectionRow(orgId),
      db.query.cashAccounts.findFirst({
        where: and(
          eq(cashAccounts.id, cleanText(input.cashAccountId)),
          eq(cashAccounts.organizationId, orgId),
          eq(cashAccounts.isActive, true)
        ),
      }),
    ]);
    if (!row) throw new Error("Голомтын API холболт тохируулаагүй байна");
    if (!row.isEnabled) throw new Error("Голомтын API холболт идэвхгүй байна");
    if (!cashAccount) throw new Error("Идэвхтэй банкны данс олдсонгүй");
    const accountId = golomtAccountId(cashAccount.accountNumber);
    if (!isGolomtCashAccount(cashAccount) || !accountId)
      throw new Error(
        "Сонгосон данс Голомтын данс биш эсвэл дансны дугааргүй байна — Мөнгөн хөрөнгө → Данс хэсэгт банк, дансны дугаараа бөглөнө үү"
      );
    connectionId = row.id;

    const result = await fetchGolomtStatementForOrg({
      orgId,
      row,
      accountId,
      currency: cashAccount.currency,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    await recordGolomtCheck(row.id, null);
    // Холболт амжилттай — хоосон үр дүн нь холболтын алдаа биш (тэмдэглэхгүй).
    if (result.statement.rows.length === 0)
      return {
        error:
          result.skipped > 0
            ? `Шинэ гүйлгээ алга — энэ хугацааны ${result.skipped} гүйлгээ өмнө нь импортлогдсон`
            : "Энэ хугацаанд гүйлгээ алга",
      };

    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "fetch",
      entityType: "bank_api_connection",
      entityId: row.id,
      summary: `Голомтоос хуулга татав — ${cashAccount.name}, ${input.startDate}–${input.endDate}, ${result.statement.rows.length} шинэ мөр${result.skipped ? `, ${result.skipped} давхар алгасав` : ""}`,
    });
    return result;
  } catch (caught) {
    if (connectionId) await recordGolomtCheck(connectionId, errorText(caught)).catch(() => {});
    return actionError("fetchGolomtStatement", caught, "Голомтоос хуулга татаж чадсангүй");
  }
}
