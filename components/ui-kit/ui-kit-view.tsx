"use client";

// UI Kit — living style guide.
// Төслийн дизайн токен, primitive, тусгай component-уудыг нэг дор үзүүлнэ.
// Шинэ UI хийхдээ ЭНД байгаа хэв маягийг дагана — шинэ өнгө/hardcode хориотой.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AccountInput } from "@/components/account/account-input";
import { AccountSegmentPicker } from "@/components/account/account-segment-picker";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import type { ColDef } from "ag-grid-community";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

/* ---------- demo data ---------- */

const DEMO_SEG_IDS = [1, 3];
const DEMO_SEG_OPTIONS: Record<number, SegOption[]> = {
  1: [
    { code: "100", name: "Толгой компани" },
    { code: "200", name: "Охин компани" },
  ],
  3: [
    { code: "11210000", name: "Касс" },
    { code: "11000001", name: "Харилцах данс" },
    { code: "13110000", name: "Авлага" },
    { code: "31000001", name: "Өглөг (AP)" },
    { code: "51100000", name: "Борлуулалтын орлого" },
    { code: "72100000", name: "Цалингийн зардал" },
  ],
};

interface DemoRow {
  id: string;
  date: string;
  account: string;
  name: string;
  debit: number;
  credit: number;
}

const DEMO_ROWS: DemoRow[] = [
  { id: "1", date: "2026-07-01", account: "11210000", name: "Касс", debit: 4200000, credit: 0 },
  { id: "2", date: "2026-07-01", account: "13110000", name: "Авлага", debit: 0, credit: 4200000 },
  { id: "3", date: "2026-07-02", account: "51100000", name: "Борлуулалтын орлого", debit: 0, credit: 8400000 },
  { id: "4", date: "2026-07-02", account: "31410000", name: "НӨАТ өглөг", debit: 0, credit: 840000 },
  { id: "5", date: "2026-07-03", account: "72100000", name: "Цалингийн зардал", debit: 2100000, credit: 0 },
];

const DEMO_COLS: ColDef<DemoRow>[] = [
  { field: "date", headerName: "Огноо", width: 120, cellClass: "font-mono text-xs" },
  { field: "account", headerName: "Данс", width: 120, cellClass: "font-mono text-xs" },
  { field: "name", headerName: "Нэр", flex: 1, minWidth: 160 },
  {
    field: "debit", headerName: "Дебет", width: 140,
    cellClass: "ag-right-aligned-cell font-mono", headerClass: "ag-right-aligned-header",
    valueFormatter: (p) => (p.value ? fmtMnt(Number(p.value)) : ""),
  },
  {
    field: "credit", headerName: "Кредит", width: 140,
    cellClass: "ag-right-aligned-cell font-mono", headerClass: "ag-right-aligned-header",
    valueFormatter: (p) => (p.value ? fmtMnt(Number(p.value)) : ""),
  },
];

/* ---------- building blocks ---------- */

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section
      className="p-5 space-y-4"
      style={{
        background: "var(--ea-surface)",
        border: "1px solid var(--ea-border)",
        borderRadius: "var(--ea-r-lg)",
      }}
    >
      <div>
        <h2 className="text-sm font-semibold" style={{ color: "var(--ea-text-1)" }}>{title}</h2>
        {hint && <p className="text-xs mt-0.5" style={{ color: "var(--ea-text-3)" }}>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ token, label }: { token: string; label?: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5 w-[108px]">
      <div
        className="w-full h-10 rounded-md"
        style={{ background: `var(${token})`, border: "1px solid var(--ea-border)" }}
      />
      <code className="text-[10px] leading-tight" style={{ color: "var(--ea-text-3)" }}>
        {token}
      </code>
      {label && (
        <span className="text-[10px] -mt-1" style={{ color: "var(--ea-text-4)" }}>{label}</span>
      )}
    </div>
  );
}

/* ---------- page ---------- */

