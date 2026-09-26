# UI, хүснэгт (AG Grid), Excel импорт/экспортын стандарт

> Үндсэн `CLAUDE.md`-аас зөөсөн дэлгэрэнгүй (UI стандарт). Энэ хэсгийн кодыг хөндөхийн ӨМНӨ бүтнээр нь уншина. Хатуу дүрмийн хураангуй `CLAUDE.md`-д үлдсэн — хоёуланг ЗЭРЭГ шинэчилнэ.

## UI стандарт

### Дизайн токен — эх сурвалж

```
ui-kit/tokens.css          ← ЦОРЫН ГАНЦ ЭХ СУРВАЛЖ (:root = light, .dark = dark)
   ├─→ app/globals.css     @import — бүтэн систем эндээс авна
   └─→ ui-kit/preview.html статик preview (dev server хэрэггүй, WCAG контраст тооцно)
```

Өнгө/сүүдэр/радиус өөрчлөх бол **зөвхөн `ui-kit/tokens.css`**. Component дотор
hex/rgba бичихийг хориглоно. Заавар: [ui-kit/README.md](../../ui-kit/README.md).
Амьд component gallery: `/settings/ui-kit`.

### Өнгө аяс

```css
body: var(--ea-bg) | card: var(--ea-surface) | border: var(--ea-border)
primary: var(--ea-primary) | danger: var(--ea-danger) | success: var(--ea-success)
text: var(--ea-text-1) | secondary: var(--ea-text-3)
```

**Семантик өнгө — текст vs дэвсгэр:**

| Хэрэглээ | Токен | Шалтгаан |
|----------|-------|----------|
| ТЕКСТ (амжилт/аюул/анхааруулга) | `--ea-success-fg` / `--ea-danger-fg` / `--ea-warning-fg` | Суурь өнгө цайвар surface дээр 2.5–3.8:1 — AA давахгүй |
| Дэвсгэр, хүрээ, дүрс, chart | `--ea-success` / `--ea-danger` / `--ea-warning` | Дүүргэлтэд контраст шаардлага бага |

**Dark mode:** суурь нь тас хар (`--ea-bg: #000`), цэнхэр нь **зөвхөн accent**
(товч, линк, focus, сонгосон мөр). Цэнхэрийн ханалт 62% — тас хар дээр неон
гэрэлтэхээс сэргийлнэ. Контраст 8.17:1 (AAA).

### Хөвөгч ажлын панель (зөөх · хэмжээ · хавсралт)

`components/panel/floating-panel.tsx` — панелийн ЦОРЫН ГАНЦ жааз.

- **Зөөх:** гарчгаас чирнэ; **хэмжээ:** 4 ирмэг + 4 булангаас татна. Чирсэн
  мөчид панелийн бодит тэгш өнцөгт `panel.rect`-д бүртгэгдэж, цаашид байрлал
  ЗӨВХӨН түүнээс тооцогдоно (`slot`-ийн CSS хэрэглэгдэхгүй) — нэг байрлалд
  хоёр эзэн байхгүй. ⟲ «Байрлалыг сэргээх» товч анхны суудалд буцаана
- **Геометр нь ЦЭВЭР** `lib/ui/panel-geometry.ts` (тесттэй): анхны байрлал,
  чирэлт, хэмжээ солилт, хил. Панель дэлгэцээс БҮРЭН гарахгүй
  (`PANEL_KEEP_VISIBLE` = 160px гарчиг үргэлж харагдана), topbar-ын доогуур
  орохгүй, `PANEL_MIN_WIDTH`/`HEIGHT`-ээс доош шахагдахгүй; цонх жижгэрэхэд
  панель дотогш эргэж орно. Component дотор шинэ геометр бодохыг ХОРИГЛОНО
- Чирэлт **3px хөдөлсний ДАРАА** эхэлнэ — гарчгийн давхар даралт (дэлгэц
  дүүрэх) болон товчнуудтай мөргөлдөхгүй; дэлгэц дүүрэн үед чирэлт унтарна
- **Хавсралт панельд НЭГ МӨР:** `components/attachments/attachment-section.tsx` —
  `Хавсралт [төрөл ▾] [⬆ Файл хавсаргах] [📎 Хавсралт харах · N]`. Жагсаалт нь
  ЗӨВХӨН popup-д; хавсралтгүй үед «харах» товч идэвхгүй бөгөөд **хоосон блок
  (EmptyState) панельд ХЭЗЭЭ Ч гарахгүй** — гол агуулгыг доош түлхэхийг
  хориглоно. Панель дотор `AttachmentList`-ийг ШУУД суулгахгүй; бүтэн таб
  байгаа газарт л шууд (PO панелийн «Хавсралт» таб)
