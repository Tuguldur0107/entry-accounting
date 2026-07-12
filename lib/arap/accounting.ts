import type { ArApDocumentType } from "@/lib/arap/types";

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateBaseAmount(amount: number, exchangeRate: number) {
  return roundMoney(amount * exchangeRate);
}

export function calculateSettlementExchangeEffect({
  documentType,
  amount,
  documentExchangeRate,
  paymentBaseAmount,
}: {
  documentType: ArApDocumentType;
  amount: number;
  documentExchangeRate: number;
  paymentBaseAmount: number;
}) {
  const historicalBaseAmount = calculateBaseAmount(amount, documentExchangeRate);
  const difference = roundMoney(paymentBaseAmount - historicalBaseAmount);
  const isGain =
    documentType === "ar_invoice" ? difference > 0 : difference < 0;

  return {
    historicalBaseAmount,
    difference,
    isGain: Math.abs(difference) <= 0.01 ? null : isGain,
  };
}
