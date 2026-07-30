"use client";

// Хөрөнгө үүсгэх / картыг бөглөж идэвхжүүлэх форм панель.
// Payload: { assetId?: string } — өгвөл идэвхжүүлэлт (prefill), өгөхгүй бол
// шинэ хөрөнгө. Сегментийн сонголт + prefill-ээ getFaAssetPanelData server
// action-аар татна. Формын dirty төлвийг setDirty(panel.id, ...)-д мэдэгдэнэ;
// амжилттай хадгалбал closePanel + router.refresh(), алдаа бол панель
// нээлттэй үлдэж inline мессеж үзүүлнэ.

import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AccountInput } from "@/components/account/account-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  activateFixedAsset,
  createFixedAsset,
  getFaAssetPanelData,
  type FaAssetPanelData,
} from "@/lib/actions/fa";
import { DEPRECIATION_METHODS } from "@/lib/fa/depreciation";
import { buildSegCode } from "@/lib/grid/segments";
import { extractMainAccount, fmtMnt } from "@/lib/reports/balances";
import {
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Хөрөнгийн карт олдсонгүй. Устгагдсан байж болзошгүй.",
  "not-draft": "Зөвхөн ноорог картыг бөглөж идэвхжүүлнэ.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

interface AssetForm {
  code: string;
  name: string;
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  usefulLifeMonths: string;
  depreciationMethod: string;
  custodian: string;
  depreciationStartMonth: string;
  assetAccountNumber: string;
  accumDepAccountNumber: string;
  depExpenseAccountNumber: string;
}

// Prefill: идэвхжүүлэлтэд картын утгууд, шинэд анхдагч дансууд. AccountInput
// бүтэн 10-part код хүлээдэг тул main дансыг default сегментүүдээр ороож өгнө.
function buildInitialForm(data: FaAssetPanelData): AssetForm {
  const { asset, activeSegIds, defaultSegments } = data;
  const withSegs = (main: string) =>
    buildSegCode({ ...defaultSegments, 3: main }, activeSegIds, defaultSegments);

  if (asset)
    return {
      code: asset.code,
      name: asset.name,
      acquisitionDate: asset.acquisitionDate,
      cost: String(asset.cost),
      salvageValue: String(asset.salvageValue),
      usefulLifeMonths: String(asset.usefulLifeMonths || 36),
      depreciationMethod: asset.depreciationMethod || "straight_line",
      custodian: asset.custodian ?? "",
      depreciationStartMonth:
        asset.depreciationStartMonth ?? asset.acquisitionDate.slice(0, 7),
      assetAccountNumber: withSegs(asset.assetAccountNumber),
      accumDepAccountNumber: withSegs(asset.accumDepAccountNumber),
      depExpenseAccountNumber: withSegs(asset.depExpenseAccountNumber),
    };

  return {
    code: "",
    name: "",
    acquisitionDate: new Date().toISOString().slice(0, 10),
    cost: "",
    salvageValue: "0",
    usefulLifeMonths: "36",
    depreciationMethod: "straight_line",
    custodian: "",
    depreciationStartMonth: new Date().toISOString().slice(0, 7),
    assetAccountNumber: withSegs("21010000"),
    accumDepAccountNumber: withSegs("21000099"),
    depExpenseAccountNumber: withSegs("70000001"),
  };
}

export function FaAssetFormPanel({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  /** Панелийн хаалт — dirty бол баталгаажуулалттай (PanelHost эзэмшинэ). */
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);

  const assetId = panel.payload.assetId as string | undefined;
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: FaAssetPanelData; loadedToken: number }
  >({ status: "loading" });

  // Эхний ачаалалт + сэргээх/дахин нээх бүрд дахин татна. Хэрэглэгч бөглөж
  // эхэлсэн (dirty) бол бичсэнийг нь дарж болохгүй тул алгасна.
  useEffect(() => {
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getFaAssetPanelData(assetId)
      .then((result) => {
        if (cancelled) return;
        // Fetch явж байх зуур хэрэглэгч бөглөж эхэлсэн бол хариуг хаяна —
        // key remount бичсэнийг нь арчих байсан.
        const now = usePanelStore
          .getState()
          .panels.find((entry) => entry.id === panel.id);
        if (now?.dirty) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        const asset = result.data.asset;
        if (assetId && asset && asset.status !== "draft") {
          setState({ status: "error", message: ERROR_MESSAGES["not-draft"] });
          return;
        }
        setState({ status: "ready", data: result.data, loadedToken: refreshToken });
        setTitle(
          panel.id,
          asset ? `Идэвхжүүлэх · ${asset.name}` : "Шинэ үндсэн хөрөнгө"
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, refreshToken, panel.id, setTitle]);

  if (state.status === "loading")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center gap-2 text-sm text-[var(--ea-text-3)]">
        <Icon name="loading" className="animate-spin" />
        Ачаалж байна…
      </div>
    );

  if (state.status === "error")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--ea-danger)]">
        {state.message}
      </div>
    );

  return (
    <FaAssetFormBody
      // Шинэ өгөгдөл татагдмагц формыг цэвэрхэн remount хийнэ — доторх
      // draft state найдвартай шинэчлэгдэнэ.
      key={state.loadedToken}
      panel={panel}
      data={state.data}
      requestClose={requestClose}
    />
  );
}

