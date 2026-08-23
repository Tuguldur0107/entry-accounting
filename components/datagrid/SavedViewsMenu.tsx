"use client";

// П17 — Хадгалсан харагдацын цэс: grid-ийн одоогийн шүүлт+эрэмбийг нэрлэж
// хадгалах, нэг даралтаар сэргээх, ?view= параметрээр хуваалцах. Аль ч
// жагсаалтын хуудсанд gridRef + surfaceId өгөөд суулгана.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Dropdown,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  decodeViewState,
  deleteSavedView,
  encodeViewState,
  listSavedViews,
  saveSavedView,
  type GridViewState,
  type SavedView,
} from "@/lib/grid/saved-views";

interface Props {
  /** localStorage-ийн түлхүүр — surface бүрд давтагдашгүй (ж: "gl-journal"). */
  surfaceId: string;
  gridRef: React.RefObject<DataGridHandle | null>;
}

export function SavedViewsMenu({ surfaceId, gridRef }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  // Нэртэй хадгалалтууд localStorage-оос — lazy init (SSR-д хоосон,
  // hydration-ы дараах эхний render-т бодит утга).
  const [views, setViews] = useState<SavedView[]>(() =>
    typeof window === "undefined" ? [] : listSavedViews(surfaceId)
  );
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [activeEncoded, setActiveEncoded] = useState<string | null>(null);

  const applyState = useCallback(
    (state: GridViewState) => {
      const api = gridRef.current?.api;
      if (!api || api.isDestroyed()) return false;
      api.setFilterModel(state.f);
      api.applyColumnState({
        state: state.c,
        defaultState: { sort: null },
      });
      return true;
    },
    [gridRef]
  );

  const syncUrl = useCallback(
    (encoded: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (encoded) params.set("view", encoded);
      else params.delete("view");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
      setActiveEncoded(encoded);
    },
    [router, pathname, searchParams]
  );

  // ?view= deep link — grid бэлэн болмогц нэг удаа хэрэглэнэ (AG Grid
  // dynamic ачаалагддаг тул api гартал богино retry).
  const appliedFromUrl = useRef(false);
  useEffect(() => {
    if (appliedFromUrl.current) return;
    const encoded = searchParams.get("view");
    if (!encoded) return;
    const state = decodeViewState(encoded);
    if (!state) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (applyState(state)) {
        appliedFromUrl.current = true;
        setActiveEncoded(encoded);
        clearInterval(timer);
      } else if (attempts > 25) {
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [searchParams, applyState]);

  function captureCurrent(): string | null {
    const api = gridRef.current?.api;
    if (!api || api.isDestroyed()) return null;
    const sortEntries = api
      .getColumnState()
      .filter((column) => column.sort === "asc" || column.sort === "desc")
      .map((column) => ({
        colId: column.colId,
        sort: column.sort as "asc" | "desc",
        sortIndex: column.sortIndex ?? undefined,
      }));
    return encodeViewState({
      f: api.getFilterModel() ?? {},
      c: sortEntries,
    });
  }

  function handleSave() {
    const encoded = captureCurrent();
    if (!encoded) {
      toast.error("Хүснэгт бэлэн болоогүй байна");
      return;
    }
    setViews(saveSavedView(surfaceId, saveName, encoded));
    syncUrl(encoded);
    setSaveOpen(false);
    setSaveName("");
    toast.success("Харагдац хадгалагдлаа — URL-ыг хуваалцаж болно");
  }

  function handleApply(view: SavedView) {
    const state = decodeViewState(view.encoded);
    if (!state) {
      toast.error("Энэ харагдацын өгөгдөл эвдэрсэн байна");
      return;
    }
    if (!applyState(state)) {
      toast.error("Хүснэгт бэлэн болоогүй байна");
      return;
    }
    syncUrl(view.encoded);
    setOpen(false);
  }

  function handleReset() {
    const api = gridRef.current?.api;
    if (api && !api.isDestroyed()) {
      api.setFilterModel(null);
      api.applyColumnState({ defaultState: { sort: null } });
    }
    syncUrl(null);
    setOpen(false);
  }

  function handleDelete(name: string) {
    setViews(deleteSavedView(surfaceId, name));
  }

  return (
    <>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        panelClassName="w-64"
        trigger={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Icon name="checklist" size="sm" />
            Харагдац
            {views.length > 0 && (
              <span className="text-[var(--ea-text-4)]">({views.length})</span>
            )}
          </Button>
        }
      >
        <DropdownLabel>Хадгалсан харагдац</DropdownLabel>
        {views.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-[var(--ea-text-4)]">
            Шүүлт, эрэмбээ тохируулаад хадгалаарай.
          </p>
        ) : (
          views.map((view) => (
            <div key={view.name} className="flex items-center gap-1">
              <DropdownItem
                selected={view.encoded === activeEncoded}
                className="min-w-0 flex-1"
                onSelect={() => handleApply(view)}
              >
                <span className="truncate">{view.name}</span>
              </DropdownItem>
              <button
                type="button"
                title={`«${view.name}» устгах`}
                aria-label={`«${view.name}» харагдац устгах`}
                onClick={() => handleDelete(view.name)}
                className="shrink-0 rounded p-1 text-[var(--ea-text-4)] transition-colors hover:text-[var(--ea-danger)]"
              >
                <Icon name="delete" size="sm" />
              </button>
            </div>
          ))
        )}
        <DropdownSeparator />
        <DropdownItem
          onSelect={() => {
            setOpen(false);
            setSaveOpen(true);
          }}
        >
          <Icon name="save" size="sm" />
          Одоогийн харагдацыг хадгалах…
        </DropdownItem>
        <DropdownItem
          className="text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]"
          onSelect={handleReset}
        >
          <Icon name="reset" size="sm" />
          Анхдагч харагдац
        </DropdownItem>
      </Dropdown>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Харагдац хадгалах</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="saved-view-name">Нэр</Label>
            <Input
              id="saved-view-name"
              value={saveName}
              maxLength={60}
              placeholder="Жишээ: Батлагдаагүй бичилтүүд"
              onChange={(event) => setSaveName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && saveName.trim()) handleSave();
              }}
            />
            <p className="text-[11px] text-[var(--ea-text-4)]">
              Одоогийн шүүлт, эрэмбэ хадгалагдана; URL-д кодлогдох тул линкийг
              хуваалцаж болно.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Болих
            </Button>
            <Button onClick={handleSave} disabled={!saveName.trim()}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
