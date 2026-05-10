# 04. Theme — Dark/Light mode + Glassmorphism

> **Эх код:** `frontend/web/src/theme/index.ts`, `frontend/web/src/components/ChakraProviders.tsx`, `frontend/web/src/components/ColorModeToggle.tsx`.
>
> Entry нь Chakra UI-ийн `extendTheme` дээр **dark default + glass surface** загвар хэрэглэдэг. Бүх дэлгэц light + dark **хоёуланд** ажилласан байх ёстой.

---

## 1. Color mode

| Property | Утга |
|----------|------|
| Default | `dark` |
| `useSystemColorMode` | `false` (заавал тогтоосон) |
| Toggle товч | `<ColorModeToggle>` — header дотор sun/moon icon-той IconButton |
| Persistence | Chakra-ийн өөрийн localStorage (`chakra-ui-color-mode`) |

**Background gradient (body + main):**

```ts
bg: props.colorMode === 'dark'
  ? 'linear-gradient(to bottom right, rgb(2, 10, 33), rgb(1, 8, 28))'
  : 'white'
color: props.colorMode === 'dark' ? 'whiteAlpha.900' : 'gray.800'
backgroundRepeat: 'no-repeat'
backgroundAttachment: 'fixed'
minHeight: '100vh'
```

**ColorModeToggle component:**

```tsx
<IconButton
  aria-label="Toggle dark mode"
  onClick={toggleColorMode}
  icon={colorMode === 'light' ? <MoonIcon /> : <SunIcon />}
  variant="ghost"
  size="sm"
  h="32px"
  minW="32px"
/>
```

> Header bar дахь LanguageToggle-ийн хажууд байрлуулна. Module page-уудад дунд бүсэд placeholder болж зурахгүй.

---

## 2. Glassmorphism — design tokens

Entry нь "цэвэр Chakra default" биш, **glass surface tokens**-той. Бүх dropdown / panel / popover ижил жор хэрэглэнэ.

### 2.1 Тооноор (универсаль)

| Token | Light | Dark |
|-------|-------|------|
| Surface bg | `rgba(255,255,255,0.55)` | `rgba(255,255,255,0.06)` |
| Surface border | `rgba(148,163,184,0.35)` | `rgba(255,255,255,0.14)` |
| Strong surface bg (Modal/Drawer) | `rgba(255,255,255,0.85)` | `rgba(26,32,44,0.85)` |
| Soft surface bg (Menu/Tooltip) | `rgba(255,255,255,0.65)` | `rgba(26,32,44,0.55)` |
| Tooltip bg | `rgba(255,255,255,0.1)` | (same — dark default) |
| Active state bg | `rgba(190,227,248,0.55)` | `whiteAlpha.100` |
| Hover state bg | `rgba(255,255,255,0.55)` | `whiteAlpha.200` |
| Subtle inset shadow | `inset 0 1px 0 rgba(255,255,255,0.6)` | `inset 0 1px 0 rgba(255,255,255,0.06)` |
| Drop shadow | `0 12px 32px rgba(15,23,42,0.12)` | `0 12px 32px rgba(0,0,0,0.45)` |

### 2.2 Blur тохиргоо

| Хэрэглээ | `backdrop-filter` |
|---------|-------------------|
| Inputs / dropdowns | `blur(14px) saturate(160%)` |
| Menu / Popover | `blur(16px) saturate(160%)` |
| Modal / Drawer content | `blur(16px) saturate(160%)` |
| Tooltip | `blur(6px)` |
| AlertDialog | `blur(5px)` |

> Бүх glass surface дээр `WebkitBackdropFilter` мөн өгнө (Safari дэмжлэг).

### 2.3 Жор reuse — recommended `sx`

Стандарт SX block:

```ts
const glassSx = {
  backdropFilter: 'blur(14px) saturate(160%)',
  WebkitBackdropFilter: 'blur(14px) saturate(160%)',
}

const glassBg = useColorModeValue('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.06)')
const glassBorder = useColorModeValue('rgba(148,163,184,0.35)', 'rgba(255,255,255,0.14)')
```

Эдгээрийг нэг газар (зөвлөмж: `theme/glass.ts`-д export хийх) тогтоохоор v1.07-д төлөвлөгдсөн.

---

## 3. Chakra theme extension

Одоогийн `theme/index.ts` минимум:

```ts
import { extendTheme, ThemeConfig } from '@chakra-ui/react'

const config: ThemeConfig = {
  initialColorMode: 'dark',
  useSystemColorMode: false,
}

const theme = extendTheme({ config })
export default theme
```