- **Хавсралтын логик НЭГ л газар** (`attachment-list.tsx`): `useAttachments`
  (төлөв + хуулах/устгах — дуудагч бүр НЭГ controller, давхар fetch хийхгүй) +
  `AttachmentUploadBar` / `AttachmentRows` харагдах хэсгүүд. Шинэ байрлал
  нэмэхдээ эдгээрийг compose хийнэ, хуулалт/устгалтыг дахин бичихийг ХОРИГЛОНО

### Баримтын төлөв, тоо, утасны карт (UI гайд)

- **Төлөв** — `lib/status.ts` `DOCUMENT_STATUS` ЦОРЫН ГАНЦ бүртгэл (шошго, өнгө,
  дүрс, хэлбэр: ноорог тасархай, буцаагдсан зураастай, `--ea-reversed*` токен).
  Жагсаалтад `col({ eaType: "status", field: "status" })` (зөвхөн дүрс, tooltip +
  aria-label), дэлгэрэнгүйд `DocumentStatusBadge`. Хуудас бүрд өөрийн
  STATUS_LABELS/tone map бичихийг ХОРИГЛОНО
- **Үйлдлийн нэр:** «Ноорог хадгалах» / «Батлах»; «сторно» БИШ «буцаалт»
- **Тоо:** `readonly-money` 0 → «—», сөрөг «−» + улаан (`ea-negative`); хуудасны
  гол тоо `fmtMntCompact` («13.95 сая ₮», title-д бүтэн дүн) — НЭГ л ширхэг
- **Маягтын мөрийн grid** (`journal-lines-grid`, `arap-lines-grid`) шүүлтүүр,
  эрэмбэлэлтгүй (`FORM_GRID_COL_DEF`)
- **Утас (<640px):** жагсаалт хүснэгтийн оронд `MobileCardList`
  (`useIsMobileViewport`) — төлөв · нэр · дүн, дарахад десктопын давхар даралттай
  ижил панель. Одоо: журнал, АР/АП баримт
- **Латин UI текст** `tests/ui-latin-text.test.ts`-ээр сахиулагдана (allowlist-тэй)

### Тайлангийн стандарт — ЗААВАЛ мөрдөнө

Бүх тайлан (GL, касс, насжилт, бараа, POS, ҮХ, өртөг, хангамж, цалин) НЭГ
зарчмаар ажиллана (2026-09-24 — өмнө нь зарим нь топбараар, зарим нь хуудас
доторх табаар ӨӨР тайлан руу шилждэг, зарим нь өөрийн огнооны талбартай,
зарим нь хөл дүнгүй байв):

1. **Тайлан СОЛИХ = ЗӨВХӨН топбарын сонгогч** (`HeaderReportSelect`).
   Жагсаалтын ЦОРЫН ГАНЦ эх нь `lib/constants/report-registry.ts` — шинэ
   тайлан = нэг мөр. Нэг хуудсанд параметрээр солигддог модуль `param`-тай
   (GL `report`, Бараа `tab`, Цалин `view`); сонгогч огнооны параметрийг л дагуулна
2. **Хуудас доторх таб = НЭГ тайлангийн ЗҮСЭЛТ л** (Бараагаар / Өдрөөр,
   Дансаар / S8 / Дэлгэрэнгүй, урьдчилгаа / сүүл) — өөр тайлан руу шилжүүлэх
   таб ХОРИОТОЙ
3. **Огноо = ЗӨВХӨН топбарын период** — тайлан дотор огнооны input /
   «Шинэчлэх» товч / сарын сонгогч тавихгүй; URL-ийн `start`/`end`/`period`/
   `asOf` нь deep link-ээр л дарна (§4). Үр дүнгүй сар руу ЧИМЭЭГҮЙ шилжихгүй —
   хоосон төлөв юу хийхийг заана
4. **Жааз** `components/reports/report-layout.tsx`: дээрээс доош тогтмол
   `ReportHeader` (гарчиг = registry-ийн нэр, `meta` = `reportRangeLabel`
   + тайлбар, баруун талд Excel/хэвлэх) → `ReportToolbar` (`views` зүсэлт →
   `filters` шүүлтүүр) → хүснэгт (`height="flex"`) эсвэл `ReportEmpty`
5. **Хөл дүн** (`pinnedBottomRowData`) нийлбэр УТГАТАЙ багана бүрд: валют
   холимог бол валют бүрд мөр, хэмжих нэгж холимог бол тоо хэмжээгүй,
   нэгж өртөг/дундаж/хувь хоосон (NaN → formatter «»), нэг мөр олон бүлэгт
   тоологдох бол давхардалгүй нийлбэр

