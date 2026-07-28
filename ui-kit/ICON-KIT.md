# Entry Icon Kit

## Зорилго

Functional icon-уудыг page бүр дээр Lucide-ээс шууд сонгож, хэмжээ/өнгө/state
hardcode хийхийн оронд нэг semantic registry болон хоёр component-оор удирдана.

```text
ui-kit/tokens.css
        ↓
icon-registry.ts  →  Icon  →  text button, status, navigation, data display
        └───────────────→  IconAction  →  icon-only button
```

## Судалгааны үр дүн

2026-07-28-ны кодын audit:

- 52 файл `lucide-react`-ээс шууд import хийсэн;
- ойролцоогоор 80 functional glyph нэр ашигласан;
- 9 файл inline SVG агуулсан;
- `×`, `⌄`, `↩`, `✓` зэрэг text glyph олон component-д icon-ийн үүргээр
  ашиглагдсан;
- `Button` component icon size-ийг хэсэгчлэн стандартчилсан ч raw `<button>`,
  AG Grid renderer, module navigation, auth form хооронд state contract бүрэн
  нэг биш байсан.

Logo, authentication illustration, график/diagram нь functional icon биш тул
Icon Kit registry-д орохгүй.

## Нэгдсэн API

### Товчгүй icon

```tsx
import { Icon } from "@/components/ui/icon";

<Icon name="inventory" size="lg" tone="default" />
<Icon name="warning" tone="warning" label="Анхааруулга" />
```

Icon нь текстийн хажууд эсвэл button дотор байвал `label` өгөхгүй. Тэгвэл
`aria-hidden` болно. Icon өөрөө мэдээлэл дамжуулж байвал `label` өгнө.

### Тексттэй товчны icon

```tsx
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

<Button>
  <Icon name="save" />
  Хадгалах
</Button>
```

Icon нь `currentColor` өвлөнө. Button-ийн variant, hover, active, disabled state
дүрсэнд автоматаар нөлөөлнө.

### Icon-only товч

```tsx
import { IconAction } from "@/components/ui/icon-action";

<IconAction name="edit" label="Засах" />
<IconAction name="delete" label="Устгах" variant="danger" />
<IconAction name="show" label="Харагдац" pressed={visible} />
<IconAction name="refresh" label="Шинэчилж байна" loading />
```

`label` заавал байна. Энэ нь `aria-label` болон default tooltip болно.

## State contract

| State | API | Харагдах байдал | Accessibility |
|---|---|---|---|
| Default | default | neutral icon | normal |
| Hover | CSS | quiet tint + stronger border | keyboard focus мөн харагдана |
| Active/pressed | pointer active | 1px press | action хэвээр |
| Selected | `selected` | persistent selected tint | `data-selected` |
| Toggle pressed | `pressed` | selected visual | `aria-pressed` |
| Disabled | `disabled` | opacity token | native disabled |
| Loading | `loading` | centralized spinner icon | `aria-busy`, disabled |
| Danger | `variant="danger"` | semantic danger token | label хэвээр |

Touch төхөөрөмж дээр hover state шаардахгүй. `prefers-reduced-motion` үед
transition багасна.

## Төвөөс удирдах зүйлс

`ui-kit/tokens.css`:

- icon size: `--ea-icon-size-*`;
- stroke: `--ea-icon-stroke-width`;
- icon-only hit area: `--ea-icon-action-*`;
- default/muted/interactive/semantic colors;
- disabled opacity;
- hover/selected background ба border.

`components/ui/icon-registry.ts`:

- semantic name → Lucide glyph;
- catalog category;
- UI Kit дээр харагдах нэр.

`components/ui/icon-kit.module.css`:

- бүх visual state;
- focus, hover, selected, pressed, disabled, loading;
- reduced-motion behavior.

## Semantic нэр хэрэглэх шалтгаан

```tsx
// Болохгүй
import { Trash2 } from "lucide-react";
<Trash2 size={15} className="text-red-500" />

// Зөв
<Icon name="delete" tone="danger" />
```

`delete` glyph-ийг дараа нь өөрчилбөл зөвхөн registry засна. Page-уудыг дахин
өөрчлөхгүй.

## Claude Code migration scope

Icon Kit бэлэн боловч одоогийн page-уудыг энэ ажлаар зориуд холбоогүй.
Claude Code дараах дарааллаар migration хийнэ:

1. `components/layout/modules.ts`-ийн `LucideIcon`-ийг `IconName` болгох.
2. `components/ui`, dialog/select/searchable-select-ийн primitive icon-уудыг
   semantic registry рүү шилжүүлэх.
3. Icon-only raw `<button>`-уудыг `IconAction` болгох.
4. Text button доторх Lucide component-уудыг `Icon` болгох.
5. AG Grid cell renderer-ийн edit/delete/expand action-уудыг `IconAction`
   contract-т оруулах.
6. Inline chevron/close/back SVG болон `×`, `⌄`, `↩` text glyph-ийг semantic
   icon болгох.
7. Auth functional icon-уудыг registry рүү шилжүүлэх; logo/illustration-ийг
   хэвээр үлдээх.
8. `IconKitView`-ийг UI Kit route-д холбоод light/dark, keyboard, touch,
   reduced-motion шалгах.
9. Migration дууссаны дараа:

```bash
node scripts/audit-icons.mjs --strict
```

Strict audit нь direct Lucide import, raw functional SVG, text glyph үлдсэн бол
алдаатай төгсөнө.

## Claude Code-д өгөх prompt

```text
Read ui-kit/ICON-KIT.md completely before editing.

The Icon Kit implementation already exists in:
- components/ui/icon-registry.ts
- components/ui/icon.tsx
- components/ui/icon-action.tsx
- components/ui/icon-kit.module.css
- components/ui-kit/icon-kit-view.tsx
- ui-kit/tokens.css

Migrate existing application callsites to this kit without changing business
behavior, page layout, accounting logic, or user-owned styling changes.

Rules:
1. Pages must not import functional icons directly from lucide-react.
2. Use semantic IconName values, not glyph names.
3. Use IconAction for icon-only buttons; label is mandatory.
4. Use Button + Icon for actions with visible text.
5. Use Icon for navigation, status, and non-interactive data display.
6. Preserve logos and genuine illustrations outside the functional registry.
7. Replace inline functional SVG and text glyphs such as ×, ⌄, and ↩.
8. Preserve light/dark behavior and use only --ea-* tokens.
9. Do not redesign pages while migrating.
10. Connect IconKitView to the existing /settings/ui-kit experience.

Work in small module-by-module commits. After each module run lint/typecheck
and the relevant tests. Finish by running:
node scripts/audit-icons.mjs --strict
```
