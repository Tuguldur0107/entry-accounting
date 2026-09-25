"use client";

// Компанийн мэдээллийн форм — нэхэмжлэх/маягтын толгойн реквизит,
// лого/тамга/гарын үсгийн PNG зураг, autoStamp тохиргоо.

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { updateOrganizationProfile } from "@/lib/actions/organization-profile";
import { getQpayDistricts } from "@/lib/actions/qpay";
import type { CompanyBankAccount, OrganizationProfile } from "@/lib/db/schema";
import {
  QPAY_BANK_CODES,
  QPAY_CITY_CODES,
  QPAY_MCC_CODES,
  QPAY_UB_CITY_CODE,
  QPAY_UB_DISTRICT_CODES,
  guessQpayBankCode,
  type QpayReferenceOption,
} from "@/lib/qpay/reference";
import { toast } from "sonner";

type BankAccount = CompanyBankAccount;
const toOptions = (rows: readonly QpayReferenceOption[]) =>
  rows.map((r) => ({ value: r.code, label: r.name }));
const MCC_OPTIONS = toOptions(QPAY_MCC_CODES);
const CITY_OPTIONS = toOptions(QPAY_CITY_CODES);
const BANK_OPTIONS = toOptions(QPAY_BANK_CODES);
type Signature = { name: string; title: string; image: string };