`tests/report-standard.test.ts` сахиулна: тайлангийн route бүр registry-д,
registry-ийн href бодит хуудас, тайлангийн view-д огнооны input / «Шинэчлэх»
байхгүй, `ReportPage`/`ReportHeader` хэрэглэсэн, хасагдсан шилжүүлэх табууд
эргэж ирээгүй. Шинэ тайлангийн view нэмбэл тестийн `REPORT_VIEWS`-д бүртгэнэ.

### Таб ба шүүлтүүрийн chip

`components/ui/tabs.tsx` — хуудас доторх таб/шүүлтүүрийн **ЦОРЫН ГАНЦ**
хэрэгжилт; өөрийн tab markup бичихийг хориглоно:

- `<PageTabs size="sm|md" trailing={...} />` — доогуур зураастай хэсгийн таб
  (option бүр `disabled` дэмжинэ)
- `<FilterChips />` — дугуй статус шүүлтүүр (`count` тоолуур, `tone="warning"`)

Хэрэглэгдэж буй газрууд: AI тохиргоо, касс/бараа жагсаалт, дансны тохиргоо
(2 түвшин), өртгийн тохиргоо. Амьд жишээ: `/settings/ui-kit`.

### Формын талбар (FormField / SwitchField)

`components/ui/form-field.tsx` — Label + input + hint жааз, Switch + гарчиг +
тайлбар. Форм/диалог бүрд өөрийн `Field`, `SwitchField` бичихийг ХОРИГЛОНО
(POS тохиргоо, хөнгөлөлтийн дүрэм, ээлжийн диалог үүгээр). Амьд жишээ
`/settings/ui-kit` → «Form элементүүд».

### Popup / Modal

```
Overlay: rgba(0,0,0,0.4)
Content: #fff, border-radius 8px, box-shadow
Header: гарчиг + × товч | Footer: [Болих] [Хадгалах]
Хаах: × товч / Болих / overlay дарах / Esc
```

### Destructive үйлдэл

```
Устгах → confirm диалог: [Болих] [Устгах]
Ашиглагдсан данс устгах → анхааруулна
```

---

## Хүснэгтийн стандарт (AG Grid Community)

Бүх хүснэгтийн UI **AG Grid Community v35**-д суурилдаг. `<table>`, shadcn `<Table>`,
эсвэл custom CSS grid-ээр шинээр хүснэгт бичихийг хориглоно.

### Эх сурвалж файлууд

```
components/datagrid/
├── DataGrid.tsx          Wrapper (theme, keyboard, clipboard, undo/redo defaults)
├── DataGridDynamic.tsx   dynamic(ssr:false) — БҮХ callsite энийг import
├── ComboFilter.tsx       Багана шүүх combo фильтер
└── datagrid.css          Grid стайл

components/account/       Дансны нэгдсэн component-ууд (бүх модульд)
├── account-segment-picker.tsx  Идэвхтэй сегмент бүрд searchable dropdown
└── account-input.tsx           Гараар бичих + ⌄ товчоор сегмент picker popover

components/journal/
└── journal-lines-grid.tsx      Журналын мөрийн хүснэгт (Данс/Дт/Кт/Тайлбар) —
                                GL journal entry ашиглана, Cash/VAT/Payroll-д reuse

lib/grid/                 Туслах модулиуд (wrapper биш)
├── types.ts              ColumnTypeId, EaColDef, RowMeta, BatchPatch, HistoryEntry
├── registerGrid.ts       AG Grid module registry (DataGrid-аас л дуудна)
├── theme.ts              themeQuartz.withParams({...}) → --ea-* CSS vars
├── validators.ts         required, nonNegativeNumber, debitXorCredit, segmentCodeShape, accountExists, dateISO
├── formatters.ts         fmtMnt, parseMntInput, moneyValueFormatter, accountValueFormatter
├── columnTypes.ts        ColumnTypeId → Partial<ColDef> ЦОРЫН ГАНЦ бүртгэл
├── segments.ts           buildSegCode, parseSegParts, fmtAccountDisplay, normalizePastedAccount
├── clipboard.ts          processClipboardData (TSV + сегмент-аатай account column танина)
└── editors/
    ├── SegSelect.tsx                Portal-mounted searchable dropdown
    ├── AccountSegmentEditor.tsx     Inline данс editor: гараар бичих + ⌄ сегмент panel
    │                                (AG Grid v32+: onValueChange-ээр commit, портал нь
    │                                ag-custom-component-popup class-тай байх ЁСТОЙ)
    ├── DebitCreditEditor.tsx        Number editor + Dr⊕Cr mutex
    └── SwitchCellRenderer.tsx       shadcn Switch нүднэнд

lib/store/grid-store.ts   Zustand factory: createGridStore<TData>(surfaceId, initial, capacity=100)
                          — patch-based undo/redo, buildBatch() → Server Action
```