`ChakraProviders.tsx` дотор global styles нэмсэн (background gradient + color).

> **Ирээдүйн өргөтгөл (V1.07):** `theme/index.ts` доторх `colors.brand.*`, `semanticTokens.*`, `components.<name>.baseStyle.*` нэмж "Entry brand palette"-ийг тогтоох.

---

## 4. `useColorModeValue` дүрмүүд

❗ **Чухал anti-pattern алдаа:** `<Component>` доторх `.map()` callback-д `useColorModeValue` дуудах нь React rules-of-hooks-ыг зөрчинө. Анх `useColorModeValue` дуудалт **component-ийн дээд хэсэгт** байх ёстой.

❌ **Буруу:**

```tsx
return items.map(item => {
  const bg = useColorModeValue('white', 'gray.700')  // ❌ map дотор
  return <Box bg={bg}>{item.name}</Box>
})
```

✅ **Зөв:**

```tsx
const bg = useColorModeValue('white', 'gray.700')   // ✓ дээд хэсэгт
return items.map(item => <Box key={item.id} bg={bg}>{item.name}</Box>)
```

> Энэ дүрмийг CLAUDE.md-д тэмдэглэсэн ба subagent / ESLint hook нь тэмдэглэдэг.

---

## 5. Tabs / sidebar / module nav theming

Entry нь `Sidebar` + `ModuleSubnav` 2 түвшний navigation-той. Тэдгээрт дараах theme tokens хэрэглэдэг:

**Sidebar:**
- Background: light `rgba(255,255,255,0.65)`, dark `rgba(15,23,42,0.45)`
- Backdrop blur: `blur(20px) saturate(180%)`
- Border-right: `1px solid` glass border
- Selected item: bg `rgba(59,130,246,0.18)`, color `blue.400`

**ModuleSubnav (header tabs):**
- Active tab indicator: bottom border `2px solid blue.400`
- Inactive tab: `color: whiteAlpha.700` (dark) / `gray.600` (light)
- Hover: `bg: whiteAlpha.100` (dark) / `blackAlpha.50` (light)

---

## 6. Status badge палитр

`<StatusBadge>` (`frontend/web/src/components/common/StatusBadge.tsx`) — дараах нэгдсэн өнгө хэрэглэнэ.

| Status | colorScheme | Дэвсгэр өнгө |
|--------|-------------|--------------|
| `draft` | gray | gray.100 / whiteAlpha.200 |
| `posted` / `approved` / `paid` | green | green.100 / green.800 |
| `partial` | yellow | yellow.100 / yellow.800 |
| `submitted` / `pending` | blue | blue.100 / blue.800 |
| `reversed` / `cancelled` / `rejected` | red | red.100 / red.800 |
| `closed` | purple | purple.100 / purple.800 |
| `held_for_sale` / `impaired` | orange | orange.100 / orange.800 |

---

## 7. Type/font system

| Зорилго | Token / spec |
|---------|--------------|
| Body font | Chakra default — `Inter`, `system-ui` fallback |
| Header font | `font-weight: bold`, size `lg`/`xl` |
| Mono (code/account-code) | `font-family: 'Fira Code', 'JetBrains Mono', monospace` |
| Numeric column | `tabular-nums` (CSS feature) |
| Default text size | `sm` (table) / `md` (form/page) |
| Caption | `xs`, color `gray.500` |

---

## 8. Spacing scale

Chakra default scale (`px`):

| Token | px |
|-------|----|
| `0.5` | 2 |
| `1` | 4 |
| `2` | 8 |
| `3` | 12 |
| `4` | 16 |
| `6` | 24 |
| `8` | 32 |

**Гэрээ:**
- StandardTable toolbar `<HStack spacing={2}>`.
- Form section `<VStack spacing={4}>`.
- Card padding `p={4}` (md), `p={6}` (lg).

---

## 9. Шалгалт

- [ ] Бүх glass surface light + dark хоёр mode-д ажилладаг эсэх (visual smoke test).
- [ ] `useColorModeValue` `.map()` дотор дуудаж байгаа жишээ алга байгаа эсэх (grep шалгах).
- [ ] StatusBadge-ийн status enum-ыг `<StatusBadge>` ашиглаж байгаа эсэх.
- [ ] Header-д `<ColorModeToggle>` болон `<LanguageToggle>` хоёулаа бий эсэх.
- [ ] Background gradient зөв ачаалагдаж байгаа эсэх (mobile + desktop).
- [ ] Backdrop blur Safari/iOS дээр `WebkitBackdropFilter` өгсөн эсэх.
