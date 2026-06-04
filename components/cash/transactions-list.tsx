"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  createTransaction,
  updateTransaction,
  postTransaction,
  deleteTransaction,
  type TxnInput,
} from "@/lib/actions/cash";
import {
  CF_CATEGORIES,
  CF_CATEGORY_LABEL,
  DIRECTIONS,
  type CfCategory,
  type Direction,
} from "@/lib/constants/cash";
import type { BankAccount, BankTransaction } from "@/lib/db/schema";

const PAGE_SIZE = 15;

const fmt = (n: number | string) =>
  Number(n || 0).toLocaleString("mn-MN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

type TxnRow = BankTransaction & { bankAccount: BankAccount };
interface CoaOption {
  number: string;
  name: string;
}

interface Props {
  txns: TxnRow[];
  banks: BankAccount[];
  coa: CoaOption[];
}

const today = () => new Date().toISOString().slice(0, 10);

interface FormState {
  bankAccountId: string;
  date: string;
  direction: Direction;
  amount: string;
  contraAccount: string;
  cfCategory: CfCategory;
  counterparty: string;
  description: string;
  reference: string;
}

function emptyForm(banks: BankAccount[]): FormState {
  return {
    bankAccountId: banks[0]?.id ?? "",
    date: today(),
    direction: "inflow",
    amount: "",
    contraAccount: "",
    cfCategory: "operating",
    counterparty: "",
    description: "",
    reference: "",
  };
}

export function TransactionsList({ txns, banks, coa }: Props) {
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(banks));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"draft" | "posted" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TxnRow | null>(null);

  const totalPages = Math.max(1, Math.ceil(txns.length / PAGE_SIZE));
  const paginated = txns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const inflowTotal = useMemo(
    () => txns.filter((t) => t.direction === "inflow").reduce((s, t) => s + Number(t.amount), 0),
    [txns]
  );
  const outflowTotal = useMemo(
    () => txns.filter((t) => t.direction === "outflow").reduce((s, t) => s + Number(t.amount), 0),
    [txns]
  );

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function openAdd() {
    setEditId(null);
    setForm(emptyForm(banks));
    setError("");
    setFormOpen(true);
  }

  function openEdit(t: TxnRow) {
    setEditId(t.id);
    setForm({
      bankAccountId: t.bankAccountId,
      date: t.date,
      direction: t.direction as Direction,
      amount: String(Number(t.amount)),
      contraAccount: t.contraAccount,
      cfCategory: t.cfCategory as CfCategory,
      counterparty: t.counterparty ?? "",
      description: t.description,
      reference: t.reference ?? "",
    });
    setError("");
    setFormOpen(true);
  }

  async function handleSave(status: "draft" | "posted") {
    if (!form.bankAccountId) return setError("Банкны данс сонгоно уу");
    if (!form.contraAccount) return setError("Эсрэг данс сонгоно уу");
    if (!form.description.trim()) return setError("Гүйлгээний утга оруулна уу");
    if (!(parseFloat(form.amount) > 0)) return setError("Дүн 0-ээс их байх ёстой");

    setSaving(status);
    setError("");
    const payload: TxnInput = {
      bankAccountId: form.bankAccountId,
      date: form.date,
      direction: form.direction,
      amount: parseFloat(form.amount),
      contraAccount: form.contraAccount,
      cfCategory: form.cfCategory,
      counterparty: form.counterparty,
      description: form.description.trim(),
      reference: form.reference,
      status,
    };
    try {
      if (editId) await updateTransaction(editId, payload);
      else await createTransaction(payload);
      setFormOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа");
    } finally {
      setSaving(null);
    }
  }

  async function handlePost(id: string) {
    if (!confirm("Энэ гүйлгээг батлах уу? GL журнал үүснэ.")) return;
    await postTransaction(id);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteTransaction(deleteTarget.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Алдаа гарлаа");
    }
    setDeleteTarget(null);
  }

  const noBanks = banks.length === 0;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-medium text-[#1A1A19]">Мөнгөн гүйлгээ</h1>
        <Button
          className="bg-[#1E3A5F] hover:bg-[#15294A] text-white text-sm h-9 px-4 rounded-md disabled:opacity-50"
          onClick={openAdd}
          disabled={noBanks}
          title={noBanks ? "Эхлээд банкны данс үүсгэнэ үү" : undefined}
        >
          + Гүйлгээ нэмэх
        </Button>
      </div>

      {noBanks && (
        <div className="mb-4 text-sm text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-2">
          Идэвхтэй банкны данс алга. “Дансууд” табаас данс үүсгэнэ үү.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-[#E5E5DE] rounded-md px-4 py-3">
          <div className="text-[11px] text-[#888] uppercase tracking-wide">Нийт орлого</div>
          <div className="text-base font-semibold text-[#047857] tabular-nums mt-1">{fmt(inflowTotal)}</div>
        </div>
        <div className="bg-white border border-[#E5E5DE] rounded-md px-4 py-3">
          <div className="text-[11px] text-[#888] uppercase tracking-wide">Нийт зарлага</div>
          <div className="text-base font-semibold text-[#B91C1C] tabular-nums mt-1">{fmt(outflowTotal)}</div>
        </div>
        <div className="bg-white border border-[#E5E5DE] rounded-md px-4 py-3">
          <div className="text-[11px] text-[#888] uppercase tracking-wide">Цэвэр гүйлгээ</div>
          <div className="text-base font-semibold text-[#1A1A19] tabular-nums mt-1">{fmt(inflowTotal - outflowTotal)}</div>
        </div>
      </div>

      {/* Table */}
      {txns.length === 0 ? (
        <div className="bg-white border border-[#E5E5DE] rounded-md py-16 text-center text-[#aaa] text-sm">
          Гүйлгээ байхгүй
        </div>
      ) : (
        <div className="bg-white border border-[#E5E5DE] rounded-lg overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#F4F4EE] text-[11px] font-semibold text-[#9A9A91] uppercase tracking-wide">
                <th className="px-3 py-2.5 text-left w-[90px] border-b border-[#E5E5DE]">Огноо</th>
                <th className="px-3 py-2.5 text-left border-b border-[#E5E5DE]">Утга</th>
                <th className="px-3 py-2.5 text-left w-[150px] border-b border-[#E5E5DE]">Данс</th>
                <th className="px-3 py-2.5 text-left w-[120px] border-b border-[#E5E5DE]">Ангилал</th>
                <th className="px-3 py-2.5 text-right w-[120px] border-b border-[#E5E5DE]">Орлого</th>
                <th className="px-3 py-2.5 text-right w-[120px] border-b border-[#E5E5DE]">Зарлага</th>
                <th className="px-3 py-2.5 text-left w-[150px] border-b border-[#E5E5DE]">Төлөв</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((t) => {
                const inflow = t.direction === "inflow";
                return (
                  <tr key={t.id} className="border-t border-[#F0F0EA] hover:bg-[#FAFAFA] group">
                    <td className="px-3 py-2 font-mono text-xs text-[#6B6B63] whitespace-nowrap">{t.date}</td>
                    <td className="px-3 py-2 text-[#1A1A19]">
                      {t.description}
                      {t.counterparty ? <span className="text-[#9A9A91]"> · {t.counterparty}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#555]">{t.bankAccount.name}</td>
                    <td className="px-3 py-2 text-xs text-[#666]">{CF_CATEGORY_LABEL[t.cfCategory as CfCategory]}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {inflow ? <span className="text-[#047857]">{fmt(t.amount)}</span> : <span className="text-[#D4D4CB]">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs">
                      {!inflow ? <span className="text-[#B91C1C]">{fmt(t.amount)}</span> : <span className="text-[#D4D4CB]">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.status === "posted" ? "bg-[#059669]" : "bg-[#D97706]"}`} />
                          <span className={`text-[11px] font-medium ${t.status === "posted" ? "text-[#047857]" : "text-[#B45309]"}`}>
                            {t.status === "posted" ? "Бичигдсэн" : "Ноорог"}
                          </span>
                        </div>
                        {t.status === "draft" && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(t)} className="h-6 px-2 text-[11px] font-medium text-[#1E3A5F] border border-[#C7D8EE] rounded hover:bg-[#EEF3FF] transition-colors bg-white">Засах</button>
                            <button onClick={() => handlePost(t.id)} className="h-6 px-2 text-[11px] font-medium text-[#047857] border border-[#BBF7D0] rounded hover:bg-[#ECFDF5] transition-colors bg-white">Батлах</button>
                            <button onClick={() => setDeleteTarget(t)} className="h-6 w-6 flex items-center justify-center text-[#C4C4BC] border border-[#E5E5DE] rounded hover:text-[#B91C1C] hover:border-[#FECACA] hover:bg-[#FFF5F5] transition-colors bg-white text-sm leading-none" title="Устгах">×</button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-1 mt-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="h-7 w-7 flex items-center justify-center rounded border border-[#E5E5DE] text-[#6B6B63] text-sm hover:bg-[#F4F4EE] disabled:opacity-40 transition-colors">‹</button>
          <span className="px-2 text-xs text-[#6B6B63]">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="h-7 w-7 flex items-center justify-center rounded border border-[#E5E5DE] text-[#6B6B63] text-sm hover:bg-[#F4F4EE] disabled:opacity-40 transition-colors">›</button>
        </div>
      )}

      {/* Form modal */}
      <Dialog open={formOpen} onOpenChange={(o) => !o && setFormOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Гүйлгээ засах" : "Гүйлгээ нэмэх"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Банкны данс</Label>
                <select value={form.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)} className="w-full h-9 px-2.5 text-sm border border-[#D4D4CB] rounded-md bg-white text-[#1A1A19] outline-none focus:border-[#1E3A5F]">
                  {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Огноо</Label>
                <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Чиглэл</Label>
                <select value={form.direction} onChange={(e) => set("direction", e.target.value as Direction)} className="w-full h-9 px-2.5 text-sm border border-[#D4D4CB] rounded-md bg-white text-[#1A1A19] outline-none focus:border-[#1E3A5F]">
                  {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Дүн</Label>
                <Input type="number" step="0.01" min="0" placeholder="0.00" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{form.direction === "inflow" ? "Эсрэг данс (орлого/авлага)" : "Эсрэг данс (зардал/өглөг)"}</Label>
              <select value={form.contraAccount} onChange={(e) => set("contraAccount", e.target.value)} className="w-full h-9 px-2.5 text-sm border border-[#D4D4CB] rounded-md bg-white text-[#1A1A19] outline-none focus:border-[#1E3A5F]">
                <option value="">— Сонгох —</option>
                {coa.map((c) => <option key={c.number} value={c.number}>{c.number} — {c.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Мөнгөн гүйлгээний ангилал (IAS 7)</Label>
              <select value={form.cfCategory} onChange={(e) => set("cfCategory", e.target.value as CfCategory)} className="w-full h-9 px-2.5 text-sm border border-[#D4D4CB] rounded-md bg-white text-[#1A1A19] outline-none focus:border-[#1E3A5F]">
                {CF_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Гүйлгээний утга</Label>
              <Input placeholder="Тайлбар" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Харьцагч</Label>
                <Input placeholder="(сонголт)" value={form.counterparty} onChange={(e) => set("counterparty", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Дугаар/Ишлэл</Label>
                <Input placeholder="(сонголт)" value={form.reference} onChange={(e) => set("reference", e.target.value)} />
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving !== null}>Болих</Button>
            <Button variant="outline" onClick={() => handleSave("draft")} disabled={saving !== null}>
              {saving === "draft" ? "Хадгалж байна..." : "Ноорог"}
            </Button>
            <Button className="bg-[#1E3A5F] hover:bg-[#15294A]" onClick={() => handleSave("posted")} disabled={saving !== null}>
              {saving === "posted" ? "Хадгалж байна..." : "Батлах"}
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
          <p className="text-sm text-[#333]">Энэ гүйлгээг устгах уу?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Болих</Button>
            <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={handleDelete}>Устгах</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
