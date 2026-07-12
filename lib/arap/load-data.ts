import { and, desc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { db } from "@/lib/db";
import {
  arApDocuments,
  chartOfAccounts,
  counterparties,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import type { ArApDocumentView, CounterpartyView } from "@/lib/arap/types";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

function moduleEnabled(modules: string | null | undefined) {
  const values = (modules ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) return true;
  return values.includes("ar") || values.includes("ap") || values.includes("gl");
}

function pickDefaultAccount(
  accounts: Array<{ number: string; name: string; modules: string }>,
  exact: string[],
  nameIncludes: string[]
) {
  const enabled = accounts.filter((account) => moduleEnabled(account.modules));
  const exactMatch = exact
    .map((number) => enabled.find((account) => account.number === number))
    .find(Boolean);
  if (exactMatch) return exactMatch.number;

  const nameMatch = enabled.find((account) =>
    nameIncludes.some((needle) => account.name.toLowerCase().includes(needle))
  );
  return nameMatch?.number ?? "";
}

export async function loadArApWorkspaceData() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  const userId = session.user.id;

  const [counterpartyRows, documentRows, accounts, configs, values] =
    await Promise.all([
      db.query.counterparties.findMany({
        where: eq(counterparties.userId, userId),
        orderBy: (item, { asc }) => [asc(item.name)],
      }),
      db.query.arApDocuments.findMany({
        where: eq(arApDocuments.userId, userId),
        with: { counterparty: true },
        orderBy: [desc(arApDocuments.date), desc(arApDocuments.createdAt)],
      }),
      db.query.chartOfAccounts.findMany({
        where: and(
          eq(chartOfAccounts.userId, userId),
          eq(chartOfAccounts.isEnabled, true)
        ),
        orderBy: (account, { asc }) => [asc(account.number)],
      }),
      db.query.segmentConfigs.findMany({
        where: eq(segmentConfigs.userId, userId),
      }),
      db.query.segmentValues.findMany({
        where: and(
          eq(segmentValues.userId, userId),
          eq(segmentValues.isEnabled, true)
        ),
        orderBy: (value, { asc }) => [asc(value.segmentId), asc(value.code)],
      }),
    ]);

  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter((definition) => {
    if (definition.id === 3) return true;
    const config = configMap.get(definition.id);
    return config?.isEnabled === true && moduleEnabled(config.modules);
  }).map((definition) => definition.id);

  const segmentOptions: Record<number, SegOption[]> = {};
  for (const id of activeSegIds) {
    segmentOptions[id] =
      id === 3
        ? accounts
            .filter((account) => moduleEnabled(account.modules))
            .map((account) => ({ code: account.number, name: account.name }))
        : values
            .filter((value) => value.segmentId === id && moduleEnabled(value.modules))
            .map((value) => ({ code: value.code, name: value.name }));
  }

  const defaultSegments: Record<number, string> = {};
  for (const id of activeSegIds) {
    const options = segmentOptions[id] ?? [];
    if (options.length === 1) defaultSegments[id] = options[0].code;
  }

  const defaultAccountNumbers = {
    receivable: pickDefaultAccount(
      accounts,
      ["13110000", "12000001", "12000003", "13100000"],
      ["авлага"]
    ),
    payable: pickDefaultAccount(
      accounts,
      ["31000001", "31110000", "31000099", "33100000"],
      ["өглөг"]
    ),
  };

  const counterpartiesView: CounterpartyView[] = counterpartyRows.map((item) => ({
    id: item.id,
    name: item.name,
    counterpartyType: item.counterpartyType,
    registerNo: item.registerNo,
    defaultReceivableAccountNumber: item.defaultReceivableAccountNumber,
    defaultPayableAccountNumber: item.defaultPayableAccountNumber,
    defaultCurrency: item.defaultCurrency,
    paymentTermsDays: item.paymentTermsDays,
    isActive: item.isActive,
  }));

  const documentsView: ArApDocumentView[] = documentRows.map((item) => ({
    id: item.id,
    documentNo: item.documentNo,
    documentType: item.documentType as ArApDocumentView["documentType"],
    counterpartyId: item.counterpartyId,
    counterpartyName: item.counterparty.name,
    date: item.date,
    dueDate: item.dueDate,
    currency: item.currency,
    exchangeRate: Number(item.exchangeRate),
    controlAccountNumber: item.controlAccountNumber,
    description: item.description,
    totalAmount: Number(item.totalAmount),
    paidAmount: Number(item.paidAmount),
    balance: Number(item.totalAmount) - Number(item.paidAmount),
    baseTotalAmount: Number(item.baseTotalAmount),
    basePaidAmount: Number(item.basePaidAmount),
    baseBalance: Number(item.baseTotalAmount) - Number(item.basePaidAmount),
    status: item.status,
    voucherId: item.voucherId,
  }));

  return {
    counterparties: counterpartiesView,
    documents: documentsView,
    activeSegIds,
    segmentOptions,
    defaultSegments,
    defaultAccountNumbers,
  };
}
