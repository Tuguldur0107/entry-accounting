// П17 — Хадгалсан харагдац (saved views): grid-ийн шүүлт + эрэмбийг
// нэрлэж хадгалах, URL-д кодлох. Кодлолт нь base64url(JSON) тул deep link
// хуваалцахад аюулгүй; нэртэй хадгалалт localStorage-д surface тус бүрээр.
//
// Дүрэм: decode нь ЯМАР Ч алдаанд null буцаана (эвдэрсэн/хуучин линк
// хуудсыг унагахгүй); хувилбар (v) таарахгүй бол мөн null.

export interface GridViewState {
  v: 1;
  /** AG Grid filterModel (api.getFilterModel). */
  f: Record<string, unknown>;
  /** Эрэмбийн багана: colId + sort (+ дараалал). */
  c: { colId: string; sort: "asc" | "desc"; sortIndex?: number }[];
}

export interface SavedView {
  name: string;
  encoded: string;
}

const STORAGE_PREFIX = "ea-saved-views:";
const MAX_VIEWS_PER_SURFACE = 20;

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeViewState(state: Omit<GridViewState, "v">): string {
  const payload: GridViewState = { v: 1, f: state.f, c: state.c };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeViewState(encoded: string): GridViewState | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as GridViewState;
    if (parsed?.v !== 1) return null;
    if (typeof parsed.f !== "object" || parsed.f === null) return null;
    if (!Array.isArray(parsed.c)) return null;
    for (const entry of parsed.c) {
      if (typeof entry?.colId !== "string") return null;
      if (entry.sort !== "asc" && entry.sort !== "desc") return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function storageKey(surfaceId: string): string {
  return `${STORAGE_PREFIX}${surfaceId}`;
}

export function listSavedViews(surfaceId: string): SavedView[] {
  try {
    const raw = localStorage.getItem(storageKey(surfaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedView[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (view) =>
        typeof view?.name === "string" && typeof view?.encoded === "string"
    );
  } catch {
    return [];
  }
}

export function saveSavedView(
  surfaceId: string,
  name: string,
  encoded: string
): SavedView[] {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return listSavedViews(surfaceId);
  const views = listSavedViews(surfaceId).filter(
    (view) => view.name !== trimmed
  );
  views.unshift({ name: trimmed, encoded });
  const limited = views.slice(0, MAX_VIEWS_PER_SURFACE);
  try {
    localStorage.setItem(storageKey(surfaceId), JSON.stringify(limited));
  } catch {
    /* private mode г.м — session дотроо л үйлчилнэ */
  }
  return limited;
}

export function deleteSavedView(surfaceId: string, name: string): SavedView[] {
  const views = listSavedViews(surfaceId).filter((view) => view.name !== name);
  try {
    localStorage.setItem(storageKey(surfaceId), JSON.stringify(views));
  } catch {
    /* ignore */
  }
  return views;
}
