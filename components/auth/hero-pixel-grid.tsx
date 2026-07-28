"use client";

// Auth hero panel-ийн чимэглэл — 64×64 = 4096 ширхэг шилэн нүдний самбар.
// Нүднүүд бүлгээрээ асаж ДҮРС бүтээнэ (баганан диаграм, өсөлтийн шугам, ₮,
// баримт, хүснэгт, зоос), дараа нь дараагийн дүрс рүү аажим шилжинэ.
//
// Гүйцэтгэл: 4096 нүдийг React нэг л удаа рендерлэнэ. Асаах/унтраахдаа
// React re-render хийхгүй — DOM-ыг шууд (opacity) өөрчилнө.
//
// SSR-safe: эхний рендер бүх нүд унтарсан (детерминистик) тул hydration
// mismatch гарахгүй. prefers-reduced-motion үед нэг дүрс статикаар үлдэнэ.

import { useEffect, useRef } from "react";

const N = 64; // 64×64 ширхэг
const CELLS = N * N;

/* ── Дүрс зурах туслахууд (координат: 0..63, x баруун, y доош) ───────────── */

const rect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** (x,y) цэг нь (x0,y0)-(x1,y1) хэрчмээс w зайд байна уу */
function nearSegment(
  x: number, y: number,
  x0: number, y0: number, x1: number, y1: number,
  w: number
) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
  const px = x0 + t * dx, py = y0 + t * dy;
  return Math.hypot(x - px, y - py) <= w;
}

const ring = (x: number, y: number, cx: number, cy: number, r: number, w: number) =>
  Math.abs(Math.hypot(x - cx, y - cy) - r) <= w;

type Shape = (x: number, y: number) => boolean;

/* ── Дүрсүүд ─────────────────────────────────────────────────────────────── */

// Баганан диаграм
const barChart: Shape = (x, y) => {
  const bars: [number, number][] = [[10, 18], [20, 30], [30, 24], [40, 40], [50, 33]];
  for (const [bx, h] of bars) {
    if (rect(x, y, bx, 52 - h, bx + 7, 52)) return true;
  }
  return rect(x, y, 8, 54, 58, 55) || rect(x, y, 8, 12, 9, 55);
};

// Өсөлтийн шугам + сум
const trendLine: Shape = (x, y) => {
  const pts: [number, number][] = [[10, 44], [22, 36], [32, 40], [44, 24], [54, 16]];
  for (let i = 0; i < pts.length - 1; i++) {
    if (nearSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1.3)) return true;
  }
  // сумны хошуу
  if (nearSegment(x, y, 54, 16, 46, 17, 1.2)) return true;
  if (nearSegment(x, y, 54, 16, 53, 25, 1.2)) return true;
  return rect(x, y, 8, 50, 58, 51);
};

// Тэмдэглэгээ ✓
const checkMark: Shape = (x, y) =>
  nearSegment(x, y, 18, 33, 28, 43, 2.2) || nearSegment(x, y, 28, 43, 47, 20, 2.2);

// Төгрөгийн тэмдэг ₮
const tugrik: Shape = (x, y) =>
  rect(x, y, 18, 14, 46, 18) ||   // дээд зураас
  rect(x, y, 30, 14, 34, 50) ||   // босоо
  rect(x, y, 22, 24, 42, 27) ||   // 1-р огтлол
  rect(x, y, 22, 33, 42, 36);     // 2-р огтлол

// Баримт / нэхэмжлэл
const document_: Shape = (x, y) => {
  const border =
    (rect(x, y, 20, 10, 44, 11) || rect(x, y, 20, 10, 21, 52) || rect(x, y, 43, 10, 44, 52)) ||
    // доод ирмэг — шүдлэг
    (y >= 50 && y <= 52 && x >= 20 && x <= 44 && (x % 4 < 2 ? y <= 51 : y >= 51));
  const lines = [18, 25, 32, 39].some((ly) => rect(x, y, 25, ly, 39, ly + 1));
  return border || lines;
};

