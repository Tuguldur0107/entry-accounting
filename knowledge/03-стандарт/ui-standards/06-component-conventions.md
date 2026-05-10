# 06. Компонентын ёс журам

> Entry UI-ийн **жижиг боловч хатуу** дүрмүүд. Шинэ хуудас зурахдаа эдгээрийг хатуу дагана.

---

## 1. Файл бүтэц

```
frontend/web/src/
├── app/                       # Next.js App Router (route бүрд page.tsx)
│   ├── modules/<module>/<page>/page.tsx
│   └── modules/<module>/<page>/_components/<inline>.tsx
├── components/
│   ├── common/                 # ← бүх module хуваарилах reusable
│   ├── <module>/               # тус модулийн only-used компонент
│   ├── ChakraProviders.tsx
│   ├── ColorModeToggle.tsx
│   └── LanguageToggle.tsx
├── context/                    # React context-ууд (LanguageContext, WalletContext, ...)
├── hooks/                      # Custom hooks (usePeriods, useAuth, ...)
├── lib/                        # Pure logic (api.ts, i18n/, excel.ts)
└── theme/                      # Chakra theme extension
```

**Дүрэм:** App Router page бүр **зөвхөн UI assembly** хийнэ — domain logic-ийг hooks/lib рүү хөдөлгөнө.

---

## 2. Component naming

| Зүйл | Жишээ |
|------|-------|
| Compoнентын файл | `PascalCase.tsx` (e.g. `StandardTable.tsx`) |
| Компонентын экспорт | `export function StandardTable(...)` |
| Hook | `use*` prefix — `useLanguage`, `usePeriods` |
| Context provider | `<XxxProvider>` + `useXxx()` hook pair |
| Page-only inline | `app/.../_components/Foo.tsx` (underscore-аар private) |

---

## 3. Props convention

**Required vs optional:**
- TypeScript `interface` ашиглан props тодорхойлно (type alias биш).
- Optional бол `?` тэмдэглэнэ — undefined-ийг өөр хайх хориотой.

**Rest spread:**
- Reusable button-уудад Chakra props-ийг forward хийхдээ `...props` ашиглана:
  ```tsx
  interface DeleteButtonProps extends ButtonProps {
    onClick: () => void
    label?: string
  }
  ```

**i18n label:**
- `label?: string` props нь optional — өгөөгүй үед компонент дотор `t('btn_default')` дуудах.

**Callback naming:**
- Event handler `on<Event>` — `onSave`, `onCancel`, `onChange`.
- Async confirm `handleConfirm` гэж дотор бичнэ.

---

## 4. Loading / Error / Empty pattern

Ийм 3 төлөв бүхэн **үргэлж** хариулна:

```tsx
if (loading) return <LoadingSpinner />
if (error) return <Alert status="error"><AlertIcon />{error.message}</Alert>
if (data.length === 0) return <EmptyState message={t('tbl_no_data')} action={...} />
return <StandardTable ... />
```

| State | Compoнент | i18n key хэв маяг |
|-------|----------|-------------------|
| Loading | `<LoadingSpinner>` (skeleton-той бол `<Skeleton>`) | – |
| Error | Chakra `<Alert status="error">` + retry товч | `err_*` |
| Empty | Per-page custom card (CTA-той) | `<page>_empty_*` |

---

## 5. Form pattern

**Controlled state:**
- `useState<FormType>` — нэг state object.
- Validation: `react-hook-form` биш — Entry одоогийн convention нь Chakra-ийн `<FormControl isInvalid={...}>` + manual validation function.
- Field error → `<FormErrorMessage>` (toast биш).

**Save flow:**

```
[Submit] → setLoading(true)
        → POST /api
        → success: toast + navigate
        → error: setError(message), keep form open
```

**Discard guard:** Хэрэглэгч form-д өөрчлөлт хийгээд back/close гэж оролдвол `AlertDialog` (`dlg_discard_*`)-аар асуу.

---

## 6. Page layout (модуль доторх)

Standard module page бүтэц:

```tsx
'use client'

export default function ModulePage() {
  // 1. Hooks
  const { t } = useLanguage()
  const router = useRouter()

  // 2. State (top-level useColorModeValue here)
  const cardBg = useColorModeValue('white', 'gray.800')

  // 3. Data fetching
  const { data, loading, error, refetch } = useApi(...)

  // 4. Handlers
  const handleNew = () => router.push('...')

  // 5. Conditional render
  if (loading) return <LoadingSpinner />
  if (error) return <Alert ...>...</Alert>

  // 6. Markup
  return (
    <Box>
      <HeaderTabs<Module> />
      <Box p={4}>
        <StandardTable ... />
      </Box>
    </Box>
  )
}
```

**HeaderTabs:** Module бүрд өөрийн `HeaderTabs<Name>.tsx` (e.g. `HeaderTabsAr`, `HeaderTabsCash`) — ModuleSubnav-аас үүсэлтэй.

---

## 7. Permission hooks

Permission-аар UI-ийг хязгаарлахдаа `usePermission()` hook ашиглана:

```tsx
const { has } = usePermission()

return (
  <Toolbar>
    {has('ar:create') && <Button onClick={onNew}>+ Шинэ</Button>}
    {has('ar:approve') && <Button onClick={onPost}>Post</Button>}
  </Toolbar>
)
```

Permission key formaт: `<module>:<action>` — `ar:view`, `ar:create`, `ar:edit`, `ar:approve`, `ar:delete`.

> Backend RBAC: `requireAuth` + `requirePermission(module)` middleware (CLAUDE.md дагалдсан). Frontend нь хэрэглэгчийн `permissions` массивыг `AuthContext` дотор хадгалдаг.

---

## 8. Routing convention

**Жагсаалт хуудас:** `/modules/<module>/<entity-list>` (`InvoiceList`, `transactions`)

**Шинэ:** `/modules/<module>/<entity-list>/new`

**Харах:** `/modules/<module>/<entity-list>/view/[id]`

**Засах:** `/modules/<module>/<entity-list>/edit/[id]` (зөвхөн зарим module-д)

**Sub-tab:** `?tab=<key>` query parameter. URL-аар share хийх боломжтой байх.

---

## 9. localStorage key namespace

`storageKey` бүхэн **давтагдашгүй** байх. Зөвлөмж формат:

```
verno_<module>_<purpose>
```

Жишээ:

| Key | Зорилго |
|-----|---------|
| `gl_journals_main_col_widths` | StandardTable баганын өргөн (`<storageKey>_col_widths`) |
| `gl_journals_main_col_visible` | StandardTable visibility |
| `verno_lang` | Хэлний сонголт |
| `chakra-ui-color-mode` | Chakra default |
| `wallet_level_selection` | WalletContext дахь tier |

> **Урьдчилан сэргийлэх:** Хүний хувийн өгөгдөл (PII), token-ийг localStorage-д хэзээ ч **бичихгүй**.

---

## 10. Test convention

| Layer | Tool | Файл хэв маяг |
|-------|------|--------------|
| Unit | Vitest | `<name>.test.ts(x)` ажлын файлын хажууд |
| Integration | Vitest + jsdom | `tests/integration/*.test.ts` |
| E2E | Playwright | `playwright.config.ts` + `tests/e2e/*.spec.ts` |

**Smoke test:** `i18n.test.ts` — бүх 4 хэлийн файлд `keys.ts`-ийн бүх key байгаа эсэх.

---

## 11. Шалгалт

- [ ] `useColorModeValue` `.map()` дотор алга.
- [ ] Бүх UI string `t(...)` ашиглаж байгаа.
- [ ] StandardTable-ийг өөрөөр зурсан газар алга.
- [ ] `storageKey` давтагдсан газар алга (codebase grep).
- [ ] Page бүрд Loading / Error / Empty 3 state хариулсан.
- [ ] Permission товч `usePermission().has(...)`-ээр хамгаалагдсан.
- [ ] Routing convention баримталсан.