### Column type registry

`lib/grid/columnTypes.ts` бол **шинэ column kind тодорхойлох цорын ганц газар**.
Surface-үүд compose хийдэг бөгөөд багана тус бүрд `valueParser` / `valueFormatter` /
alignment / editor зэргийг дахин зарлахгүй. Дэмжих kinds:

| `eaType` | Хэрэглээ |
|----------|---------|
| `text` | Текст редактор |
| `readonly-text` | Текст харагдах |
| `number-money` | MNT тоо, баруун зэрэгцүүлэлт, locale-tolerant parse |
| `readonly-money` | Тооцоо харагдах |
| `debit` / `credit` | DebitCreditEditor + mutex |
| `account-segment` | AccountSegmentEditor (popup) + valueFormatter |
| `date` | `YYYY-MM-DD` text editor |
| `switch` | SwitchCellRenderer (callback dispatch) |
| `select` | agSelectCellEditor |

### Keyboard / mouse contract

| Товч | Үйлдэл |
|------|--------|
| Нэг даралт | Нүдний мужийн ЗАНГУУ (Excel-маягийн сонголт эхэлнэ) |
| Shift+даралт | Зангуунаас тэгш өнцөгт муж сонгоно |
| Давхар даралт | Мөрийн дэлгэрэнгүй панель / edit mode (жагсаалтын grid бүрд) |
| Arrow keys | Нүд хооронд |
| Tab / Shift+Tab | Дараагийн / өмнөх editable нүд |
| Enter / Shift+Enter | Commit + доош / дээш |
| F2 | Edit mode эхлүүлэх |
| Esc | Edit-ийг буцаах / мужийн сонголтыг арилгах |
| Ctrl/Cmd+C / V / X | Copy (сонгосон муж → TSV) / Paste / Cut |
| Ctrl/Cmd+Z / Y | Undo / Redo |
| Delete | Сонгосон нүднүүдийг цэвэрлэх |

**Хуудас эзэмшдэг товчлол:** F2 = топбарын «+ Шинэ» аппын ХААНА Ч (кассын
дэлгэцэд ч — хайлтын input `data-global-hotkeys="F2"`-оор нэвтрүүлнэ); кассын
бараа хайлт F3 / «/». Хуудас глобал товчлолыг өөрөөр хэрэглэвэл
`lib/ui/hotkeys.ts`-ийн `PAGE_OWNED_HOTKEYS`-д ЗААВАЛ бүртгэнэ — глобал
сонсогч тэнд алгасна (`pageOwnsHotkey`; касс «/»-г эзэмшдэг тул палитр
Cmd/Ctrl+K-гаар). Хуудасны нэрийг глобал сонсогчид hardcode хийхгүй
(`tests/hotkeys.test.ts`).

**Мужийн сонголт + copy (DataGrid built-in, бүх grid-д):** AG Grid
Community-д range selection байхгүй тул `DataGrid.tsx` дээр custom
хэрэгжсэн — нэг даралт зангуу, Shift+даралт муж, `ea-range-cell` класс
(багана бүрийн `cellClassRules`-д wrapper автоматаар шингээдэг),
Ctrl/Cmd+C нь мужийг TSV болгож clipboard-д тавина (тоон утга raw, бусад нь
formatted) — MS Excel-д шууд paste хийгдэнэ. Нэг агшинд нэг л grid-д
сонголт идэвхтэй. Мөрийн сонголт (batch үйлдэл) зөвхөн checkbox-оор —
`enableClickSelection` default false. **Дэлгэрэнгүй панель нээх нь ДАВХАР
даралт** — шинэ жагсаалтын grid нэмэхдээ `onCellDoubleClicked` /
`onRowDoubleClicked` хэрэглэнэ, нэг даралтад panel нээхийг хориглоно.

### Мөрийн өндөр (заавал мөрдөх)

Нэг grid-д мөрийн өндрийг **НЭГ л эзэн** тогтооно:

- Мөрүүдээ өөрөө өрдөг grid (журналын жагсаалт — мөр бүр журналын бүх
  бичилтийг харуулдаг) → `getRowHeight`
- Чөлөөт урт текст → баганын `autoHeight: true`

