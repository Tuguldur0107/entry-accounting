// eTax-ийн view төрлүүд — client-safe (DB импортгүй). Нууцын УТГА энд ХЭЗЭЭ Ч орохгүй.

import type { ItcEnvironment } from "../constants";
import type { EtaxFormKey, EtaxSubmissionStatus } from "./constants";
import type { EtaxValidation, EtaxVatSnapshot } from "./submission";

export interface EtaxConnectionView {
  environment: ItcEnvironment;
  username: string;
  hasPassword: boolean;
  isEnabled: boolean;
  lastCheckAt: string | null;
  lastCheckOkAt: string | null;
  lastCheckError: string | null;
  /** eTax вэбийн хаяг (гараар тушаах) — staging-д null. */
  webUrl: string | null;
}

export interface EtaxSubmissionView {
  id: string;
  form: EtaxFormKey;
  formCode: string;
  periodCode: string;
  status: EtaxSubmissionStatus;
  environment: ItcEnvironment;
  snapshot: EtaxVatSnapshot;
  validation: EtaxValidation | null;
  taxReference: string | null;
  submittedAt: string | null;
  resultNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EtaxPageData {
  periodCode: string;
  connection: EtaxConnectionView | null;
  /** Энэ тайлант үеийн амьд илгээлт (draft/ready/submitted/accepted) — байхгүй бол null. */
  current: EtaxSubmissionView | null;
  /** Одоогийн бодолт нь хадгалсан ноорогоос зөрж буй эсэх (дахин бэлтгэх хэрэгтэй). */
  stale: boolean;
  /** Сүүлийн илгээлтүүд (бүх үе, шинэ нь эхэнд). */
  history: EtaxSubmissionView[];
  isVatPayer: boolean;
  /** Одоогийн бодолтын товч — ноорог байхгүй үед ч харуулна. */
  live: { outputVat: number; inputVat: number; carriedInVat: number; payableVat: number; refundableVat: number; deadline: string };
}
