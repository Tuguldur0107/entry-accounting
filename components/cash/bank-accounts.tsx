"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  createBankAccount,
  toggleBankAccount,
  deleteBankAccount,
} from "@/lib/actions/cash";
import type { BankAccount } from "@/lib/db/schema";

const fmt = (n: number | string) =>
  Number(n || 0).toLocaleString("mn-MN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

interface CoaOption {
  number: string;
  name: string;
}

interface Props {
  accounts: BankAccount[];
  cashCoa: CoaOption[];
}

export function BankAccounts({ accounts, cashCoa }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [accountNumber, setAccountNumber] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("MNT");
  const [openingBalance, setOpeningBalance] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BankAccount | null>(null);

  function resetForm() {
    setAccountNumber("");
    setName("");
    setCurrency("MNT");
    setOpeningBalance("");
    setError("");
  }

  async function handleAdd() {
    if (!accountNumber || !name.trim()) {
      setError("Данс ба нэрийг бөглөнө үү");
      return;
    }
    setSaving(true);
    setError("");
    const res = await createBankAccount({
      accountNumber,
      name: name.trim(),
      currency,
      openingBalance: parseFloat(openingBalance) || 0,
    });
    setSaving(false);
    if (res?.error) {
      setError(res.error);
    } else {
      resetForm();
      setAddOpen(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await deleteBankAccount(deleteTarget.id);
    setDeleteTarget(null);
    if (res?.error) alert(res.error);
  }

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-medium text-[#1A1A19]">Банкны/кассын дансууд</h1>
        <Button
          className="bg-[#1E3A5F] hover:bg-[#15294A] text-white text-sm h-9 px-4 rounded-md"
          onClick={() => setAddOpen(true)}
        >
          + Данс нэмэх
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="bg-white border border-[#E5E5DE] rounded-md py-16 text-center text-[#aaa] text-sm">
          Данс байхгүй — “+ Данс нэмэх” товч дарна уу
        </div>
      ) : (
        <div className="bg-white border border-[#E5E5DE] rounded-lg overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#F4F4EE] text-[11px] font-semibold text-[#9A9A91] uppercase tracking-wide">
                <th className="px-4 py-2.5 text-left border-b border-[#E5E5DE]">Нэр</th>
                <th className="px-4 py-2.5 text-left w-[120px] border-b border-[#E5E5DE]">GL данс</th>
                <th className="px-4 py-2.5 text-left w-[80px] border-b border-[#E5E5DE]">Валют</th>
                <th className="px-4 py-2.5 text-right w-[160px] border-b border-[#E5E5DE]">Эхний үлдэгдэл</th>
                <th className="px-4 py-2.5 text-center w-[90px] border-b border-[#E5E5DE]">Идэвхтэй</th>
                <th className="px-4 py-2.5 w-[60px] border-b border-[#E5E5DE]" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-[#F0F0EA] hover:bg-[#FAFAFA]">
                  <td className="px-4 py-2.5 text-[#1A1A19]">{a.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[#555]">{a.accountNumber}</td>
                  <td className="px-4 py-2.5 text-[#555]">{a.currency}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(a.openingBalance)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center">
                      <Switch
                        checked={a.isActive}
                        onCheckedChange={(v) => toggleBankAccount(a.id, v)}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => setDeleteTarget(a)}
                      className="h-6 w-6 inline-flex items-center justify-center text-[#C4C4BC] border border-[#E5E5DE] rounded hover:text-[#B91C1C] hover:border-[#FECACA] hover:bg-[#FFF5F5] transition-colors bg-white text-sm leading-none"
                      title="Устгах"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add modal */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) { resetForm(); setAddOpen(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Данс нэмэх</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>GL данс (касс/банк)</Label>
              <select
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="w-full h-9 px-2.5 text-sm border border-[#D4D4CB] rounded-md bg-white text-[#1A1A19] outline-none focus:border-[#1E3A5F]"
              >
                <option value="">— Сонгох —</option>
                {cashCoa.map((c) => (
                  <option key={c.number} value={c.number}>
                    {c.number} — {c.name}
                  </option>
                ))}
              </select>
              {cashCoa.length === 0 && (
                <p className="text-xs text-[#B45309]">
                  Касс/банкны данс (10xx/11xx) идэвхгүй байна. GL → Тохиргооноос идэвхжүүлнэ үү.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Дансны нэр</Label>
              <Input
                placeholder="Жишээ: Голомт MNT харилцах"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Валют</Label>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-1.5">
                <Label>Эхний үлдэгдэл</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setAddOpen(false); }}>Болих</Button>
            <Button className="bg-[#1E3A5F] hover:bg-[#15294A]" disabled={saving} onClick={handleAdd}>
              {saving ? "Хадгалж байна..." : "Хадгалах"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Устгах уу?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#333]">
            <span className="font-semibold">{deleteTarget?.name}</span> дансыг устгах уу?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Болих</Button>
            <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={handleDelete}>
              Устгах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
