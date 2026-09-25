"use client";

// Валют сонгох НЭГДСЭН select (SIM2-033) — чөлөөт текстээр буруу код
// бичигдэхээс сэргийлнэ. Хадгалагдсан утга жагсаалтад байхгүй бол (хуучин
// өгөгдөл) хэвээр харагдана — өөрчлөхгүй.

export const CURRENCY_OPTIONS = ["MNT", "USD", "EUR", "CNY", "RUB", "JPY", "KRW"] as const;

export function CurrencySelect({
  value,
  onChange,
  id,
  disabled,
}: {
  value: string;
  onChange: (currency: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const current = value.trim().toUpperCase() || "MNT";
  const options: string[] = [...CURRENCY_OPTIONS];
  if (!options.includes(current)) options.push(current);
  return (
    <select
      id={id}
      aria-label="Валют"
      value={current}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="ea-form-select"
    >
      {options.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}