**Хоёуланг ХАМТ хэрэглэхийг ХОРИГЛОНО.** AG Grid эхлээд `getRowHeight`-ээр
мөрүүдээ байрлуулаад, дараа нь `autoHeight` баганыг хэмжиж өндрийг ДАХИН
тааруулдаг — рендерийн дараа мөрүүд босоо чиглэлд ШИЛЖИНЭ. Улмаар хулганы
доорх мөр өөр болж, хэрэглэгч дарсан мөрийнхөө ОРОНД хажуугийнхыг нээдэг
(2026-09-19: журналын жагсаалтад яг ийм алдаа гарч, дарсан журналын оронд
дараагийн журналын панель нээгдэж байв). Урт текстийг мөрийн ӨӨРИЙН өндөрт
`-webkit-line-clamp`-аар багтаана, бүтнээр нь `title`-д.

`tests/grid-row-height.test.ts` энэ зөрчлийг статикаар барина.

### Paste contract

- TSV / CSV — Excel, Sheets-ээс шууд хуулна
- Number нүднүүд `parseMntInput`-ээр `₮`, зай, таслал, цэгийг танина
- Account-segment баганад 10-part dotted ЭСВЭЛ active-only N-part код хүлээж авна
  (`normalizePastedAccount` нь идэвхгүй position-уудыг `SEG_DEFAULTS`-ээр padded)
- Алдаатай нүд улаан-border invalid тэмдэглэгдэнэ, paste-ийг REJECT хийхгүй

### Mutation contract

```
cell edit  →  DataGrid onCellValueChanged  →  setRows / store.applyPatches
add row    →  api.applyTransaction({ add }) + store.addRow({ isNew: true })
delete row →  store.removeRow(id)
save       →  store.buildBatch() → { create, update, delete: string[] } → Server Action
```

**Client-ээс DB-руу шууд хандахгүй.** Mutation болгон Server Action дайраад явна.

### Сегмент дүрэм (заавал биелүүлэх)

- Editor бүр **бүтэн 10-part dotted код** буцаана (`buildSegCode`-р).
- **Бүх сегмент бөглөгдөнө:** бичигдээгүй (идэвхгүй ЭСВЭЛ идэвхтэй ч
  сонгоогүй) сегмент **оронгийн тоогоор "0"** утга авна — `SEG_DEFAULTS` нь
  SEGMENT_DEFS-ийн length-ээс автоматаар гарна (S1="000", S2="000000"…).
  Онцгой: S3 үндсэн данс default-гүй (заавал сонгоно), S9="GL".
- Идэвхгүй байсан сегментийг идэвхжүүлэхэд хуучин дата "0…0" утгатайгаа
  шууд харагдана — migration хэрэггүй (parseSegParts хуучин хоосон хэсгийг
  ч default-аар уншина; DB-ийн хуучин код 2026-08-д нэг удаа 0-жүүлэгдсэн).
- Picker бүрд "Ерөнхий (default)" 0-сонголт автоматаар нэмэгдэнэ
  (`withSegDefaultOption`, S3-д үгүй).
- Read/display: `fmtAccountDisplay(code, activeSegIds)` идэвхтэй хэсгийг л
  үзүүлнэ; данс (S3) сонгогдоогүй бол бүхэлдээ хоосон.
- Paste/Excel/AI/MCP бүгд `normalizePastedAccount`-оор normalize хийнэ —
  хуучин форматын (хоосон хэсэгтэй) код мөн 0-жиж орж ирнэ.

### SSR

AG Grid module init үед `document` хэрэгтэй. Бүх surface `DataGridDynamic`-ийг
(`next/dynamic` `ssr:false`) ашиглана. Page-ууд Server Component хэвээр үлдэж
`rowData`-г prop-оор дамжуулна.

### Surface inventory