export function UiKitView() {
  const [account, setAccount] = useState("100..11210000...000.0000..GL.0");
  const [pickerCode, setPickerCode] = useState("");
  const [switchOn, setSwitchOn] = useState(true);

  return (
    <div className="max-w-screen-xl mx-auto space-y-4 pb-10">
      <div className="pt-1">
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--ea-text-1)", fontFamily: "var(--ea-font-display)" }}
        >
          UI Kit
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--ea-text-3)" }}>
          Дизайн токен ба component-уудын нэгдсэн лавлагаа. Шинэ UI бүтээхдээ эндээс хэв маягаа авна.
        </p>
      </div>

      {/* 1. Өнгө */}
      <Section title="Өнгөний токен (--ea-*)" hint="Hardcode өнгө хориотой — үргэлж эдгээр CSS хувьсагчийг ашиглана. Dark mode автоматаар солигдоно.">
        <div className="space-y-4">
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: "var(--ea-text-2)" }}>Brand</div>
            <div className="flex flex-wrap gap-3">
              <Swatch token="--ea-primary" label="Гол өнгө" />
              <Swatch token="--ea-primary-700" label="Hover" />
              <Swatch token="--ea-primary-500" />
              <Swatch token="--ea-primary-100" />
              <Swatch token="--ea-primary-50" />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: "var(--ea-text-2)" }}>Дэвсгэр ба хүрээ</div>
            <div className="flex flex-wrap gap-3">
              <Swatch token="--ea-bg" label="Body" />
              <Swatch token="--ea-bg-2" />
              <Swatch token="--ea-bg-3" />
              <Swatch token="--ea-surface" label="Card" />
              <Swatch token="--ea-border" />
              <Swatch token="--ea-border-strong" />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: "var(--ea-text-2)" }}>Семантик</div>
            <div className="flex flex-wrap gap-3">
              <Swatch token="--ea-success" label="Амжилт" />
              <Swatch token="--ea-danger" label="Аюул" />
              <Swatch token="--ea-warning" label="Анхааруулга" />
              <Swatch token="--ea-success-bg" />
              <Swatch token="--ea-danger-bg" />
              <Swatch token="--ea-warning-bg" />
            </div>
          </div>
        </div>
      </Section>

      {/* 2. Typography */}
      <Section title="Тайпографи" hint="3 font family + 4 текстийн түвшин.">
        <div className="space-y-3">
          <div style={{ fontFamily: "var(--ea-font-display)", fontSize: 24, color: "var(--ea-text-1)" }}>
            Display — Fraunces · Нягтлан бодох бүртгэл
          </div>
          <div style={{ fontFamily: "var(--ea-font-sans)", fontSize: 14, color: "var(--ea-text-1)" }}>
            Sans — Geist · Үндсэн интерфейсийн текст
          </div>
          <div style={{ fontFamily: "var(--ea-font-mono)", fontSize: 13, color: "var(--ea-text-1)" }}>
            Mono — 11210000 · 4,200,000.00 ₮ · дансны код, мөнгөн дүн
          </div>
          <Separator />
          <div className="flex flex-wrap gap-6 text-sm">
            <span style={{ color: "var(--ea-text-1)" }}>text-1 Үндсэн</span>
            <span style={{ color: "var(--ea-text-2)" }}>text-2 Хоёрдогч</span>
            <span style={{ color: "var(--ea-text-3)" }}>text-3 Сул</span>
            <span style={{ color: "var(--ea-text-4)" }}>text-4 Хамгийн сул</span>
          </div>
        </div>
      </Section>

      {/* 3. Buttons */}
      <Section title="Button" hint='components/ui/button.tsx — variant × size.'>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button>default</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="outline">outline</Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="destructive">destructive</Button>
            <Button variant="link">link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs">xs</Button>
            <Button size="sm">sm</Button>
            <Button size="default">default</Button>
            <Button disabled>disabled</Button>
          </div>
        </div>
      </Section>

      {/* 4. Badge + статус */}
      <Section title="Badge ба статус" hint="Журналын төлөв, баланс зэрэгт ашиглах хэв маяг.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>default</Badge>
            <Badge variant="secondary">secondary</Badge>
            <Badge variant="outline">outline</Badge>
            <Badge variant="destructive">destructive</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-sm px-3 py-1.5 rounded-md font-medium"
              style={{
                color: "var(--ea-success)",
                background: "color-mix(in srgb, var(--ea-success) 10%, var(--ea-surface))",
                border: "1px solid color-mix(in srgb, var(--ea-success) 30%, transparent)",
              }}
            >
              ✓ Тэнцсэн
            </span>
            <span
              className="text-sm px-3 py-1.5 rounded-md font-medium"
              style={{
                color: "var(--ea-danger)",
                background: "color-mix(in srgb, var(--ea-danger) 10%, var(--ea-surface))",
                border: "1px solid color-mix(in srgb, var(--ea-danger) 30%, transparent)",
              }}
            >
              Зөрүү: 840,000.00
            </span>
            <span
              className="text-sm px-3 py-1.5 rounded-md font-medium"
              style={{ color: "var(--ea-text-3)", background: "var(--ea-bg-2)" }}
            >
              Дүн оруулаагүй
            </span>
          </div>
        </div>
      </Section>

      {/* 5. Form elements */}
      <Section title="Form элементүүд" hint="Input, Select, Switch, Skeleton.">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="uikit-input">Гүйлгээний утга</Label>
            <Input id="uikit-input" placeholder="Тайлбар оруулна уу" />
          </div>
          <div className="space-y-1.5">
            <Label>Валют</Label>
            <Select defaultValue="mnt">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mnt">MNT — Төгрөг</SelectItem>
                <SelectItem value="usd">USD — Доллар</SelectItem>
                <SelectItem value="cny">CNY — Юань</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={switchOn} onCheckedChange={setSwitchOn} id="uikit-switch" />
            <Label htmlFor="uikit-switch">Данс идэвхтэй ({switchOn ? "тийм" : "үгүй"})</Label>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </Section>

      {/* 6. Dialog */}
      <Section title="Dialog" hint="Popup стандарт: гарчиг + × товч, footer [Болих][Хадгалах], Esc/overlay-аар хаагдана.">
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>
            Dialog нээх
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Данс нэмэх</DialogTitle>
              <DialogDescription>Шинэ дансны мэдээллийг оруулна уу.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Дансны дугаар</Label>
                <Input placeholder="11210000" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Дансны нэр</Label>
                <Input placeholder="Касс" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline">Болих</Button>
              <Button>Хадгалах</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      {/* 7. Дансны component-ууд */}
      <Section
        title="Дансны component-ууд"
        hint="components/account/ — бүх модульд данс оруулах нэгдсэн хэрэгсэл. Идэвхтэй сегментээр динамик."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>AccountInput — гараар бичих + ⌄ сегмент picker</Label>
            <AccountInput
              value={account}
              onChange={setAccount}
              activeSegIds={DEMO_SEG_IDS}
              segmentOptions={DEMO_SEG_OPTIONS}
            />
            <code className="text-[11px] block mt-1" style={{ color: "var(--ea-text-4)" }}>
              value: {account || "(хоосон)"}
            </code>
          </div>
          <div className="space-y-1.5">
            <Label>AccountSegmentPicker — сегмент бүрийн dropdown</Label>
            <div
              className="p-3 rounded-lg"
              style={{ border: "1px solid var(--ea-border)", background: "var(--ea-bg-2)" }}
            >
              <AccountSegmentPicker
                value={pickerCode}
                onChange={setPickerCode}
                activeSegIds={DEMO_SEG_IDS}
                segmentOptions={DEMO_SEG_OPTIONS}
              />
            </div>
            <code className="text-[11px] block mt-1" style={{ color: "var(--ea-text-4)" }}>
              value: {pickerCode || "(хоосон)"}
            </code>
          </div>
        </div>
      </Section>

      {/* 8. DataGrid */}
      <Section
        title="DataGrid"
        hint="components/datagrid/ — бүх хүснэгтийн нэгдсэн component (AG Grid Community v35). Багана бүр дээр ComboFilter."
      >
        <div style={{ border: "1px solid var(--ea-border)", borderRadius: "var(--ea-r-md)", overflow: "hidden" }}>
          <DataGridDynamic<DemoRow>
            rowData={DEMO_ROWS}
            columnDefs={DEMO_COLS}
            getRowId={(p) => p.data.id}
            height={260}
          />
        </div>
        <p className="text-xs" style={{ color: "var(--ea-text-4)" }}>
          Журналын мөр оруулах бол <code>components/journal/journal-lines-grid.tsx</code>-г шууд ашиглана.
        </p>
      </Section>
    </div>
  );
}
