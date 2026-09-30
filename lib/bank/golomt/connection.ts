// Голомтын холболтын DB давхарга — тохиргоо унших/хадгалах, нууц тайлах,
// хуулга татаж импортын хэлбэрт оруулах. Эрхийн шалгалт action-д
// (lib/actions/bank-api.ts); энд зөвхөн orgId-оор scope.

import { and, eq } from "drizzle-orm";

import { decryptSecret } from "@/lib/ai/crypto";
import { db } from "@/lib/db";
import { bankApiConnections } from "@/lib/db/schema";
import { loadImportedExternalRefs } from "@/lib/cash/statement-external-refs";

import { GolomtClient, type GolomtCredentials } from "./client";
import {
  isGolomtEnvironment,
  type GolomtConnectionView,
} from "./constants";
import { golomtStatementToParsed, type GolomtStatementResult } from "./statement";

export const GOLOMT_BANK_KEY = "golomt";

export async function loadGolomtConnectionRow(orgId: string) {
  return db.query.bankApiConnections.findFirst({
    where: and(
      eq(bankApiConnections.organizationId, orgId),
      eq(bankApiConnections.bank, GOLOMT_BANK_KEY)
    ),
  });
}

type ConnectionRow = NonNullable<Awaited<ReturnType<typeof loadGolomtConnectionRow>>>;

export function toGolomtConnectionView(row: ConnectionRow): GolomtConnectionView {
  return {
    environment: isGolomtEnvironment(row.environment) ? row.environment : "uat",
    username: row.username,
    clientId: row.clientId ?? "",
    registerNo: row.registerNo,
    isEnabled: row.isEnabled,
    hasSecrets: Boolean(row.passwordEnc && row.sessionKeyEnc && row.ivKeyEnc),
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    lastCheckError: row.lastCheckError,
  };
}

/** Нууцыг тайлна; AUTH_SECRET солигдсон г.м. тайлагдахгүй бол ил алдаа. */
export function golomtCredentialsFromRow(row: ConnectionRow): GolomtCredentials {
  const password = decryptSecret(row.passwordEnc);
  const sessionKey = decryptSecret(row.sessionKeyEnc);
  const ivKey = decryptSecret(row.ivKeyEnc);
  if (!password || !sessionKey || !ivKey)
    throw new Error(
      "Голомтын нууц мэдээллийг тайлж чадсангүй — холболтын тохиргоонд нууц үг, түлхүүрээ дахин оруулна уу"
    );
  if (!isGolomtEnvironment(row.environment))
    throw new Error("Голомтын холболтын орчин буруу");
  return {
    environment: row.environment,
    username: row.username,
    password,
    sessionKey,
    ivKey,
    clientId: row.clientId,
    registerNo: row.registerNo,
  };
}

/** Шалгалт/татлагын үр дүнг тэмдэглэнэ (алдаа нь нууцгүй текст). */
export async function recordGolomtCheck(
  connectionId: string,
  error: string | null
) {
  await db
    .update(bankApiConnections)
    .set({ lastCheckedAt: new Date(), lastCheckError: error })
    .where(eq(bankApiConnections.id, connectionId));
}

export async function fetchGolomtStatementForOrg(input: {
  orgId: string;
  row: ConnectionRow;
  accountId: string;
  currency: string;
  startDate: string;
  endDate: string;
}): Promise<GolomtStatementResult> {
  const client = new GolomtClient(golomtCredentialsFromRow(input.row));
  const entries = await client.fetchStatement(
    input.accountId,
    input.startDate,
    input.endDate
  );
  // Эхлээд бүх мөрийн түлхүүрийг бодоод, өмнө хадгалагдсаныг DB-ээс нэг
  // дор шалгана — дараа нь алгасна.
  const draft = golomtStatementToParsed({
    accountId: input.accountId,
    currency: input.currency,
    startDate: input.startDate,
    endDate: input.endDate,
    entries,
  });
  const refs = draft.statement.rows
    .map((row) => row.externalRef)
    .filter((ref): ref is string => !!ref);
  const alreadyImported = await loadImportedExternalRefs(input.orgId, refs);
  if (alreadyImported.size === 0) return draft;
  return golomtStatementToParsed({
    accountId: input.accountId,
    currency: input.currency,
    startDate: input.startDate,
    endDate: input.endDate,
    entries,
    alreadyImported,
  });
}
