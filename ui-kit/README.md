# UI Kit — дизайн системийн эх сурвалж

```
ui-kit/
├── tokens.css     ← ЦОРЫН ГАНЦ ЭХ СУРВАЛЖ (өнгө, фонт, радиус, сүүдэр)
├── preview.html   ← статик preview — dev server ШААРДАХГҮЙ
└── README.md
```

## Хэн үүнийг хэрэглэдэг вэ

```
ui-kit/tokens.css
   ├─→ app/globals.css  (@import)  →  бүтэн систем: shadcn, AG Grid, бүх component
   └─→ ui-kit/preview.html (<link>) →  статик preview
```

`app/globals.css` нь токен зарладаггүй — зөвхөн `@import "../ui-kit/tokens.css"` хийнэ.
AG Grid theme (`lib/grid/theme.ts`) ба бүх component `var(--ea-*)`-аар л ханддаг тул
tokens.css-ийг өөрчлөхөд систем даяар шууд тусна.

## Хоёр preview — юуг нь хэзээ ашиглах вэ

| | `ui-kit/preview.html` | `/settings/ui-kit` (апп доторх) |
|---|---|---|
| Юу үзүүлдэг | **Токен** + өнгө/тайпограф/контраст | **Амьд React component** (AccountInput, DataGrid…) |
| Ажиллуулах | Файлыг browser-т чирээд нээнэ | `npm run dev` + нэвтэрсэн байх |
| Хэрэглээ | Өнгө сонгох, контраст шалгах, дизайнертай ярих | Component-ийн бодит зан төлөв турших |

`preview.html` дотор өнгө **давхардаж бичигдээгүй** — `getComputedStyle`-аар tokens.css-ээс
амьдаар уншиж, hex утга болон WCAG контрастыг тооцож харуулдаг. Тиймээс токен өөрчлөхөд
preview автоматаар шинэчлэгдэнэ, зөрөх боломжгүй.

## Токен өөрчлөх

1. `ui-kit/tokens.css` дотор засна (`:root` = light, `.dark` = dark).
2. `preview.html`-ээ refresh хийж контрастын хүснэгтийг шалгана — AA (≥4.5) доош унасан
   эсэхийг тэр даруй харна.
3. Аппыг refresh хийнэ. Өөр юу ч засах шаардлагагүй.

**Дүрэм:** `:root` блок `.dark`-аас ӨМНӨ байх ёстой. Хоёулаа specificity (0,1,0) —
тэнцүү үед сүүлд бичигдсэн нь ялдаг.

## Component дотор өнгө бичихийг хориглоно

```tsx
// ❌ Болохгүй — dark mode-д эвдэрнэ
<div className="bg-white border-slate-200" style={{ color: "#1E3A5F" }} />

// ✅ Зөв
<div className="bg-[var(--ea-surface)]" style={{ color: "var(--ea-primary)" }} />
```

Шинэ өнгө хэрэгтэй бол component дотор биш, **tokens.css-д токен нэмнэ**.

## Өнгөний бодлого (dark mode)

Тас хар (`--ea-bg: #000`) суурьтай үед өндөр ханалттай (saturated) цэнхэр нь
"неон гэрэлтэх" (halation) эффект өгдөг тул dark-ийн цэнхэрийг light-ийн нави
(HSL 211°, **52%**)-тэй ойролцоо **62%** ханалттай болгосон:

| | Light | Dark |
|---|---|---|
| `--ea-primary` | `#1E3A5F` HSL(211, 52%, 25%) | `#73A5DE` HSL(212, 62%, 66%) |
| Контраст (дэвсгэртэй) | 11.5:1 (AAA) | 8.1:1 (AAA) |

Цэнхэр нь **зөвхөн accent** — товч, линк, focus ring, сонгосон мөр. Дэвсгэр,
хүрээ, текст бүгд саармаг (хар/цагаан/саарал).

## Токен өөрчлөхөд бүх систем дагаж байгааг батлах (canary тест)

`tokens.css` дотор нэг токеныг түр гажуудуулаад аппыг refresh хийнэ:

```css
--ea-primary: #C026D3;   /* түр canary */
```

Бүх товч, линк, идэвхтэй цэс, grid-ийн сонголт, focus ring нэг дор өөрчлөгдөх ёстой.
Хэрэв ямар нэг элемент **хуучин өнгөөрөө үлдвэл** тэр газар hardcode үлдсэн гэсэн үг —
олоод токен руу шилжүүлнэ. Шалгаж дуусаад токеноо буцаана.

Хурдан скан (терминалаас):

```bash
grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\(' --include='*.tsx' --include='*.ts' app components lib | grep -v 'var(--'
grep -rnoE '\b(bg|text|border)-(white|black|slate|gray|red|green|blue|neutral)(-[0-9]{2,3})?\b' --include='*.tsx' app components
```

Хоёулаа хоосон буцаах ёстой. Дараах хоёр л **зориудын үл хамаарах зүйл**:

| Газар | Яагаад |
|-------|--------|
| `journal-entry-form.tsx` доторх `.ea-print-sheet` (`bg-white text-black`) | Хэвлэх баримт — цаас үргэлж цагаан, бэх хар. Дэлгэцийн загвартай хамаарахгүй. |
| `lib/i18n.ts` доторх `ORGS[].color` | Байгууллага тус бүрийн брэнд өнгө — өгөгдөл, дизайн токен биш. |
