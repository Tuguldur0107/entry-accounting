"use client";

// Auth hero panel-ийн чимэглэл — 64×64 шилэн хавтангийн сүлжээ.
// Хавтан бүр санамсаргүйгээр АСААД emoji үзүүлж, УНТРААД хоосон шил болно.
//
// SSR-safe: эхний рендер детерминистик (санамсаргүй утга ашиглахгүй) тул
// hydration mismatch гарахгүй. Санамсаргүй солилт нь mount-ын дараа эхэлнэ.
// prefers-reduced-motion үед анимац асахгүй, эхний хэв маяг хэвээр үлдэнэ.

import { useEffect, useState } from "react";

const EMOJIS = [
  "📊", "📈", "📉", "🧾", "💰", "💵", "🏦", "🧮",
  "💳", "📅", "🗂️", "📁", "✅", "🔐", "💼", "🪙",
  "📌", "⚖️", "📎", "✍️", "🗒️", "⏱️", "🔍", "📬",
];

const TILE = 64;      // px — хавтангийн хэмжээ
const GAP = 10;       // px
const TICK = 460;     // ms — солилтын давтамж

/** Детерминистик эхний хэв маяг — сервер ба клиент дээр ижил гарна. */
function initialTiles(count: number): (string | null)[] {
  return Array.from({ length: count }, (_, i) =>
    i % 5 === 2 ? EMOJIS[(i * 7) % EMOJIS.length] : null
  );
}

export function EmojiTileGrid({
  count = 30,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const [tiles, setTiles] = useState<(string | null)[]>(() => initialTiles(count));

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const id = setInterval(() => {
      setTiles((prev) => {
        const next = [...prev];
        // Нэг тик бүрд 1–3 хавтан өөрчилнө
        const changes = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < changes; k++) {
          const i = Math.floor(Math.random() * next.length);
          if (next[i] === null) {
            next[i] = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
          } else {
            // Асаастай байвал: заримыг унтраана, заримын emoji-г сольно
            next[i] =
              Math.random() < 0.45
                ? null
                : EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
          }
        }
        return next;
      });
    }, TICK);

    return () => clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, ${TILE}px)`,
        gap: GAP,
        justifyContent: "center",
        alignContent: "center",
      }}
    >
      {tiles.map((emoji, i) => {
        const on = emoji !== null;
        return (
          <div
            key={i}
            style={{
              width: TILE,
              height: TILE,
              display: "grid",
              placeItems: "center",
              borderRadius: "var(--ea-r-md)",
              // Унтарсан хавтан — шилэн
              background: on
                ? "color-mix(in srgb, var(--ea-hero-fg) 12%, transparent)"
                : "var(--ea-hero-surface)",
              border: `1px solid ${on ? "var(--ea-hero-border)" : "var(--ea-hero-border-soft)"}`,
              boxShadow: on ? `inset 0 1px 0 var(--ea-shine)` : "none",
              backdropFilter: "blur(6px) saturate(120%)",
              WebkitBackdropFilter: "blur(6px) saturate(120%)",
              transition: `background-color var(--ea-motion-lift) var(--ea-ease-standard),
                           border-color var(--ea-motion-lift) var(--ea-ease-standard),
                           box-shadow var(--ea-motion-lift) var(--ea-ease-standard)`,
            }}
          >
            <span
              style={{
                fontSize: 30,
                lineHeight: 1,
                opacity: on ? 1 : 0,
                transform: on ? "scale(1)" : "scale(0.6)",
                transition: `opacity 260ms var(--ea-ease-standard),
                             transform 260ms var(--ea-ease-standard)`,
              }}
            >
              {emoji ?? ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
