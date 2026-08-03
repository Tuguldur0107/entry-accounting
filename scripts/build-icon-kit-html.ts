import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ICON_CATALOG,
  ICONS,
  type IconCategory,
  type IconName,
} from "../components/ui/icon-registry";

const output = resolve(process.cwd(), "ui-kit/icon-kit.html");

const categoryLabels: Record<IconCategory, string> = {
  action: "Үйлдэл",
  navigation: "Навигаци",
  status: "Төлөв",
  data: "Өгөгдөл",
  module: "Модуль",
  theme: "Систем",
};

function svg(name: IconName, className = "icon", size = 20) {
  return renderToStaticMarkup(
    createElement(ICONS[name], {
      width: size,
      height: size,
      className,
      "aria-hidden": true,
      focusable: false,
    })
  );
}

const catalog = ICON_CATALOG.map(
  (item) => `
    <button
      type="button"
      class="icon-card"
      data-name="${item.name}"
      data-label="${item.label}"
      data-category="${item.category}"
      aria-label="${item.label}: ${item.name}"
    >
      ${svg(item.name, "icon icon--xl")}
      <code>${item.name}</code>
      <span>${item.label}</span>
    </button>`
).join("");

const html = `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Гоёл Кашмер ХХК — Icon Kit</title>
<link rel="stylesheet" href="./tokens.css">
<style>
  :root {
    --font-geist-sans: ui-sans-serif;
    --font-geist-mono: ui-monospace;
    --font-display: Georgia;
  }
  * { box-sizing: border-box; }
  html { color-scheme: light; }
  html.dark { color-scheme: dark; }
  body {
    min-height: 100vh;
    margin: 0;
    padding: 28px 24px 64px;
    color: var(--ea-text-1);
    background: var(--ea-bg);
    background-image: var(--ea-bg-gradient);
    background-repeat: no-repeat;
    background-size: 100% 100vh;
    font-family: var(--ea-font-sans);
    -webkit-font-smoothing: antialiased;
  }
  body::before {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background-image: radial-gradient(circle, color-mix(in srgb, var(--ea-accent) 22%, transparent) 1px, transparent 1.4px);
    background-size: 32px 32px;
    opacity: .10;
    content: "";
    mask-image: linear-gradient(120deg, transparent 8%, #000 42%, transparent 78%);
  }
  button, input, select { font: inherit; }
  .wrap { max-width: 1180px; margin: 0 auto; }
  .page-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 18px;
  }
  h1 {
    margin: 0;
    font-family: var(--ea-font-display);
    font-size: clamp(24px, 4vw, 34px);
    font-weight: 450;
  }
  .lead { max-width: 720px; margin: 7px 0 0; color: var(--ea-text-3); font-size: 13px; line-height: 1.55; }
  .source { margin-top: 8px; color: var(--ea-text-4); font-family: var(--ea-font-mono); font-size: 11px; }
  .top-actions { display: flex; gap: 8px; }
  section {
    margin-bottom: 14px;
    padding: 20px;
    border: 1px solid var(--ea-border);
    border-radius: var(--ea-r-lg);
    background: var(--ea-surface-glass);
    box-shadow: inset 0 1px 0 var(--ea-shine);
    backdrop-filter: var(--ea-glass-filter);
    -webkit-backdrop-filter: var(--ea-glass-filter);
  }
  .section-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 14px;
  }
  h2 { margin: 0; color: var(--ea-text-1); font-size: 14px; }
  h3 { margin: 18px 0 8px; color: var(--ea-text-2); font-size: 12px; }
  .hint { margin: 4px 0 0; color: var(--ea-text-3); font-size: 11.5px; }
  .control {
    display: inline-flex;
    min-height: 34px;
    align-items: center;
    gap: 7px;
    padding: 0 11px;
    border: 1px solid var(--ea-border);
    border-radius: var(--ea-r-md);
    color: var(--ea-text-2);
    background: var(--ea-surface);
    cursor: pointer;
  }
  .control:hover { color: var(--ea-text-1); background: var(--ea-hover-subtle); border-color: var(--ea-hover-border); }
  .control:focus-visible, input:focus-visible, select:focus-visible, .icon-card:focus-visible, .icon-action:focus-visible {
    outline: none;
    box-shadow: var(--ea-focus);
  }
  .state-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(105px, 1fr)); gap: 10px; }
  .state {
    display: grid;
    min-height: 92px;
    place-items: center;
    align-content: center;
    gap: 8px;
    border: 1px solid var(--ea-border);
    border-radius: var(--ea-r-md);
    background: var(--ea-bg-2);
  }
  .state span { color: var(--ea-text-4); font-size: 10px; }
  .icon {
    width: var(--ea-icon-size-md);
    height: var(--ea-icon-size-md);
    flex: 0 0 auto;
    stroke-width: var(--ea-icon-stroke-width);
    transition: color var(--ea-motion-hover) var(--ea-ease-standard), transform var(--ea-motion-press) var(--ea-ease-standard);
  }
  .icon--xs { width: var(--ea-icon-size-xs); height: var(--ea-icon-size-xs); }
  .icon--sm { width: var(--ea-icon-size-sm); height: var(--ea-icon-size-sm); }
  .icon--lg { width: var(--ea-icon-size-lg); height: var(--ea-icon-size-lg); }
  .icon--xl { width: var(--ea-icon-size-xl); height: var(--ea-icon-size-xl); }
  .icon--2xl { width: var(--ea-icon-size-2xl); height: var(--ea-icon-size-2xl); }
  .icon-action {
    display: inline-flex;
    width: var(--ea-icon-action-md);
    height: var(--ea-icon-action-md);
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--ea-icon-action-border);
    border-radius: var(--ea-icon-action-radius);
    color: var(--ea-icon-default);
    background: var(--ea-icon-action-bg);
    cursor: pointer;
    transition:
      color var(--ea-motion-hover) var(--ea-ease-standard),
      background-color var(--ea-motion-hover) var(--ea-ease-standard),
      border-color var(--ea-motion-hover) var(--ea-ease-standard),
      transform var(--ea-motion-press) var(--ea-ease-standard);
  }
  .icon-action.outline { border-color: var(--ea-border); background: var(--ea-surface); }
  .icon-action.solid { color: var(--primary-foreground); border-color: var(--ea-primary); background: var(--ea-primary); }
  .icon-action.danger { color: var(--ea-icon-danger); border-color: color-mix(in srgb, var(--ea-danger) 24%, transparent); background: var(--ea-danger-bg); }
  .icon-action.selected, .icon-action[aria-pressed="true"] {
    color: var(--ea-icon-selected);
    border-color: var(--ea-icon-action-selected-border);
    background: var(--ea-icon-action-selected-bg);
  }
  .icon-action:active:not(:disabled) { transform: translateY(1px); }
  .icon-action:disabled { cursor: not-allowed; opacity: var(--ea-icon-disabled-opacity); }
  .spin { animation: spin .85s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (hover: hover) and (pointer: fine) {
    .icon-action:hover:not(:disabled) {
      color: var(--ea-text-1);
      border-color: var(--ea-icon-action-hover-border);
      background: var(--ea-icon-action-hover-bg);
    }
    .icon-action.solid:hover:not(:disabled) { color: var(--primary-foreground); border-color: var(--ea-primary-700); background: var(--ea-primary-700); }
    .icon-action.selected:hover:not(:disabled) { color: var(--ea-icon-selected); border-color: var(--ea-icon-action-selected-border); background: var(--ea-icon-action-selected-bg); }
  }
  .tone-row, .size-row { display: flex; flex-wrap: wrap; align-items: end; gap: 18px; }
  .sample { display: grid; justify-items: center; gap: 6px; color: var(--ea-icon-default); }
  .sample span { color: var(--ea-text-4); font-size: 10px; }
  .tone-muted { color: var(--ea-icon-muted); }
  .tone-interactive { color: var(--ea-icon-interactive); }
  .tone-success { color: var(--ea-icon-success); }
  .tone-warning { color: var(--ea-icon-warning); }
  .tone-danger { color: var(--ea-icon-danger); }
  .toolbar {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) 180px auto;
    gap: 8px;
    width: min(100%, 640px);
  }
  .toolbar input, .toolbar select {
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--ea-border);
    border-radius: var(--ea-r-md);
    color: var(--ea-text-1);
    background: var(--ea-surface);
    outline: none;
  }
  .count { align-self: center; color: var(--ea-text-4); font-family: var(--ea-font-mono); font-size: 11px; white-space: nowrap; }
  .catalog { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
  .icon-card {
    display: grid;
    min-height: 112px;
    place-items: center;
    align-content: center;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--ea-border);
    border-radius: var(--ea-r-md);
    color: var(--ea-icon-default);
    background: var(--ea-surface);
    cursor: pointer;
    transition: background-color var(--ea-motion-hover) var(--ea-ease-standard), border-color var(--ea-motion-hover) var(--ea-ease-standard), transform var(--ea-motion-press) var(--ea-ease-standard);
  }
  .icon-card code { max-width: 100%; overflow: hidden; color: var(--ea-text-2); font-family: var(--ea-font-mono); font-size: 10px; text-overflow: ellipsis; }
  .icon-card span { max-width: 100%; overflow: hidden; color: var(--ea-text-4); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .icon-card[aria-pressed="true"] { color: var(--ea-icon-selected); border-color: var(--ea-selected-border); background: var(--ea-selected-bg); }
  .icon-card:active { transform: translateY(1px); }
  @media (hover: hover) and (pointer: fine) {
    .icon-card:hover { color: var(--ea-text-1); border-color: var(--ea-hover-border); background: var(--ea-hover-subtle); }
  }
  .empty { display: none; padding: 32px; color: var(--ea-text-4); text-align: center; }
  .toast {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 5;
    padding: 10px 14px;
    border: 1px solid var(--ea-selected-border);
    border-radius: var(--ea-r-md);
    color: var(--ea-text-1);
    background: var(--ea-surface-raised);
    box-shadow: var(--ea-shadow-2);
    font-size: 12px;
    opacity: 0;
    pointer-events: none;
    transform: translateY(6px);
    transition: opacity var(--ea-motion-hover) var(--ea-ease-standard), transform var(--ea-motion-hover) var(--ea-ease-standard);
  }
  .toast.show { opacity: 1; transform: translateY(0); }
  @media (max-width: 720px) {
    body { padding: 20px 14px 48px; }
    .page-head, .section-head { align-items: stretch; flex-direction: column; }
    .toolbar { grid-template-columns: 1fr; width: 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  }
</style>
</head>
<body>
<main class="wrap">
  <header class="page-head">
    <div>
      <h1>Гоёл Кашмер ХХК — Icon Kit</h1>
      <p class="lead">Functional icon-уудын semantic catalog. Хэмжээ, stroke, tone, hit-area, hover, pressed, selected, disabled болон loading state бүгд <code>tokens.css</code>-ээс удирдагдана.</p>
      <div class="source">offline preview · source: components/ui/icon-registry.ts + ui-kit/tokens.css</div>
    </div>
    <div class="top-actions">
      <button class="control" id="theme" type="button" aria-label="Өнгөний горим солих">${svg("darkMode", "icon")} <span>Dark</span></button>
    </div>
  </header>

  <section>
    <div class="section-head">
      <div><h2>Icon action states</h2><p class="hint">Hover хийх, selected товчийг дарах, keyboard Tab ашиглаж focus шалгана.</p></div>
    </div>
    <div class="state-grid">
      <div class="state"><button class="icon-action" aria-label="Засах">${svg("edit")}</button><span>Default</span></div>
      <div class="state"><button class="icon-action outline" aria-label="Шүүх">${svg("filter")}</button><span>Outline / hover</span></div>
      <div class="state"><button class="icon-action outline selected" id="selectedDemo" aria-label="Харагдац" aria-pressed="true">${svg("show")}</button><span>Selected / toggle</span></div>
      <div class="state"><button class="icon-action" aria-label="Устгах" disabled>${svg("delete")}</button><span>Disabled</span></div>
      <div class="state"><button class="icon-action" aria-label="Уншиж байна" aria-busy="true" disabled>${svg("loading", "icon spin")}</button><span>Loading</span></div>
      <div class="state"><button class="icon-action danger" aria-label="Устгах">${svg("delete")}</button><span>Danger</span></div>
      <div class="state"><button class="icon-action solid" aria-label="Нэмэх">${svg("add")}</button><span>Solid</span></div>
    </div>

    <h3>Size scale</h3>
    <div class="size-row">
      <div class="sample">${svg("inventory", "icon icon--xs", 12)}<span>xs · 12</span></div>
      <div class="sample">${svg("inventory", "icon icon--sm", 14)}<span>sm · 14</span></div>
      <div class="sample">${svg("inventory", "icon", 16)}<span>md · 16</span></div>
      <div class="sample">${svg("inventory", "icon icon--lg", 18)}<span>lg · 18</span></div>
      <div class="sample">${svg("inventory", "icon icon--xl", 20)}<span>xl · 20</span></div>
      <div class="sample">${svg("inventory", "icon icon--2xl", 24)}<span>2xl · 24</span></div>
    </div>

    <h3>Semantic tones</h3>
    <div class="tone-row">
      <div class="sample">${svg("info")}<span>default</span></div>
      <div class="sample tone-muted">${svg("info")}<span>muted</span></div>
      <div class="sample tone-interactive">${svg("openDetail")}<span>interactive</span></div>
      <div class="sample tone-success">${svg("success")}<span>success</span></div>
      <div class="sample tone-warning">${svg("warning")}<span>warning</span></div>
      <div class="sample tone-danger">${svg("error")}<span>danger</span></div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <div><h2>Semantic catalog</h2><p class="hint">Card дарахад semantic нэр сонгогдоно. Хайлтаар нэр, Монгол label, category шүүнэ.</p></div>
      <div class="toolbar">
        <input id="search" type="search" placeholder="add, inventory, тайлан…" aria-label="Icon хайх">
        <select id="category" aria-label="Category">
          <option value="">Бүх category</option>
          ${Object.entries(categoryLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}
        </select>
        <span class="count" id="count">${ICON_CATALOG.length} icon</span>
      </div>
    </div>
    <div class="catalog" id="catalog">${catalog}</div>
    <div class="empty" id="empty">Тохирох icon олдсонгүй.</div>
  </section>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
  const root = document.documentElement;
  const theme = document.getElementById("theme");
  const themeText = theme.querySelector("span");
  const search = document.getElementById("search");
  const category = document.getElementById("category");
  const cards = [...document.querySelectorAll(".icon-card")];
  const count = document.getElementById("count");
  const empty = document.getElementById("empty");
  const toast = document.getElementById("toast");
  const selectedDemo = document.getElementById("selectedDemo");
  let toastTimer;

  function setTheme(dark) {
    root.classList.toggle("dark", dark);
    themeText.textContent = dark ? "Light" : "Dark";
    theme.setAttribute("aria-label", dark ? "Цайвар горимд шилжих" : "Харанхуй горимд шилжих");
  }
  setTheme(new URLSearchParams(location.search).get("theme") === "dark");
  theme.addEventListener("click", () => setTheme(!root.classList.contains("dark")));

  selectedDemo.addEventListener("click", () => {
    const pressed = selectedDemo.getAttribute("aria-pressed") === "true";
    selectedDemo.setAttribute("aria-pressed", String(!pressed));
    selectedDemo.classList.toggle("selected", !pressed);
  });

  function filterCatalog() {
    const q = search.value.trim().toLocaleLowerCase();
    const selectedCategory = category.value;
    let visible = 0;
    cards.forEach((card) => {
      const haystack = [card.dataset.name, card.dataset.label, card.dataset.category].join(" ").toLocaleLowerCase();
      const show = (!q || haystack.includes(q)) && (!selectedCategory || card.dataset.category === selectedCategory);
      card.hidden = !show;
      if (show) visible += 1;
    });
    count.textContent = visible + " icon";
    empty.style.display = visible ? "none" : "block";
  }
  search.addEventListener("input", filterCatalog);
  category.addEventListener("change", filterCatalog);

  cards.forEach((card) => {
    card.addEventListener("click", async () => {
      cards.forEach((item) => item.setAttribute("aria-pressed", "false"));
      card.setAttribute("aria-pressed", "true");
      const name = card.dataset.name;
      try { await navigator.clipboard.writeText(name); } catch {}
      toast.textContent = name + " сонгогдлоо";
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 1400);
    });
  });
</script>
</body>
</html>`;

writeFileSync(output, html);
console.log(`Generated ${output}`);
