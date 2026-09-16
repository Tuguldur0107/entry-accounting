// Системийн хэмжээний үйлдлийн feedback — дуу + жижиг visual pulse + toast
// нэг дор. Дуу нь WebAudio-гоор шууд синтезлэгдэнэ (файл татахгүй, offline
// ажиллана) бөгөөд ҮРГЭЛЖ хэрэглэгчийн товч даралтын хариуд дуугардаг тул
// browser-ийн autoplay хориод өртөхгүй.
//
// Дөрвөн түвшин:
//   клик              — ДАРАХ БҮРТ (товч, линк, таб, мөр, cursor:pointer
//                       элемент): маш богино зөөлөн "тик" — pointerdown-ы
//                       дотор шууд тоглодог тул хамгийн найдвартай
//   feedback.saved()  — ноорог хадгалагдлаа: зөөлөн нэг "тик"
//   feedback.posted() — батлагдаж GL-д бичигдлээ: өгсөх хоёр нот + дарсан
//                       цэг дээр ногоон ✓ pulse (сүүлийн pointerdown-оос)
//   feedback.error()  — намуухан бүдүүн "бонк"
//
// Дуу localStorage-ийн "ea-sound"-оор унтарна (топбарын SoundToggle — клик
// дуу ч мөн адил); visual pulse нь prefers-reduced-motion үед гарахгүй.
//
// Сонсогдохгүй байсан шалтгаан (2026-09): дуунууд −20 dB, 90 мс байсан тул
// Bluetooth чихэвч / лаптопын спикерийн "сэрэх" саатал бүхэлд нь залгидаг
// байв. Одоо чангалж, уртасгаж, даралтын агшинд гаралтыг халаадаг (warmUp).

import { toast } from "sonner";

const STORAGE_KEY = "ea-sound";
const listeners = new Set<() => void>();

export function isSoundOn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) !== "off";
}

export function setSoundOn(on: boolean) {
  window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  listeners.forEach((listener) => listener());
}

/** useSyncExternalStore-д зориулсан subscribe (SoundToggle ашиглана). */
export function subscribeSound(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── Дууны синтез ────────────────────────────────────────────────────────────

let audioContext: AudioContext | null = null;
let warmedUp = false;

/** Ажиллах context буцаана; хаагдсан/тасалдсан бол шинээр үүсгэнэ. */
function ensureContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  // Safari аудио төхөөрөмж солигдоход "interrupted", зарим үед "closed"
  // төлөвт гацдаг — resume() тэднийг сэргээхгүй тул шинээр үүсгэнэ.
  const state = audioContext?.state as string | undefined;
  if (!audioContext || state === "closed" || state === "interrupted") {
    audioContext = new AudioContext();
    warmedUp = false;
  }
  if (audioContext.state !== "running") void audioContext.resume();
  return audioContext;
}

/**
 * Гаралтын төхөөрөмжийг "халаана": Bluetooth чихэвч, зарим спикер чимээгүй
 * байснаас сэрэхдээ эхний 100–300 мс-ийг залгидаг — богино тик бүхэлдээ алга
 * болдог. Даралтын агшинд чимээгүй buffer тоглуулснаар (iOS unlock-ийн ч
 * стандарт арга) дараагийн жинхэнэ дуу бүтэн сонсогдоно.
 */
function warmUp(ctx: AudioContext) {
  if (warmedUp) return;
  warmedUp = true;
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
}

function tone(
  ctx: AudioContext,
  frequency: number,
  startOffset: number,
  duration: number,
  peak: number,
  type: OscillatorType = "sine"
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + startOffset;
  osc.type = type;
  osc.frequency.value = frequency;
  // Зөөлөн атак + экспоненциал сулрал — "шуугиангүй" мэдрэмж.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function play(kind: "click" | "saved" | "posted" | "error") {
  if (!isSoundOn()) return;
  try {
    const ctx = ensureContext();
    if (!ctx) return;
    warmUp(ctx);
    if (kind === "click") {
      // Маш богино өндөр тик — гар утасны товчлуурын дуу шиг.
      tone(ctx, 1800, 0, 0.04, 0.16, "triangle");
    } else if (kind === "saved") {
      // Нэг зөөлөн тик.
      tone(ctx, 660, 0, 0.16, 0.22);
    } else if (kind === "posted") {
      // Өгсөх хоёр нот — C5 → G5 "дин-дон".
      tone(ctx, 523.25, 0, 0.22, 0.25);
      tone(ctx, 783.99, 0.12, 0.32, 0.25);
    } else {
      // Намуухан бүдүүн бонк.
      tone(ctx, 220, 0, 0.16, 0.18, "square");
      tone(ctx, 180, 0.08, 0.18, 0.15, "square");
    }
  } catch {
    // Дуу гаргаж чадаагүй нь үйлдлийг хэзээ ч унагахгүй.
  }
}

