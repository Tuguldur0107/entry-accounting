// Системийн хэмжээний үйлдлийн feedback — дуу + жижиг visual pulse + toast
// нэг дор. Дуу нь WebAudio-гоор шууд синтезлэгдэнэ (файл татахгүй, offline
// ажиллана) бөгөөд ҮРГЭЛЖ хэрэглэгчийн товч даралтын хариуд дуугардаг тул
// browser-ийн autoplay хориод өртөхгүй.
//
// Гурван түвшин:
//   feedback.saved()  — ноорог хадгалагдлаа: зөөлөн нэг "тик"
//   feedback.posted() — батлагдаж GL-д бичигдлээ: өгсөх хоёр нот + дарсан
//                       цэг дээр ногоон ✓ pulse (сүүлийн pointerdown-оос)
//   feedback.error()  — намуухан бүдүүн "бонк"
//
// Дуу localStorage-ийн "ea-sound"-оор унтарна (топбарын SoundToggle);
// visual pulse нь prefers-reduced-motion үед гарахгүй.

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

function play(kind: "saved" | "posted" | "error") {
  if (typeof window === "undefined" || !isSoundOn()) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
    const ctx = audioContext;
    if (kind === "saved") {
      // Нэг зөөлөн тик.
      tone(ctx, 660, 0, 0.09, 0.09);
    } else if (kind === "posted") {
      // Өгсөх хоёр нот — C5 → G5 "дин-дон".
      tone(ctx, 523.25, 0, 0.14, 0.1);
      tone(ctx, 783.99, 0.09, 0.2, 0.1);
    } else {
      // Намуухан бүдүүн бонк.
      tone(ctx, 220, 0, 0.12, 0.06, "square");
      tone(ctx, 180, 0.06, 0.12, 0.05, "square");
    }
  } catch {
    // Дуу гаргаж чадаагүй нь үйлдлийг хэзээ ч унагахгүй.
  }
}

// ── Дарсан цэг дээрх visual pulse ───────────────────────────────────────────

let lastPointer = { x: 0, y: 0 };
let pointerTracked = false;
let pulseStyleInjected = false;

function ensurePointerTracking() {
  if (pointerTracked || typeof window === "undefined") return;
  pointerTracked = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPointer = { x: event.clientX, y: event.clientY };
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
  /** Алдаа — намуухан бонк (+ toast). */
  error(message: string) {
    play("error");
    toast.error(message);
  },
};