| Surface | Файл | Хэлбэр |
|---------|------|--------|
| Journal entry (бичих/засах) | [components/gl/journal-entry-form.tsx](../../components/gl/journal-entry-form.tsx) | `JournalLinesGrid` reuse — inline данс editor + Dr⊕Cr mutex + undo/redo |
| Journal lines grid (shared) | [components/journal/journal-lines-grid.tsx](../../components/journal/journal-lines-grid.tsx) | Дахин ашиглагдах мөрийн хүснэгт — pinned totals, clipboard, min-мөр хамгаалалт |
| Journal list | [components/gl/journal-list.tsx](../../components/gl/journal-list.tsx) | Read-only, dynamic row height, pagination. Мөр = `JournalListRow` (`lib/gl/journal-list-data.ts`): ваучер + эх баримтын (касс / АР/АП) харилцагч, валют, ханш + үүсгэсэн хэрэглэгч; Дт/Кт MNT ба валютаар (MNT ÷ ханш — лавлагаа, MNT баримтад хоосон), Дансны нэр багана. "Журналын нэр" = `description` |
| Мөнгөн гүйлгээний жагсаалт | [components/cash/cash-documents-view.tsx](../../components/cash/cash-documents-view.tsx) | Veritech "Харилцахын баримт"-тай ижил багана: Дансны код (мөнгөн дансны GL) · Валют · **Дебит дүн / Кредит дүн** (MNT — орлого Дт, зарлага Кт, шилжүүлэг хоёулаа) · Ханш · Дебит/Кредит /валют/ · Харилцагчийн код (`counterparties.code`) · Харилцагчийн нэр · Харилцах GL данс · Журналын дугаар · МГ код / МГ нэр (S8). Дт/Кт задаргаа ЦЭВЭР `lib/cash/list-columns.ts` (тесттэй) |
| Cash баримтын панель | [components/panel/cash-doc-panel.tsx](../../components/panel/cash-doc-panel.tsx) | `JournalLinesGrid` reuse (readOnly) — сегмент panel, харилцагч (код · нэр), МГ код · нэр, журналын дугаар, холбогдсон нэхэмжлэхийн линк, Батлах/Буцаах/Устгах |
| Accounts config | [components/gl/accounts-table.tsx](../../components/gl/accounts-table.tsx) | Inline switches, batch save, group headers |
| GL trial balance | [components/gl/gl-balance-view.tsx](../../components/gl/gl-balance-view.tsx) | Multi-header colGroup + pinned totals |
| Balance sheet / IS / Cash flow | [components/gl/report-grid.tsx](../../components/gl/report-grid.tsx) | Section / group / subtotal / total мөртэй flat row model |
| Өртгийн хяналт (C1/Орлого/Зарлага/C2) | [components/costing/cost-control-report.tsx](../../components/costing/cost-control-report.tsx) | **ТОГТМОЛ** 2 түвшний colGroup толгой (docs/cost §2.2) — дахин зохиогдохгүй; нэгж өртгийн багана нийлбэргүй |
| Гүйлгээний дэлгэрэнгүй + GL тулгалт | [components/costing/transaction-detail-report.tsx](../../components/costing/transaction-detail-report.tsx) | colGroup + `columnGroupShow: "open"` — задарч нэмэлт багана гаргана |
| Бүрэлдэхүүний задаргаа | [components/costing/component-analysis-report.tsx](../../components/costing/component-analysis-report.tsx) | Бараа × бүрэлдэхүүн, нэгжид нөлөө, хуваарилалтын лавлагаа |
| Зардлын хуваарилалт · чөлөөт (таб) | [components/costing/cost-allocation-view.tsx](../../components/costing/cost-allocation-view.tsx) | Сонголтын хүснэгт + хадгалахын өмнөх урьдчилсан хуваарь |
| Өртгийн модулийн хэсгийн таб | [components/costing/costing-section-tabs.tsx](../../components/costing/costing-section-tabs.tsx) | Зардлын хуваарилалтын 2 route-ыг НЭГ нав цэс дор — `PageTabs`, layout-д Suspense-тэй (тайлангуудад ХЭРЭГЛЭХГҮЙ — топбарын сонгогч) |
| Тайлангийн жааз (нийтлэг) | [components/reports/report-layout.tsx](../../components/reports/report-layout.tsx) | `ReportPage` · `ReportHeader` (гарчиг + муж + Excel) · `ReportToolbar` (зүсэлт → шүүлтүүр) · `ReportEmpty` — «Тайлангийн стандарт» |
| Нягтлан бодох период | [components/periods/periods-view.tsx](../../components/periods/periods-view.tsx) | Хаах / дахин нээх, сар бүрийн бичилтийн тоо |
| Хангамжийн самбар | [components/procurement/procurement-dashboard.tsx](../../components/procurement/procurement-dashboard.tsx) | Түр дансдын үлдэгдэл, ноорог/нээлттэй/хаах боломжтой PO тоолол, сүүлийн захиалгууд |
| Худалдан авалтын захиалга | [components/procurement/purchase-orders-view.tsx](../../components/procurement/purchase-orders-view.tsx) | `FilterChips` статус шүүлтүүр + хүлээн авсан/нэхэмжилсэн % багана; давхар даралт → PO панель |
| Хүлээн авалт (GR) | [components/procurement/goods-receipts-view.tsx](../../components/procurement/goods-receipts-view.tsx) | Огноо/агуулах/МБ ханш/дүн; давхар даралт → хүлээн авалтын панель |
| Зардлын хуваарилалт · PO-ийн зардал (таб) | [components/costing/unallocated-costs-view.tsx](../../components/costing/unallocated-costs-view.tsx) | Нэхэмжлэхийн мөр × бүрэлдэхүүн worklist — хуваарилсан / үлдэгдэл MNT |
| Хангамжийн тайлан | [components/procurement/procurement-report-view.tsx](../../components/procurement/procurement-report-view.tsx) | Захиалгаар / Нийлүүлэгчээр таб — гүйцэтгэлийн дүн, валют бүрийн pinned нийт |
| Нийлүүлэгчийн карт | [components/procurement/supplier-card.tsx](../../components/procurement/supplier-card.tsx) | Харилцагчийн бүртгэлээс уншина (PO-д хадгалахгүй) + нээлттэй өглөг, өмнөх захиалга |
| АР/АП мөрийн хүснэгт (shared) | [components/arap/arap-lines-grid.tsx](../../components/arap/arap-lines-grid.tsx) | `arap-doc-panel.tsx`-ээс ЗӨӨСӨН — `mode` prop (`arap` / `po_invoice` / `goods_receipt`), Нэгж үнэ + Бүрэлдэхүүн багана |
| Харилцагчийн сонгогч (shared) | [components/arap/counterparty-select.tsx](../../components/arap/counterparty-select.tsx) | АП ба PO панель хоёулаа ҮҮНИЙГ хэрэглэнэ — давхардсан сонгогч бичихгүй |
| Хавсралтын жагсаалт (нийтлэг) | [components/attachments/attachment-list.tsx](../../components/attachments/attachment-list.tsx) | Зөвхөн ui-kit (`Button`, `IconAction`, `StatusBadge`, `EmptyState`, `useConfirm`) — шинэ icon бичихгүй |
| Хавсралт — компакт мөр + popup | [components/attachments/attachment-section.tsx](../../components/attachments/attachment-section.tsx) | Панелиудын НЭГДСЭН хэрэглээ: `📎 Хавсралт · N` товч → `Dialog` дотор бүтэн жагсаалт |
| POS кассын дэлгэц (v2, дэлгүүрийн POS) | [components/pos/pos-checkout-view.tsx](../../components/pos/pos-checkout-view.tsx) | **Хүснэгт БИШ** — хүрэлцэх дэлгэцийн ticket (AG Grid стандарт хамаарахгүй, баримтын preview-тэй ижил ангилал): зүүн `checkout/product-panel` (сканнер/хайлт, бүлгийн `FilterChips`, барааны tile), баруун `checkout/ticket-panel` (мөр сонгох, −/+/×, дүн, агуулах ЭЭЛЖИЙНХ (дундуур солихгүй), үнэгүй бараа «Үнэ тохируулаагүй»; тоо −/+ эсвэл мөр дээр шууд бичих (numpad 2026-09-26-нд хасагдсан) — касс ҮНЭ ЗАСАХГҮЙ: барааны картын үнэ, жинлэдэгт кг-ийн үнэ × жин, буулгах нь хөнгөлөлтөөр; ТӨЛБӨР); `checkout/discount-dialog` (F4 — купон, баримтын ба мөрийн % хөнгөлөлт), `checkout/parked-dialog` (олон түр хадгалсан сагс); цэвэр төлөв `lib/pos/checkout-state.ts` (тесттэй); `quotePosSale` debounce 250мс (мөрийн дүн ШУУД `resolveLineAmounts`, эцсийн дүн серверийнх); баримт автомат хэвлэх (төхөөрөмжийн localStorage), Онлайн/Офлайн тэмдэг + баннер; сканнер = гар (input үргэлж focus-той); F9/F3/F4/↑↓/+−/Delete/Esc (F2 = глобал «+ Шинэ»); харилцагч кассын дэлгэцэд БАЙХГҮЙ — зээл/урьдчилгаа/кредит хэлбэрт л `payment-dialog`-д сонгоно |
| POS төлбөрийн диалог | [components/pos/payment-dialog.tsx](../../components/pos/payment-dialog.tsx) | Хэлбэрийн товчнууд, мөр бүрд дүн/лавлагаа/бэлгийн карт/кредит, хурдан бэлэн, Төлсөн/Үлдэгдэл/Хариулт (`roundToCashUnit`) — server `planPayments` эрх мэдэлтэй |
| POS борлуулалтын жагсаалт | [components/pos/sales-list-view.tsx](../../components/pos/sales-list-view.tsx) | `FilterChips` статус + Борлуулалт/Буцаалт, огнооны муж (URL → cookie), давхар даралт → `pos-sale` панель |
| POS ээлж / Z-тайлан | [components/pos/shifts-view.tsx](../../components/pos/shifts-view.tsx) | Ээлжийн grid, нээх/хаах диалог (`shift-dialogs.tsx`), тоолсон vs системийн бэлэн, зөрүү |
| POS тохиргоо | [components/pos/pos-settings-view.tsx](../../components/pos/pos-settings-view.tsx) | 3 дэд таб: дансны роль/хязгаар · төлбөрийн хэлбэр grid · хөнгөлөлтийн дүрэм grid (`discount-rule-dialog.tsx`) + симуляци |
| Борлуулалтын тайлан | [components/pos/sales-report-view.tsx](../../components/pos/sales-report-view.tsx) | 8 зүсэлт (гүйлгээ/бараа/өдөр/салбар/кассчин/хэлбэр/харилцагч/дүрэм) — «Гүйлгээ»-нд салбар, ээлж, eBarimt статус + ДДТД; «Өдрөөр»/«Салбараар»-т eBarimt илгээсэн/чек; COGS суурь `final`/`provisional` ил, pinned нийт |
| Цалингийн хуудас (payslip) | [components/payroll/payslip-report-view.tsx](../../components/payroll/payslip-report-view.tsx) | Ажилтны жагсаалт (pinned нийт) + A4 хуудас: давхар даралт → нэг ажилтан, «Бүгдийг хэвлэх» → ажилтан бүр шинэ хуудсанд (`ea-printing-payslip`) |
| POS борлуулалтын панель | [components/panel/pos-sale-panel.tsx](../../components/panel/pos-sale-panel.tsx) | Read-only мөрийн grid (хөнгөлөлт, НӨАТ, буцаасан, урьдчилсан COGS), төлбөр/буцаалт/холбоос, Буцаалт диалог, Дахин хэвлэх |

