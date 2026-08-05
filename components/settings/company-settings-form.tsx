"use client";

// Компанийн мэдээллийн форм — нэхэмжлэх/маягтын толгойн реквизит,
// лого/тамга/гарын үсгийн PNG зураг, autoStamp тохиргоо.

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { updateCompanySettings } from "@/lib/actions/company";
import type { CompanySettings } from "@/lib/db/schema";
import { toast } from "sonner";

type BankAccount = { bankName: string; accountNo: string; accountName: string };
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

export function CompanySettingsForm({
  initial,
}: {
  initial: CompanySettings | null;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [registerNo, setRegisterNo] = useState(initial?.registerNo ?? "");
  const [vatPayerNo, setVatPayerNo] = useState(initial?.vatPayerNo ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>(
    initial?.bankAccounts?.length
      ? initial.bankAccounts
      : [{ bankName: "", accountNo: "", accountName: "" }]
  );
  const [logo, setLogo] = useState<string | null>(initial?.logo ?? null);
  const [stamp, setStamp] = useState<string | null>(initial?.stamp ?? null);
  const [signatures, setSignatures] = useState<Signature[]>(
    initial?.signatures ?? []
  );
  const [autoStamp, setAutoStamp] = useState(initial?.autoStamp ?? true);
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
        await updateCompanySettings({
          name,
          registerNo: registerNo || null,
          vatPayerNo: vatPayerNo || null,
          address: address || null,
          phone: phone || null,
          email: email || null,
          bankAccounts,
          logo,
          stamp,
          signatures,
          autoStamp,
        });
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
              placeholder="Жишээ ХХК"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-register">Регистрийн дугаар</Label>
            <Input
              id="company-register"
              value={registerNo}
              onChange={(e) => setRegisterNo(e.target.value)}
              placeholder="1234567"
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
              placeholder="Улаанбаатар хот, ..."
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
              placeholder="info@company.mn"
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
              Нэхэмжлэх дээр төлбөр хүлээн авах данс болж гарна.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setBankAccounts((prev) => [
                ...prev,
                { bankName: "", accountNo: "", accountName: "" },
              ])
            }
          >
            <Icon name="add" size="sm" />
            Данс нэмэх
          </Button>
        </div>
        <div className="space-y-2">
          {bankAccounts.map((account, index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2"
            >
              <div className="space-y-1">
                {index === 0 && <Label>Банк</Label>}
                <Input
                  value={account.bankName}
                  onChange={(e) =>
                    setBankAccounts((prev) =>
                      prev.map((a, i) =>
                        i === index ? { ...a, bankName: e.target.value } : a
                      )
                    )
                  }
                  placeholder="Хаан банк"
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
                  placeholder="5000000000"
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
                  placeholder="Жишээ ХХК"
                />
              </div>
              <IconAction
                name="delete"
                label="Данс устгах"
                size="sm"
                variant="danger"
                onClick={() =>
                  setBankAccounts((prev) => prev.filter((_, i) => i !== index))
                }
              />
            </div>
          ))}
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
                      placeholder="Захирал"
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
                      placeholder="Д. Дорж"
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
