// eTax-ийн view төрлүүд — client-safe (DB импортгүй). Нууцын УТГА энд ХЭЗЭЭ Ч орохгүй.

import type { ItcEnvironment } from "../constants";
import type { EtaxFormCell, EtaxSheetMapping, EtaxSheetTemplate } from "./api";
import type { EtaxFormKey, EtaxSubmissionStatus, EtaxVatField } from "./constants";
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
  /** ТЕГ-ийн татвар төлөгчийн бүртгэлийн дугаар (`getUserOrgs`) — null бол «Байгууллага татах». */
  entId: number | null;
  entName: string | null;
  entTin: string | null;
  branchName: string | null;
  lastOrgSyncAt: string | null;
  /** Серверт NE-KEY (операторын) тохируулагдсан эсэх — үгүй бол API дуудлага боломжгүй. */
  apiReady: boolean;
}

/** Маягтын нүдний холболт (etax_form_mappings) — client-safe. */
export interface EtaxMappingView {
  form: EtaxFormKey;
  formNo: number;
  taxTypeId: number;
  taxTypeName: string | null;
  reportCode: string | null;
  templateVersion: number | null;
  cells: Partial<Record<EtaxVatField, string | null>>;
  /** Сүүлд татсан загварын нүднүүд (сонголтод). */
  templateCells: EtaxFormCell[];
  templateFetchedAt: string | null;
  /** Холболтын дутуу/зөрүү — хоосон бол ТЕГ-д хадгалахад бэлэн. */
  problems: string[];
  /** Хавсралт мэдээ: ТЕГ-ээс татсан загварууд (reportNo-той тайлангаар) ба холболт. */
  sheetTemplates: EtaxSheetTemplate[];
  sheets: EtaxSheetMapping[];
  sheetTemplatesFetchedAt: string | null;
  /** Эхтэй мэдээний холболтын дутуу — хоосон бол мэдээ хадгалахад бэлэн. */
  sheetProblems: string[];
}

/** ТЕГ-ийн тушаах жагсаалтын товч мөр (татварын төрөл сонгоход). */
export interface EtaxReportChoice {
  taxTypeId: number;
  taxTypeName: string;
  formNo: number;
  taxReportCode: string;
  periodName: string;
  returnDueDate: string;
  statusName: string;
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
  /** eTax API reportNo (ТЕГ-д хадгалсанаас хойш). */
  reportNo: number | null;
  taxStatusId: number | null;
  taxStatusName: string | null;
  taxSyncedAt: string | null;
  /** Хавсралт мэдээ ТЕГ-д хадгалсан мөч, мэдээ бүрийн мөрийн тоо. */
  sheetsSavedAt: string | null;
  sheetsSummary: Record<string, number> | null;
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
  /** Маягтын нүдний холболт — null бол тохируулаагүй (API-аар хадгалах боломжгүй). */
  mapping: EtaxMappingView | null;
}