---

## Excel импорт/экспортын стандарт

Excel-тэй харилцах БҮХ зам нэг стандартаар явна — шинэ импорт/экспорт нэмэхдээ
өөр parser/dialog зохиохгүй, доорх хэсгүүдийг compose хийнэ.

### Эх сурвалж файлууд

```
lib/excel/
├── import-spec.ts   Цэвэр логик (тесттэй): ImportSpec<T>, parseMatrix,
│                    parseAmountCell (₮/зай/таслал), parseDateCell (round-trip)
├── specs.ts         Спек үйлдвэрүүд: journalLinesSpec, arapLinesSpec,
│                    journalVouchersSpec + groupVoucherRows
└── core.ts          Client тал (exceljs dynamic import): readWorkbookMatrix,
                     downloadWorkbook, downloadTemplate(spec)

components/excel/excel-import-dialog.tsx   Нийтлэг диалог (аль ч спекээр)
lib/actions/journal-import.ts              Багц журнал → НООРОГ (server шалгалттай)
```

### Хатуу дүрмүүд

- **Багана НЭРЭЭР танигдана** (байрлалаар БИШ) — том/жижиг үсэг, зай, `*`
  хамаарахгүй; илүүдэл багана үл тоомсорлоно; заавал багана дутвал
  headerError болж юу ч орохгүй
