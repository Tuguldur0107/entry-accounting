"use client";

// eBarimt-ийн кодын ХАЙЛТТАЙ сонгогчууд — барааны карт ба ангиллын диалог.
//  • ClassificationCodePicker — 7 оронтой ангилал (ТЕГ/ҮСХ): СЕРВЕРИЙН хайлт
//    (хэдэн мянган мөр client-д ирэхгүй) + байгууллагын хэрэглэж буй код.
//  • TaxProductCodePicker — 3–5 оронтой татварын бүтээгдэхүүний код: албан
//    жагсаалт (lib/ebarimt/tax-product-codes.ts) НӨАТ-ийн горимоор шүүгдэнэ.
// Хоёулаа жагсаалтад байхгүй кодыг гараар оруулахыг ЗӨВШӨӨРНӨ (ТЕГ шинэ код
// нэмдэг) — зөвхөн хэлбэрийг (7 / 3–5 орон, TAX_PRODUCT_CODE_RE) шалгана, код ЗОХИОХГҮЙ.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TAX_PRODUCT_CODE_RE } from "@/lib/ebarimt/constants";

import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { searchEbarimtClassifications } from "@/lib/actions/ebarimt-classification";
import type { ClassificationMatch } from "@/lib/ebarimt/classification-search";
import { taxProductCodeName, taxProductCodesFor } from "@/lib/ebarimt/tax-product-codes";
import type { ItemVatMode } from "@/lib/inventory/types";

const SEARCH_DEBOUNCE_MS = 250;

function matchOption(match: ClassificationMatch): SearchableOption {
  return {
    value: match.code,
    label: match.name,
    hint: match.usage ?? (match.source === "org" ? "байгууллагад" : undefined),
  };
}

export function ClassificationCodePicker({
  value,
  onChange,
  disabled,
  placeholder = "Хайх: код эсвэл нэр",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [options, setOptions] = useState<SearchableOption[]>([]);
  const [datasetSize, setDatasetSize] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  const applyResult = useCallback(
    (result: Awaited<ReturnType<typeof searchEbarimtClassifications>>) => {
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      setError("");
      setDatasetSize(result.datasetSize);
      setOptions(result.matches.map(matchOption));
      setLabels((current) => {
        const next = { ...current };
        for (const match of result.matches) next[match.code] = match.name;
        return next;
      });
    },
    []
  );

  const runSearch = useCallback(
    (query: string) => {
      const id = ++requestId.current;
      void searchEbarimtClassifications(query).then((result) => {
        if (id === requestId.current) applyResult(result); // хуучирсан хариуг алгасна
      });
    },
    [applyResult]
  );

  // Хадгалсан кодын нэрийг анх ачаалахад авна (trigger дээр харуулах).
  useEffect(() => {
    if (!value || labels[value] !== undefined) return;
    let cancelled = false;
    void searchEbarimtClassifications(value).then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function onQueryChange(query: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(query), query ? SEARCH_DEBOUNCE_MS : 0);
  }

  const footer = error
    ? error
    : datasetSize === 0
      ? "ТЕГ/ҮСХ-ын албан жагсаалт хараахан ачаалагдаагүй — байгууллагын хэрэглэж буй код ба гараар 7 оронтой код оруулна."
      : datasetSize
        ? `ТЕГ/ҮСХ «Бүтээгдэхүүн, үйлчилгээний нэгдсэн ангилал» · ${datasetSize.toLocaleString("mn-MN")} код`
        : null;

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      serverFiltered
      onQueryChange={onQueryChange}
      maxVisible={50}
      placeholder={placeholder}
      disabled={disabled}
      valueLabel={labels[value] ?? ""}
      emptyLabel="Илэрц олдсонгүй — 7 оронтой кодыг шууд бичиж болно"
      customOption={(query) =>
        /^\d{7}$/.test(query)
          ? { value: query, label: "Гараар оруулах", hint: "жагсаалтаар шалгаагүй" }
          : null
      }
      footer={footer}
    />
  );
}

export function TaxProductCodePicker({
  vatMode,
  value,
  onChange,
}: {
  vatMode: ItemVatMode;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = useMemo<SearchableOption[]>(
    () => taxProductCodesFor(vatMode).map((entry) => ({ value: entry.code, label: entry.name })),
    [vatMode]
  );
  const disabled = vatMode === "standard";
  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      placeholder={disabled ? "НӨАТ-тай бараанд шаардахгүй" : "Хайх: код эсвэл нэр"}
      valueLabel={taxProductCodeName(value) ?? "жагсаалтаар шалгаагүй"}
      customOption={(query) =>
        TAX_PRODUCT_CODE_RE.test(query)
          ? { value: query, label: "Гараар оруулах", hint: "жагсаалтаар шалгаагүй (3–5 орон)" }
          : null
      }
      footer={
        vatMode === "exempt"
          ? "ТЕГ: НӨАТ-аас чөлөөлөгдөх бараа, үйлчилгээний код (305–446)"
          : vatMode === "zero"
            ? "ТЕГ: НӨАТ-ын 0% хувь хэмжээтэй бараа, үйлчилгээний код (501–507)"
            : null
      }
    />
  );
}