// Хүснэгт
const table: Shape = (x, y) => {
  const outer = rect(x, y, 10, 12, 54, 13) || rect(x, y, 10, 50, 54, 51) ||
                rect(x, y, 10, 12, 11, 51) || rect(x, y, 53, 12, 54, 51);
  const rows = [21, 30, 39].some((ly) => rect(x, y, 10, ly, 54, ly + 1));
  const cols = [26, 40].some((lx) => rect(x, y, lx, 12, lx + 1, 51));
  return outer || rows || cols;
};

// Зоос
const coin: Shape = (x, y) =>
  ring(x, y, 32, 32, 19, 1.6) ||
  rect(x, y, 24, 24, 40, 26) ||
  rect(x, y, 30, 24, 34, 42) ||
  rect(x, y, 26, 31, 38, 33);

export const SHAPES: Shape[] = [barChart, trendLine, checkMark, tugrik, document_, table, coin];

/** Дүрсийг 4096 элементтэй boolean массив болгоно */
export function rasterize(shape: Shape): boolean[] {
  const out = new Array<boolean>(CELLS);
  for (let i = 0; i < CELLS; i++) {
    out[i] = shape(i % N, Math.floor(i / N));
  }
  return out;
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function HeroPixelGrid({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const cells = host.children as HTMLCollectionOf<HTMLElement>;

    const patterns = SHAPES.map(rasterize);
    const state = new Array<boolean>(CELLS).fill(false);

    // Унтарсан нүд ч харагдана — зөвхөн дэвсгэр нь шил ↔ гэрэл болж солигдоно
    const paint = (i: number, on: boolean) => {
      state[i] = on;
      cells[i].style.backgroundColor = on
        ? "var(--ea-hero-fg)"
        : "var(--ea-hero-surface)";
    };

    // Хөдөлгөөн багасгах горим — эхний дүрсийг статикаар үзүүлээд зогсоно
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      patterns[0].forEach((on, i) => on && paint(i, true));
      return;
    }

    let shapeIdx = 0;
    let target = patterns[0];
    let holdUntil = 0;

    // Шилжилтийн дараалал — санамсаргүй боловч тогтвортой (нэг дүрсэнд нэг л удаа)
    let queue: number[] = [];
    const rebuildQueue = () => {
      queue = [];
      for (let i = 0; i < CELLS; i++) if (state[i] !== target[i]) queue.push(i);
      // Fisher–Yates — органик тарааж асаах
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    };
    rebuildQueue();

    let raf = 0;
    const step = (now: number) => {
      raf = requestAnimationFrame(step);

      if (queue.length === 0) {
        if (!holdUntil) holdUntil = now + 2200;      // дүрсээ барих хугацаа
        if (now < holdUntil) return;
        holdUntil = 0;
        shapeIdx = (shapeIdx + 1) % patterns.length;
        target = patterns[shapeIdx];
        rebuildQueue();
        return;
      }

      // Кадр бүрд хэсэг нүдийг зорилтот төлөв рүү шилжүүлнэ
      const batch = Math.max(12, Math.ceil(queue.length / 26));
      for (let k = 0; k < batch && queue.length; k++) {
        const i = queue.pop()!;
        paint(i, target[i]);
      }
    };
    raf = requestAnimationFrame(step);

    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      aria-hidden="true"
      className={className}
      ref={hostRef}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${N}, 1fr)`,
        gap: 1,
        width: "100%",
        maxWidth: 420,
        aspectRatio: "1",
        margin: "0 auto",
        // Бүх самбар шилэн — унтарсан нүд шил хэвээрээ харагдана
        backdropFilter: "blur(6px) saturate(120%)",
        WebkitBackdropFilter: "blur(6px) saturate(120%)",
      }}
    >
      {Array.from({ length: CELLS }, (_, i) => (
        <span
          key={i}
          style={{
            // Анхны төлөв — бүх нүд унтарсан шил (детерминистик, SSR-safe)
            backgroundColor: "var(--ea-hero-surface)",
            borderRadius: 1,
            aspectRatio: "1",
            transition: "background-color 420ms var(--ea-ease-standard)",
          }}
        />
      ))}
    </div>
  );
}