- **Мөр бүр тусдаа шалгагдана**, алдаа нь Excel-ийн мөрийн ДУГААРТАЙГАА
  урьдчилан харах хүснэгтэд гарна. **Зөвхөн зөв мөрүүд орно** — алдаатай мөр
  хэзээ ч чимээгүй орохгүй
- **Загвар файл спекээсээ үүснэ** (`downloadTemplate`) — толгой, жишээ мөр,
  "Заавар" хуудас parser-аас зөрөх боломжгүй
- **Дансны нүд paste-тай ИЖИЛ normalize** — `normalizePastedAccount` (бүтэн
  10-part, active-only N-part, эсвэл ганц 8 оронтой код); идэвхтэй данс мөн
  эсэхийг спек + server хоёулаа шалгана
- **Багц журнал НООРОГ болж үүснэ** (human-in-the-loop §9); server action
  данс/период/мөрийн тоог ДАХИН шалгаж баримт бүрд тусдаа амжилт/алдаа буцаана
- **Экспорт нь импортын загвартай ижил баганатай** (журналын экспорт →
  багц импортын толгой + Статус) — round-trip ажиллана
- Client-ээс DB-руу шууд хандахгүй — импортын бичилт Server Action-аар

### Одоогийн integration-ууд

| Газар | Импорт | Экспорт |
|-------|--------|---------|
| Журнал бичих форм (footer) | Мөрүүд (`journalLinesSpec`) | — |
| Журналын жагсаалт (toolbar) | Багц журнал (`journalVouchersSpec` → draft) | Шүүгдсэн журнал мөрөөрөө |
| АР/АП баримтын панель (мөрийн footer) | Мөрүүд + бараа/агуулах кодоор (`arapLinesSpec`) | — |
| АР/АП баримтын жагсаалт | — | Шүүгдсэн баримтууд |
| Ажилтнууд (toolbar) | Ажилтан (`employeesSpec` — РД таарвал шинэчилнэ) | Жагсаалт загвартай ижил баганаар + загвар татах |