// ── Дарсан цэг дээрх visual pulse ───────────────────────────────────────────

let lastPointer = { x: 0, y: 0 };
let pointerTracked = false;
let pulseStyleInjected = false;

const CLICKABLE_SELECTOR = [
  "button",
  "a[href]",
  "summary",
  "label",
  "select",
  "option",
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="button"]',
  'input[type="submit"]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="row"]',
  '[role="gridcell"]',
  ".ag-cell",
  ".ag-header-cell",
  "[data-sound]",
].join(",");

/**
 * Дарсан элемент "дарагдах зүйл" мөн үү — жагсаалтын элемент ЭСВЭЛ
 * cursor:pointer-тэй (div onClick-тэй карт, панелийн мөр г.м.). Хоосон
 * зай, текст сонгох, талбарт бичих дээр дуугарахгүй.
 */
function isClickable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(CLICKABLE_SELECTOR)) return true;
  let el: Element | null = target;
  for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
    if (getComputedStyle(el).cursor === "pointer") return true;
  }
  return false;
}

function ensurePointerTracking() {
  if (pointerTracked || typeof window === "undefined") return;
  pointerTracked = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPointer = { x: event.clientX, y: event.clientY };
      if (!isSoundOn()) return;
      // Дарах бүрийн клик дуу — ЭНД (хэрэглэгчийн жинхэнэ даралтын дотор)
      // тоглох тул browser autoplay бодлогод орохгүй; мөн context үүсч,
      // сэрж, халагдана — амжилтын дуу server хариуны ДАРАА тоглодог тул
      // тэр үед үүсгэвэл suspended орхигдож дуу гардаггүй байв.
      if (event.button <= 0 && isClickable(event.target)) {
        play("click");
        return;
      }
      try {
        const ctx = ensureContext();
        if (ctx) warmUp(ctx);
      } catch {
        // Дуу боломжгүй орчинд чимээгүй өнгөрнө.
      }
    },
    { capture: true, passive: true }
  );
}

function ensurePulseStyle() {
  if (pulseStyleInjected || typeof document === "undefined") return;
  pulseStyleInjected = true;
  const style = document.createElement("style");
  style.textContent = `
@keyframes ea-post-pulse-ring {
  0% { transform: translate(-50%, -50%) scale(0.4); opacity: 0.85; }
  100% { transform: translate(-50%, -50%) scale(2.1); opacity: 0; }
}
@keyframes ea-post-pulse-check {
  0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
  30% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
  70% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(0.9) translateY(-6px); opacity: 0; }
}
.ea-post-pulse { position: fixed; z-index: 9999; pointer-events: none; }
.ea-post-pulse .ring {
  position: absolute; left: 0; top: 0; width: 34px; height: 34px;
  border: 2px solid var(--ea-success, #22c55e); border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: ea-post-pulse-ring 550ms ease-out forwards;
}
.ea-post-pulse .check {
  position: absolute; left: 0; top: 0;
  color: var(--ea-success, #22c55e); font-size: 15px; font-weight: 700;
  transform: translate(-50%, -50%);
  text-shadow: 0 1px 4px rgba(0,0,0,0.25);
  animation: ea-post-pulse-check 650ms ease-out forwards;
}
@media (prefers-reduced-motion: reduce) {
  .ea-post-pulse { display: none; }
}`;
  document.head.appendChild(style);
}

/** Сүүлийн даралтын цэг дээр ногоон ✓ pulse — post амжилтын дохио. */
function pulseAtPointer() {
  if (typeof document === "undefined") return;
  ensurePulseStyle();
  if (!lastPointer.x && !lastPointer.y) return;
  const host = document.createElement("div");
  host.className = "ea-post-pulse";
  host.style.left = `${lastPointer.x}px`;
  host.style.top = `${lastPointer.y}px`;
  host.innerHTML = `<span class="ring"></span><span class="check">✓</span>`;
  document.body.appendChild(host);
  window.setTimeout(() => host.remove(), 750);
}

// Import хийгдмэгц (client талд) даралтын байрлалыг мөрдөж эхэлнэ.
if (typeof window !== "undefined") ensurePointerTracking();

// ── Нийтийн API ─────────────────────────────────────────────────────────────

export const feedback = {
  /** Ноорог/тохиргоо хадгалагдсан — зөөлөн тик (+ toast, message өгвөл). */
  saved(message?: string) {
    play("saved");
    if (message) toast.success(message);
  },
  /** Батлагдаж GL-д бичигдсэн — дин-дон + дарсан цэгт ✓ pulse. */
  posted(message?: string) {
    play("posted");
    pulseAtPointer();
    if (message) toast.success(message);
  },
  /** Алдаа — намуухан бонк; message өгвөл toast-оор ч харуулна (inline
   *  алдаа үзүүлдэг формд message-гүй дуудаж зөвхөн дуугаргана). */
  error(message?: string) {
    play("error");
    if (message) toast.error(message);
  },
};
