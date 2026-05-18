> ⚠️ **SUPERSEDED (2026)** — Энэ файл нь хуучин **Chakra UI**-д суурилсан спекийг тайлбарладаг.
> Entry Accounting нь одоо **AG Grid Community + shadcn/ui** ашигладаг. Шинэ стандартыг
> [knowledge/03-стандарт/ui-standards/2026-ag-grid/](./2026-ag-grid/) болон [CLAUDE.md](../../../CLAUDE.md#хүснэгтийн-стандарт-ag-grid-community)-аас үзнэ үү.

---

# 03. Popup / Modal / Drawer стандарт

> **Эх код:** `frontend/web/src/components/common/ActionButtons.tsx` (AlertDialog reference) + Chakra UI Modal/Drawer/Popover/Tooltip.
>
> Entry-д popup төрөл бүрд **тодорхой нөхцөл** байна — confirm, form modal, side drawer, inline popover, tooltip. Бүгд нэг **glass token** дагана.

---

## 1. Popup төрлийн хэрэглээний матриц

| Төрөл | Хэрэглээ | Гол шинж |
|-------|----------|----------|
| **AlertDialog** | Destructive confirm (Delete, Reverse, Discard) | leastDestructiveRef, focus-trap |
| **Modal** | Form-той dialog (Edit row, New record dialog) | Header + Body + Footer + Close |
| **Drawer** | Side-panel detail (transaction view, audit trail) | Right-side slide |
| **Popover** | Inline option/action menu (column filter, segment edit) | Anchor-relative |
| **Menu** | Dropdown action list (row actions, language) | MenuButton + MenuList |
| **Tooltip** | Hover hint (icon button label) | hasArrow, glass |
| **Toast** | Async result feedback (success / error) | top-right, auto-dismiss |

---

## 2. AlertDialog — destructive confirm

**Хэзээ:** `Delete`, `Reverse journal`, `Discard changes`, `Suspend tenant` гэх мэт **буцааж эргэж болохгүй** үйлдэл хийхээс өмнө.

**Layout:**

```
┌─ glass overlay (bg: blackAlpha.300, blur: 5px) ────────────┐
│   ┌─ AlertDialogContent ──────────────────────────────┐    │
│   │ Header  │ "Бичиг устгах уу?"                       │    │
│   │ Body    │ "Энэ үйлдлийг буцаах боломжгүй."         │    │
│   │ Footer  │ [Цуцлах]  [Устгах] (red)                 │    │
│   └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Props gold standard:**

```tsx
<AlertDialog
  isOpen={isOpen}
  leastDestructiveRef={cancelRef}    // ✓ заавал
  onClose={onClose}
>
  <AlertDialogOverlay>
    <AlertDialogContent
      bg="rgba(139, 121, 121, 0.14)"
      backdropFilter="blur(5px)"
      border="1px solid rgba(255, 255, 255, 0.2)"
      boxShadow="lg"
    >
      <AlertDialogHeader fontSize="lg" fontWeight="bold">
        {t('dlg_delete_title')}
      </AlertDialogHeader>
      <AlertDialogBody>{t('dlg_delete_body')}</AlertDialogBody>
      <AlertDialogFooter>
        <Button ref={cancelRef} onClick={onClose}>{t('btn_cancel')}</Button>
        <Button colorScheme="red" onClick={handleConfirm} ml={3}>{t('btn_delete')}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialogOverlay>
</AlertDialog>
```

**Гол шалгалт:**
- ❗ `leastDestructiveRef` (cancelRef) **заавал** — Esc дарахад хадгалалтын цэг.
- Confirm товч **always last** (баруун талд), color `red`/`orange` destructive bias.
- i18n keys: `dlg_<action>_title`, `dlg_<action>_body`, `btn_cancel`, `btn_delete`/`btn_confirm`.

---

## 3. Modal — form dialog

**Хэзээ:** Хэдэн талбартай form-ыг row-list-ийн дээр popup-аар нээх (BOM create, Order issue, Bank account edit).

**Layout:**

```
┌─ ModalOverlay (blackAlpha.600 backdrop) ───────────────┐
│   ┌─ ModalContent (centered, maxW: "lg" хэвийн) ───┐  │
│   │ ModalHeader  │ Title + ModalCloseButton          │  │
│   │ ModalBody    │ Form fields, validation           │  │
│   │ ModalFooter  │ [Cancel] [Save / Submit] (right)  │  │
│   └─────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

**Glass tokens:**
- `bg`: light `rgba(255,255,255,0.85)`, dark `rgba(26,32,44,0.85)`
- `backdrop-filter`: `blur(16px) saturate(160%)`
- `border`: `1px solid` light `rgba(255,255,255,0.7)` / dark `rgba(255,255,255,0.08)`
- `box-shadow`: light `0 12px 32px rgba(15,23,42,0.12)` / dark `0 12px 32px rgba(0,0,0,0.45)`

**Хэмжээ конвенц:**

| Modal зорилго | `size` | `maxW` |
|--------------|:------:|:------:|
| Confirm + 2-3 талбар | sm | 360px |
| Хэвшмэл form (5-10 талбар) | md/lg | 600px |
| Том wizard / table preview | xl/full | 900px / 100% |

**i18n keys:** `mdl_<topic>_title`, `mdl_<topic>_body`.

---

## 4. Drawer — side panel detail

**Хэзээ:** Жагсаалтаас row сонгоход **read-only / quick-edit detail** баруун талаас гулсаж нээгдэх. POS row preview, audit detail, stock card.

**Props:**

```tsx
<Drawer isOpen={isOpen} onClose={onClose} placement="right" size="md">
  <DrawerOverlay />
  <DrawerContent
    bg={useColorModeValue('white', 'gray.800')}
    backdropFilter="blur(14px) saturate(160%)"
  >
    <DrawerCloseButton />
    <DrawerHeader>{title}</DrawerHeader>
    <DrawerBody>...</DrawerBody>
    <DrawerFooter>...</DrawerFooter>
  </DrawerContent>
</Drawer>
```

**Хэмжээ:** `size="md"` (400px) хэвийн; `size="lg"` нийт жагсаалтаас drill хийх үед.

---

## 5. Popover — inline option panel

**Хэзээ:** StandardTable column filter, SegmentFilter, PeriodSelector tooltip.

**Glass tokens:**
- `bg`: light `white` / dark `gray.700`
- `border-color`: light `gray.200` / dark `gray.600`
- `box-shadow`: `lg`
- `placement`: `bottom-end` (filter), `bottom-start` (menu)
- `isLazy: true` — нээх хүртэл render хойшилуулна.

**Шинэ Popover нэмэх дүрэм:**
- Toolbar action бол `<Menu>` ашиглах ✅ (Chakra-ийн menu-ийн focus-trap бэлэн).
- Inline filter / quick-action бол `<Popover isLazy>` + `<PopoverTrigger>` + `<PopoverContent>`.

---

## 6. Menu — dropdown action list

**Хэрэглээ:** Row action (3-dot), `Group▼` toolbar, `Columns▼`, language picker.

**Standard:**

```tsx
<Menu>
  <MenuButton as={Button} size="sm" variant="outline" rightIcon={<ChevronDown />}>
    Үйлдэл
  </MenuButton>
  <Portal>  {/* tooltip-тэй давхцахаас сэргийлэх */}
    <MenuList fontSize="sm" minW="140px">
      <MenuItem onClick={onView}>Харах</MenuItem>
      <MenuItem onClick={onEdit}>Засах</MenuItem>
      <MenuDivider />
      <MenuItem color="red.500" onClick={onDelete}>Устгах</MenuItem>
    </MenuList>
  </Portal>
</Menu>
```

**MenuList glass (зайлшгүй):**
- Light: `bg: rgba(255,255,255,0.65)`, border `rgba(255,255,255,0.7)`
- Dark: `bg: rgba(26,32,44,0.55)`, border `rgba(255,255,255,0.08)`
- `backdrop-filter: blur(16px) saturate(160%)`
- `border-radius: 14px`, items `border-radius: 10px`

---

## 7. Tooltip — hover hint

**Хэрэглээ:** Icon-only товч (Edit, Delete, Excel export), хадгалагдсан table cell-ийн full text.

**Standard glass:**

```tsx
<Tooltip
  hasArrow
  label={t('btn_delete')}
  bg="rgba(255, 255, 255, 0.1)"
  backdropFilter="blur(6px)"
  color="white"
  border="1px solid rgba(255, 255, 255, 0.2)"
  boxShadow="lg"
  fontSize="12px"
  placement="top"
>
  <IconButton ... />
</Tooltip>
```

> Tooltip нь icon-only товчинд **үргэлж** хавсрана. Текст label-той товчинд tooltip нэмэхгүй.

---

## 8. Toast — async feedback

**Хэрэглээ:** API success / error / info / warning.

**Standard call:**

```tsx
const toast = useToast()

toast({
  title: t('toast_save_success'),
  status: 'success',          // 'success' | 'error' | 'warning' | 'info'
  duration: 3000,
  isClosable: true,
  position: 'top-right',
})
```

**Дүрэм:**
- `position: 'top-right'` — нэгдсэн.
- `duration`: success 3000, error 5000, info 4000.
- API error-д `error.response?.data?.message ?? t('toast_generic_error')` гэж backend-ийн message ашиглах.
- Form validation error → toast биш, field-level error message дээр (Chakra `<FormErrorMessage>`).

**ThemeToaster:** `frontend/web/src/components/ThemeToaster.tsx` — глобал toast theme override (glass) тогтоосон.

---

## 9. Confirmation flow гэрээ (decision tree)

```
Үйлдэл нь reversible бий юу?
  ├ Yes → Toast success-аар л хариу өгнө (no confirm)
  └ No  → AlertDialog confirm
            ├ Delete       → btn_delete (red)
            ├ Reverse      → btn_reverse (orange) + reason input
            ├ Discard form → btn_discard
            └ Status-change (Post / Approve) → btn_confirm + GL preview snippet
```

**GL preview snippet:** Post / Reverse-ийг confirm modal дотор **журналын Dr/Cr summary** preview харуулна. Хэрэглэгч буруу журнал post хийхгүй болно.

---

## 10. Хэв маягийн нэгдсэн дүрэм

| Property | Утга |
|----------|------|
| Overlay backdrop | `blackAlpha.300` (light) / `blackAlpha.600` (dark) |
| Content blur | `blur(14-16px) saturate(160%)` |
| Border-radius | `md` (8px) Modal/Drawer, `14px` Menu |
| Footer button order | Cancel зүүн → Action баруун |
| Destructive button color | `red` (delete), `orange` (reverse) |
| Primary button color | `blue` (save / submit / post) |
| Close button | `<ModalCloseButton>` / `<DrawerCloseButton>` — top-right corner |
| Esc key | заавал dismiss |
| Focus trap | Chakra default — өөрчилөхгүй |

---

## 11. Шалгалт

- [ ] Бүх destructive үйлдэл AlertDialog-той (raw `confirm()` ашигласангүй).
- [ ] AlertDialog-д `leastDestructiveRef` өгсөн.
- [ ] Modal/Drawer-ийн заагч `<ModalCloseButton>` бүрд бий.
- [ ] Tooltip нь icon-only товчинд бий.
- [ ] Toast `position: 'top-right'`-ээр нэгдсэн.
- [ ] Glass token light/dark хоёулаа зөв ажиллаж байгаа эсэх.
- [ ] Бүх popup string `t(...)` орчуулга-р хийгдсэн (hardcoded string ❌).
