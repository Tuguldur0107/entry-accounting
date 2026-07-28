# Entry UI Component Review

## Хүснэгтийн component

Одоогийн нэгдсэн хүснэгтийн суурь зөв:

```text
DataGridDynamic
      ↓
DataGrid
      ↓
AG Grid Community v35
      ├─ eaGridTheme
      ├─ ComboFilter
      ├─ clipboard
      ├─ pagination
      └─ selection/editing
```

`components/datagrid/README.md` бүх хүснэгт `DataGridDynamic` ашиглах дүрэмтэй,
UI Kit page дээр бодит demo нь байна. Тиймээс шинэ parallel Table component
үүсгэх шаардлагагүй.

### Сайжруулах санал

1. `DataGridDynamic`-ийг үндсэн primitive хэвээр үлдээнэ.
2. Business page бүр олон AG Grid prop давтахын оронд preset wrapper нэмнэ:
   - `TransactionGrid`;
   - `MasterDataGrid`;
   - `ControlReportGrid`;
   - `EditableLinesGrid`.
3. Preset бүр selection, row height, number alignment, loading, empty state,
   toolbar, export, totals, keyboard behavior-оо тогтооно.
4. Multi-header control report-ийг шинэ хүснэгтээр биш одоогийн
   `ColGroupDef` capability-аар хийнэ.
5. Table action cell бүр `IconAction` ашиглана.
6. Loading, empty, error, no-result state-уудыг DataGrid-ийн нэгдсэн slot/API
   болгоно.
7. Account, amount, quantity, date column definition factory үүсгэж format,
   alignment, precision-ийг page бүрт давтахгүй болгоно.

## Component системийн санал

### P0 — одоо стандартчилах

| Component/pattern | Одоогийн асуудал | Санал |
|---|---|---|
| Icon | Direct import, raw SVG, text glyph холилдсон | Шинэ Icon Kit рүү migrate |
| Icon-only button | Raw button, hit area/state ялгаатай | `IconAction` |
| Page header | Гарчиг, тайлбар, action байрлал давтагдана | `PageHeader` |
| Toolbar | Filter/search/export/action олон янз | `PageToolbar` |
| Empty/error state | Page бүр өөр | `EmptyState`, `ErrorState` |
| DataGrid states | Loading/no-result тусдаа | Нэгдсэн overlay/slot |

### P1 — дараагийн давхарга

| Component/pattern | Санал |
|---|---|
| KPI | `MetricCard` + tone + trend + drill-down |
| Filter | `FilterBar` + active filter chips + reset |
| Form | `FormField`, `FormSection`, validation summary |
| Detail | Side/floating panel-ийн header/action/footer contract |
| Status | `StatusBadge`-ийн tone-ийг accounting status mapping-тай холбох |
| Confirm | Destructive/non-destructive action preset |

### P2 — governance

1. `/settings/ui-kit`-ийг living documentation болгоно.
2. Component бүр variants, sizes, states, accessibility, do/don't-той байна.
3. Hardcoded color/icon/spacing audit-ийг CI-д оруулна.
4. Deprecated component-д migration хугацаа ба lint rule өгнө.
5. Component API өөрчлөхдөө page business logic-ийг зэрэг redesign хийхгүй.

## Хийхгүй зүйл

- AG Grid байхад өөр custom `<table>` систем шинээр үүсгэхгүй.
- UI Kit component дотор accounting business rule хийхгүй.
- Semantic status icon/өнгөөр дан ганц утга дамжуулахгүй; текст/ARIA давхар байна.
- Icon Kit-д logo, hero illustration, chart, data visualization-ийг хүчээр
  оруулахгүй.