function FaAssetFormBody({
  panel,
  data,
  requestClose,
}: {
  panel: PanelInstance;
  data: FaAssetPanelData;
  requestClose: () => void;
}) {
  const router = useRouter();
  const closePanel = usePanelStore((state) => state.closePanel);
  const setDirty = usePanelStore((state) => state.setDirty);
  const [isPending, startTransition] = useTransition();

  const activatingId = data.asset?.id ?? null;
  const [form, setForm] = useState<AssetForm>(() => buildInitialForm(data));
  const [error, setError] = useState("");

  // Хадгалаагүй өөрчлөлтийн хамгаалалт — эхний render-ийн snapshot-той
  // харьцуулна (lazy useState нь ref-ээс ялгаатай render-цэвэр).
  const currentSnapshot = JSON.stringify(form);
  const [initialSnapshot] = useState(currentSnapshot);
  const dirty = currentSnapshot !== initialSnapshot;

  useEffect(() => {
    setDirty(panel.id, dirty);
  }, [dirty, panel.id, setDirty]);

  function save() {
    setError("");
    startTransition(async () => {
      try {
        const payload = {
          code: form.code || undefined,
          name: form.name,
          acquisitionDate: form.acquisitionDate,
          cost: Number(form.cost.replaceAll(",", "")),
          salvageValue: Number(form.salvageValue.replaceAll(",", "")) || 0,
          usefulLifeMonths: Number(form.usefulLifeMonths),
          depreciationMethod: form.depreciationMethod,
          custodian: form.custodian,
          depreciationStartMonth: form.depreciationStartMonth,
          // AccountInput бүтэн код буцаана — картад main дансыг хадгална.
          assetAccountNumber: extractMainAccount(form.assetAccountNumber),
          accumDepAccountNumber: extractMainAccount(form.accumDepAccountNumber),
          depExpenseAccountNumber: extractMainAccount(
            form.depExpenseAccountNumber
          ),
        };
        if (activatingId) await activateFixedAsset(activatingId, payload);
        else await createFixedAsset(payload);
        toast.success(
          activatingId
            ? "Карт идэвхжлээ — элэгдэлд хамрагдана"
            : "Хөрөнгө бүртгэгдлээ"
        );
        // Бүтэн reload биш — зөвхөн серверийн өгөгдлийг сэргээнэ. Хажууд
        // нээлттэй хөрөнгийн картын панель мөн шинэ төлөвөө татна —
        // эс бөгөөс "Ноорог" + идэвхжүүлэх товчоо үзүүлсээр үлддэг.
        closePanel(panel.id);
        refreshOpenPanels();
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Хадгалж чадсангүй"
        );
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto grid w-full max-w-2xl gap-4">
          {data.asset && (
            <p className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-3)]">
              <span className="font-mono">{data.asset.code}</span> — өртөг{" "}
              <span className="font-mono">{fmtMnt(data.asset.cost)}</span> эх
              сувагтаа данслагдсан; идэвхжүүлэлт GL бичихгүй.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Код">
              <Input
                value={form.code}
                disabled={!!activatingId}
                placeholder="Хоосон бол автоматаар үүснэ"
                maxLength={40}
                onChange={(e) =>
                  setForm((c) => ({ ...c, code: e.target.value }))
                }
              />
            </Field>
            <Field label="Нэр">
              <Input
                value={form.name}
                placeholder="Хөрөнгийн нэр"
                onChange={(e) =>
                  setForm((c) => ({ ...c, name: e.target.value }))
                }
              />
            </Field>
            <Field label="Эзэмшигч (хариуцагч)">
              <Input
                value={form.custodian}
                placeholder="Ажилтан, хэлтэс..."
                maxLength={120}
                onChange={(e) =>
                  setForm((c) => ({ ...c, custodian: e.target.value }))
                }
              />
            </Field>
            <Field label="Авсан огноо">
              <Input
                type="date"
                value={form.acquisitionDate}
                onChange={(e) =>
                  setForm((c) => ({ ...c, acquisitionDate: e.target.value }))
                }
              />
            </Field>
            <Field label="Өртөг (MNT)">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={form.cost}
                disabled={!!activatingId}
                placeholder="0.00"
                onChange={(e) =>
                  setForm((c) => ({ ...c, cost: e.target.value }))
                }
              />
            </Field>
            <Field label="Үлдэх өртөг (MNT)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.salvageValue}
                onChange={(e) =>
                  setForm((c) => ({ ...c, salvageValue: e.target.value }))
                }
              />
            </Field>
            <Field label="Ашиглалтын хугацаа (сар)">
              <Input
                type="number"
                min="1"
                step="1"
                value={form.usefulLifeMonths}
                onChange={(e) =>
                  setForm((c) => ({ ...c, usefulLifeMonths: e.target.value }))
                }
              />
            </Field>
            <Field label="Элэгдлийн арга">
              <SearchableSelect
                value={form.depreciationMethod}
                onChange={(value) =>
                  value && setForm((c) => ({ ...c, depreciationMethod: value }))
                }
                options={DEPRECIATION_METHODS.map((method) => ({
                  value: method.id,
                  label: method.label,
                }))}
                placeholder="Арга сонгох..."
                hideValue
              />
            </Field>
            <Field label="Элэгдэл эхлэх сар">
              <Input
                type="month"
                value={form.depreciationStartMonth}
                onChange={(e) =>
                  setForm((c) => ({
                    ...c,
                    depreciationStartMonth: e.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <Field label="Өртгийн данс (2Х)">
            <AccountInput
              value={form.assetAccountNumber}
              onChange={(value) =>
                setForm((c) => ({ ...c, assetAccountNumber: value }))
              }
              activeSegIds={data.activeSegIds}
              segmentOptions={data.segmentOptions}
              defaultSegments={data.defaultSegments}
              placeholder="Өртгийн данс..."
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Хуримтлагдсан элэгдлийн данс">
              <AccountInput
                value={form.accumDepAccountNumber}
                onChange={(value) =>
                  setForm((c) => ({ ...c, accumDepAccountNumber: value }))
                }
                activeSegIds={data.activeSegIds}
                segmentOptions={data.segmentOptions}
                defaultSegments={data.defaultSegments}
                placeholder="Хуримт. элэгдлийн данс..."
              />
            </Field>
            <Field label="Элэгдлийн зардлын данс">
              <AccountInput
                value={form.depExpenseAccountNumber}
                onChange={(value) =>
                  setForm((c) => ({ ...c, depExpenseAccountNumber: value }))
                }
                activeSegIds={data.activeSegIds}
                segmentOptions={data.segmentOptions}
                defaultSegments={data.defaultSegments}
                placeholder="Зардлын данс..."
              />
            </Field>
          </div>
          {error && (
            <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
              {error}
            </p>
          )}
        </div>
      </div>

      <footer
        className="flex shrink-0 items-center justify-end gap-2 px-4 py-3"
        style={{ borderTop: "1px solid var(--ea-border)" }}
      >
        <Button variant="outline" onClick={requestClose} disabled={isPending}>
          Болих
        </Button>
        <Button onClick={save} disabled={isPending}>
          <Icon name="approve" />
          {activatingId ? "Идэвхжүүлэх" : "Бүртгэх"}
        </Button>
      </footer>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