/** File → цэвэр base64 (data URL-ийн толгойгүй). */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function PngPicker({
  label,
  hint,
  value,
  onChange,
  height = 72,
}: {
  label: string;
  hint?: string;
  /** null = байхгүй, string = base64 PNG. */
  value: string | null;
  onChange: (next: string | null) => void;
  height?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {hint && (
        <p className="text-[11px]" style={{ color: "var(--ea-text-4)" }}>
          {hint}
        </p>
      )}
      <div className="flex items-center gap-3">
        {value ? (
          <div
            className="relative flex items-center justify-center rounded-md border border-[var(--ea-border)] bg-white px-3 py-2"
            style={{ minWidth: 96 }}
          >
            {/* PNG урьдчилан харах — тамга/гарын үсэг цагаан цаасан дээр
                харагдах тул дэвсгэрийг зориуд цагаанаар */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${value}`}
              alt={label}
              style={{ maxHeight: height, maxWidth: 220 }}
            />
          </div>
        ) : (
          <div
            className="flex items-center justify-center rounded-md border border-dashed border-[var(--ea-border-strong)] px-4 text-xs"
            style={{ height, minWidth: 96, color: "var(--ea-text-4)" }}
          >
            Зураг алга
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="cursor-pointer">
            <span className="ea-interactive inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ea-border-strong)] px-3 text-xs font-medium text-[var(--ea-text-2)]">
              <Icon name="upload" size="sm" />
              PNG сонгох
            </span>
            <input
              type="file"
              accept="image/png"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.type !== "image/png") {
                  toast.error("Зөвхөн PNG формат дэмжинэ");
                  return;
                }
                if (file.size > 1_000_000) {
                  toast.error("Зураг 1MB-аас бага байх ёстой");
                  return;
                }
                onChange(await fileToBase64(file));
              }}
            />
          </label>
          {value && (
            <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
              Устгах
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function OrganizationProfileForm({
  initial,
}: {
  initial: OrganizationProfile | null;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [registerNo, setRegisterNo] = useState(initial?.registerNo ?? "");
  const [vatPayerNo, setVatPayerNo] = useState(initial?.vatPayerNo ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  // QPay мерчантын бүртгэлд (docs/deployment/qpay.md §2b) — код ЗОХИОХГҮЙ, сонгоно.
  const [mccCode, setMccCode] = useState(initial?.mccCode ?? "");
  const [cityCode, setCityCode] = useState(initial?.cityCode ?? "");
  const [districtCode, setDistrictCode] = useState(initial?.districtCode ?? "");
  // Аймгийн сумд dashboard-аас (QPay лавлах); УБ статик. Аль хотынх болохыг
  // хамт хадгалснаар хот солигдоход хуучин жагсаалт харагдахгүй (setState
  // зөвхөн fetch-ийн callback-д — effect-ийн биед биш).
  const [fetchedDistricts, setFetchedDistricts] = useState<{ city: string; list: QpayReferenceOption[] }>({
    city: "",
    list: [],
  });
  useEffect(() => {
    if (!cityCode || cityCode === QPAY_UB_CITY_CODE) return;
    let alive = true;
    getQpayDistricts({ cityCode }).then((result) => {
      if (alive) setFetchedDistricts({ city: cityCode, list: result.districts ?? [] });
    });
    return () => {
      alive = false;
    };
  }, [cityCode]);
  const districtOptions =
    !cityCode || cityCode === QPAY_UB_CITY_CODE
      ? toOptions(QPAY_UB_DISTRICT_CODES)
      : fetchedDistricts.city === cityCode
        ? toOptions(fetchedDistricts.list)
        : [];
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>(
    // Хоосон бол мөр рендерлэхгүй — placeholder-оор дүүрсэн мөр бодит данс
    // мэт харагддаг байв (ENT-008). «Данс нэмэх»-ээр нэмнэ.
    initial?.bankAccounts?.length ? initial.bankAccounts : []
  );
  const [logo, setLogo] = useState<string | null>(initial?.logo ?? null);
  const [stamp, setStamp] = useState<string | null>(initial?.stamp ?? null);
  const [signatures, setSignatures] = useState<Signature[]>(
    initial?.signatures ?? []
  );
  const [autoStamp, setAutoStamp] = useState(initial?.autoStamp ?? true);
  const [invoiceFromEmail, setInvoiceFromEmail] = useState(
    initial?.invoiceFromEmail ?? ""
  );
  const [invoiceReplyTo, setInvoiceReplyTo] = useState(
    initial?.invoiceReplyTo ?? ""
  );
  const [emailDomainVerified, setEmailDomainVerified] = useState(
    initial?.emailDomainVerified ?? false
  );
  const [largeAmountAlert, setLargeAmountAlert] = useState(
    initial?.largeAmountAlertMnt != null ? String(Number(initial.largeAmountAlertMnt)) : ""
  );
  const [controlGuardBlock, setControlGuardBlock] = useState(
    initial?.controlAccountGuard === "block"
  );
  const [aiPostLimit, setAiPostLimit] = useState(
    initial?.aiPostLimitMnt != null ? String(Number(initial.aiPostLimitMnt)) : ""
  );
  const [isPending, startTransition] = useTransition();

  function save() {
    if (!name.trim()) {
      toast.error("Компанийн нэрийг оруулна уу");
      return;
    }
    for (const signature of signatures) {
      if (!signature.name.trim()) {
        toast.error("Гарын үсэг бүрд нэр оруулна уу");
        return;
      }
    }
    startTransition(async () => {
      try {
        const saved = await updateOrganizationProfile({
          name,
          registerNo: registerNo || null,
          vatPayerNo: vatPayerNo || null,
          address: address || null,
          phone: phone || null,
          email: email || null,
          mccCode: mccCode || null,
          cityCode: cityCode || null,
          districtCode: districtCode || null,
          bankAccounts,
          logo,
          stamp,
          signatures,
          autoStamp,
          invoiceFromEmail: invoiceFromEmail || null,
          invoiceReplyTo: invoiceReplyTo || null,
          emailDomainVerified,
          largeAmountAlertMnt: largeAmountAlert.trim()
            ? Number(largeAmountAlert.replace(/[^\d.]/g, ""))
            : null,
          aiPostLimitMnt: aiPostLimit.trim()
            ? Number(aiPostLimit.replace(/[^\d.]/g, ""))
            : null,
          controlAccountGuard: controlGuardBlock ? "block" : "warn",
        });
        if (saved.error !== undefined) {
          toast.error(saved.error);
          return;
        }
        if (saved.warning) toast.warning(saved.warning);
        toast.success("Компанийн мэдээлэл хадгалагдлаа");
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Хадгалах амжилтгүй"
        );
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Реквизит ── */}
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Компанийн мэдээлэл
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            Нэхэмжлэх болон хэвлэх маягтын толгойд гарна.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="company-name">Компанийн нэр *</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ж: Монгол Трейд ХХК"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-register">Регистрийн дугаар</Label>
            <Input
              id="company-register"
              value={registerNo}
              onChange={(e) => setRegisterNo(e.target.value)}
              placeholder="ж: 1234567"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-vat">НӨАТ төлөгчийн дугаар</Label>
            <Input
              id="company-vat"
              value={vatPayerNo}
              onChange={(e) => setVatPayerNo(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="company-address">Хаяг</Label>
            <Input
              id="company-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="ж: Улаанбаатар хот, ..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-phone">Утас</Label>
            <Input
              id="company-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-email">И-мэйл</Label>
            <Input
              id="company-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ж: info@company.mn"
            />
          </div>
          {/* QPay мерчантын бүртгэлд — docs/deployment/qpay.md §2b; код зохиохгүй, сонгоно */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Бизнесийн ангилал (MCC)</Label>
            <SearchableSelect
              value={mccCode}
              options={MCC_OPTIONS}
              onChange={setMccCode}
              placeholder="QPay мерчантын ангилал сонгох"
              emptyLabel="Ангилал олдсонгүй"
            />
            <p className="text-[11px] text-[var(--ea-text-4)]">
              QPay-д бүртгүүлэхэд шаардлагатай (Борлуулалт → Тохиргоо → QPay).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Хот / аймаг</Label>
            <SearchableSelect
              value={cityCode}
              options={CITY_OPTIONS}
              onChange={(code) => {
                setCityCode(code);
                setDistrictCode("");
              }}
              placeholder="Хот / аймаг сонгох"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Дүүрэг / сум</Label>
            <SearchableSelect
              value={districtCode}
              options={districtOptions}
              onChange={setDistrictCode}
              placeholder={cityCode ? "Дүүрэг / сум сонгох" : "Эхлээд хот сонгоно"}
              disabled={!cityCode}
              valueLabel={districtCode && !districtOptions.some((d) => d.value === districtCode) ? districtCode : undefined}
              customOption={(query) =>
                /^\d{4,6}$/.test(query.trim()) ? { value: query.trim(), label: `${query.trim()} (QPay код гараар)` } : null
              }
            />
          </div>
        </div>
      </section>

      {/* ── Банкны данс ── */}
      <section className="ea-glass space-y-3 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Банкны данс
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
              Нэхэмжлэх дээр төлбөр хүлээн авах данс болж гарна. QPay-д бүртгэгдсэн бол
              энд хадгалахад QPay мерчантын данс автоматаар шинэчлэгдэнэ («Үндсэн» = QPay
              төлбөр орох данс).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setBankAccounts((prev) => [
                ...prev,
                { bankName: "", accountNo: "", accountName: "", bankCode: "", iban: "", isDefault: prev.length === 0 },
              ])
            }
          >
            <Icon name="add" size="sm" />
            Данс нэмэх
          </Button>
        </div>
        <div className="space-y-2">
          {bankAccounts.length === 0 ? (
            <p className="text-xs text-[var(--ea-text-4)]">
              Банкны данс бүртгэгдээгүй — «Данс нэмэх» товчоор нэмнэ.
            </p>
          ) : null}
          {bankAccounts.map((account, index) => (
            <div
              key={index}
              className="grid grid-cols-[auto_1.2fr_1fr_1fr_1fr_auto] items-end gap-2"
            >
              <div className="space-y-1 pb-2">
                {index === 0 && <Label title="QPay төлбөр орох үндсэн данс">Үндсэн</Label>}
                <input
                  type="radio"
                  name="company-bank-default"
                  aria-label="QPay төлбөр орох үндсэн данс"
                  checked={!!account.isDefault}
                  onChange={() =>
                    setBankAccounts((prev) => prev.map((a, i) => ({ ...a, isDefault: i === index })))
                  }
                />
              </div>
              <div className="space-y-1">
                {index === 0 && <Label>Банк</Label>}
                <SearchableSelect
                  value={account.bankCode ?? guessQpayBankCode(account.bankName) ?? ""}
                  options={BANK_OPTIONS}
                  hideValue
                  placeholder={account.bankName || "Банк сонгох"}
                  onChange={(code) =>
                    setBankAccounts((prev) =>
                      prev.map((a, i) =>
                        i === index
                          ? {
                              ...a,
                              bankCode: code,
                              bankName: QPAY_BANK_CODES.find((b) => b.code === code)?.name ?? a.bankName,
                            }
                          : a
                      )
                    )
                  }
                />
              </div>
              <div className="space-y-1">
                {index === 0 && <Label>Дансны дугаар</Label>}
                <Input
                  value={account.accountNo}
                  onChange={(e) =>
                    setBankAccounts((prev) =>
                      prev.map((a, i) =>
                        i === index ? { ...a, accountNo: e.target.value } : a
                      )
                    )
                  }
                  className="font-mono"
                  placeholder="ж: 5000000000"
                />
              </div>
              <div className="space-y-1">
                {index === 0 && <Label>Данс эзэмшигч</Label>}
                <Input
                  value={account.accountName}
                  onChange={(e) =>
                    setBankAccounts((prev) =>
                      prev.map((a, i) =>
                        i === index ? { ...a, accountName: e.target.value } : a
                      )
                    )
                  }
                  placeholder="ж: Монгол Трейд ХХК"
                />
              </div>
              <div className="space-y-1">
                {index === 0 && <Label>IBAN</Label>}
                <Input
                  value={account.iban ?? ""}
                  onChange={(e) =>
                    setBankAccounts((prev) =>
                      prev.map((a, i) =>
                        i === index ? { ...a, iban: e.target.value.toUpperCase() } : a
                      )
                    )
                  }
                  className="font-mono"
                  placeholder="MN…"
                />
              </div>
              <IconAction
                name="delete"
                label="Данс устгах"
                size="sm"
                variant="danger"
                onClick={() =>
                  setBankAccounts((prev) => {
                    const next = prev.filter((_, i) => i !== index);
                    return next.length > 0 && !next.some((a) => a.isDefault)
                      ? next.map((a, i) => ({ ...a, isDefault: i === 0 }))
                      : next;
                  })
                }
              />
            </div>
          ))}
        </div>
      </section>

      {/* ── Нэхэмжлэх илгээгч и-мэйл ── */}
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Нэхэмжлэх илгээгч и-мэйл
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            Нэхэмжлэх и-мэйлээр илгээхэд «From» хаяг болно. Тохируулаагүй бол
            серверийн анхдагч хаяг ашиглагдана. Хаягийн домэйныг эхлээд
            resend.com/domains дээр баталгаажуулсан байх шаардлагатай.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="invoice-from-email">Илгээгч хаяг</Label>
            <Input
              id="invoice-from-email"
              type="email"
              value={invoiceFromEmail}
              onChange={(e) => setInvoiceFromEmail(e.target.value)}
              placeholder="ж: billing@company.mn"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-reply-to">Хариу очих хаяг (reply-to)</Label>
            <Input
              id="invoice-reply-to"
              type="email"
              value={invoiceReplyTo}
              onChange={(e) => setInvoiceReplyTo(e.target.value)}
              placeholder="ж: info@company.mn"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="email-domain-verified"
            checked={emailDomainVerified}
            onCheckedChange={setEmailDomainVerified}
          />
          <div>
            <Label htmlFor="email-domain-verified">
              Илгээгч домэйн баталгаажсан
            </Label>
            <p className="text-[11px]" style={{ color: "var(--ea-text-4)" }}>
              resend.com/domains дээр баталгаажуулсны (verify) дараа идэвхжүүлнэ —
              идэвхжүүлээгүй үед дээрх хаягаар илгээхийг оролдохгүй.
            </p>
          </div>
        </div>
      </section>

      {/* ── Мэдэгдэл — том дүнгийн босго (D2) ── */}
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
            <Icon name="bell" size="sm" className="text-[var(--ea-text-3)]" />
            Том дүнгийн мэдэгдэл
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            Энэ дүнгээс (MNT) их журнал, нэхэмжлэх, кассын баримт батлагдахад
            эзэн/админд мэдэгдэнэ. Хоосон бол 10,000,000₮.
          </p>
        </div>
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="large-amount-alert">Босго (₮)</Label>
          <Input
            id="large-amount-alert"
            inputMode="numeric"
            value={largeAmountAlert}
            onChange={(e) => setLargeAmountAlert(e.target.value)}
            placeholder="10000000"
          />
        </div>
      </section>

      {/* ── AI туслахын шууд батлах хязгаар (§9 human-in-the-loop) ── */}
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
            <Icon name="ai" size="sm" className="text-[var(--ea-text-3)]" />
            AI-ийн шууд батлах хязгаар
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            MCP (ChatGPT / Claude), REST-ээр «Шууд бичих» горимд батлагдах дээд дүн
            (MNT). Үүнээс их бичилт ноорог үлдэж, нягтланч өөрөө батална.
            Хоосон бол 10,000,000₮.
          </p>
          <p className="mt-1 text-xs text-[var(--ea-warning-fg)]">
            AI өөрөө энэ хязгаарыг 1,000,000,000₮ хүртэл л өсгөж чадна —
            түүнээс дээшийг зөвхөн эндээс тавина. Өөрчлөгдөх бүрд эзэн/админд
            мэдэгдэл очиж, аудитын мөрд бүртгэгдэнэ.
          </p>
        </div>
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="ai-post-limit">Хязгаар (₮)</Label>
          <Input
            id="ai-post-limit"
            inputMode="numeric"
            value={aiPostLimit}
            onChange={(e) => setAiPostLimit(e.target.value)}
            placeholder="10000000"
          />
        </div>
      </section>

      {/* ── Хяналтын дансны хамгаалалт (SIM2-038) ── */}
      <section className="ea-glass space-y-3 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Авлага, өглөгийн хяналтын данс
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            13110000, 31000001 зэрэг хяналтын дансанд гар журнал бичвэл
            нэхэмжлэлийн үлдэгдэл GL-тэй зөрнө. Анхдагчаар анхааруулна;
            асаавал хориглоно (нээлтийн журнал чөлөөтэй).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="control-guard"
            checked={controlGuardBlock}
            onCheckedChange={setControlGuardBlock}
          />
          <Label htmlFor="control-guard">
            Хяналтын дансанд гар журнал бичихийг хориглох
          </Label>
        </div>
      </section>

      {/* ── Лого, тамга ── */}
      <section className="ea-glass space-y-5 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Лого, тамга
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
            PNG, тунгалаг дэвсгэртэй, 1MB хүртэл. Нэхэмжлэхийн PDF дээр гарна.
          </p>
        </div>
        <PngPicker label="Лого" value={logo} onChange={setLogo} height={56} />
        <Separator />
        <PngPicker
          label="Тамга"
          hint="Дугуй тамганы тод, тунгалаг дэвсгэртэй PNG — гарын үсгэн дээгүүр давхарлан дарагдана."
          value={stamp}
          onChange={setStamp}
          height={96}
        />
        <div className="flex items-center gap-3">
          <Switch
            id="auto-stamp"
            checked={autoStamp}
            onCheckedChange={setAutoStamp}
          />
          <Label htmlFor="auto-stamp">
            Нэхэмжлэхийн PDF-д тамга, гарын үсгийг автоматаар оруулах
          </Label>
        </div>
      </section>

      {/* ── Гарын үсэг ── */}
      <section className="ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Гарын үсэг
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
              Захирал, нягтлан зэрэг гарын үсэг зурах хүмүүс (дээд тал нь 4).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={signatures.length >= 4}
            onClick={() =>
              setSignatures((prev) => [
                ...prev,
                { name: "", title: "Захирал", image: "" },
              ])
            }
          >
            <Icon name="add" size="sm" />
            Гарын үсэг нэмэх
          </Button>
        </div>
        {signatures.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--ea-text-4)" }}>
            Гарын үсэг нэмээгүй байна — PDF дээр зөвхөн зураас гарна.
          </p>
        ) : (
          <div className="space-y-4">
            {signatures.map((signature, index) => (
              <div
                key={index}
                className="space-y-3 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] p-3"
              >
                <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <div className="space-y-1">
                    <Label>Албан тушаал</Label>
                    <Input
                      value={signature.title}
                      onChange={(e) =>
                        setSignatures((prev) =>
                          prev.map((s, i) =>
                            i === index ? { ...s, title: e.target.value } : s
                          )
                        )
                      }
                      placeholder="ж: Захирал"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Нэр</Label>
                    <Input
                      value={signature.name}
                      onChange={(e) =>
                        setSignatures((prev) =>
                          prev.map((s, i) =>
                            i === index ? { ...s, name: e.target.value } : s
                          )
                        )
                      }
                      placeholder="ж: Д. Дорж"
                    />
                  </div>
                  <IconAction
                    name="delete"
                    label="Гарын үсэг устгах"
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      setSignatures((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                </div>
                <PngPicker
                  label="Гарын үсгийн зураг"
                  value={signature.image || null}
                  onChange={(next) =>
                    setSignatures((prev) =>
                      prev.map((s, i) =>
                        i === index ? { ...s, image: next ?? "" } : s
                      )
                    )
                  }
                  height={48}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={isPending}>
          {isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
      </div>
    </div>
  );
}
