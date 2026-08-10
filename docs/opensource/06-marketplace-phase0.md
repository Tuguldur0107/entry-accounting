# Фаз 06 — Marketplace фаз 0: `entry-packages`

> ⚠️ **Урьдач нөхцөл: Фаз 02 (custom/ давхарга) дууссан байх** —
> багцын формат нь `custom/packages/` бүтэц дээр суурилна.

## Зорилго

Хэрэглэгчид хийсэн өргөтгөлөө (дансны сан, posting дүрэм, тайлан, skill,
AI tool) хуваалцах эхний суурь. **Фаз 0 = үнэгүй, GitHub дээр, дэлгүүр
биш community.** Төлбөртэй худалдаа нь 20+ багц хуримтлагдсаны ДАРААХ
шийдвэр — одоо түүний суурийг л тавина.

## Хийх ажил

### Шат 1 — `entry-packages` repo-гийн загвар

Тусдаа public repo болох бүтцийг энэ repo дотор `packages-repo-template/`
болгож бэлтгэ (эзэн GitHub дээр тусдаа repo болгож нээнэ):

```
entry-packages/
├── README.md            Юу вэ, хэрхэн суулгах, хэрхэн нийтлэх (монголоор)
├── CONTRIBUTING.md      Багц нийтлэх шаардлага + PR review шалгуур
├── LICENSE              MIT (багц бүр өөрийн лицензтэй байж болно,
│                        manifest-ийн license талбар)
├── registry.json        Бүх багцын индекс (нэр, хувилбар, товч, provides)
└── packages/
    └── <name>/
        ├── entry-package.json
        ├── README.md    Багцын тайлбар, скриншот
        └── ...          (custom/packages/<name>-ийн бүтэцтэй ижил)
```

### Шат 2 — Validation

`scripts/validate-package.ts` (энэ repo болон entry-packages хоёуланд
ажиллах):

- entry-package.json schema (фаз 02-ын `package-schema.ts` дахин ашиглана)
- registry.json нь packages/ хавтастай тохирч буй эсэх
- Дансны JSON — 8 оронтой код, бүлгийн дүрэмтэй (1XXXXXXX хөрөнгө г.м.)
  нийцэж буйг шалгана
- **Аюулгүйн анхны шүүлт:** `tools/`, `hooks/` агуулсан («код бүхий»)
  багцыг `"hasCode": true` гэж registry-д тэмдэглэнэ — README-д «код
  бүхий багцыг суулгахын өмнө эх кодыг нь шалгаж байж суулгана уу»
  анхааруулга. Дата-only багц (accounts, mappings, reports) эрсдэл багатай
- GitHub Actions workflow: PR бүрд validation автоматаар

### Шат 3 — Суулгах CLI

Энэ (core) repo-д `scripts/entry-add.ts`, `package.json`-д
`npm run entry:add -- <name>`:

1. `entry-packages` repo-гоос (raw.githubusercontent) registry.json татна
2. Багцыг татаж `custom/packages/<name>/` руу хуулна
3. `entryCompat` шалгана — зөрвөл зогсоод монголоор тайлбарлана
4. `hasCode: true` бол анхааруулж баталгаажуулалт асууна
5. `custom/index.ts`-д гараар бүртгэх зааврыг хэвлэнэ (автоматаар код
   ЗАСАХГҮЙ — хэрэглэгч өөрөө, эсвэл өөрийн Claude Code-оор)
6. Санал болгоно: `npm run custom:seed -- --dry-run`

### Шат 4 — Эхний жишээ багцууд (3 ширхэг, өөрсдөө хийнэ)

Хоосон дэлгүүр хэнийг ч татахгүй — эхний «бараа» бид өөрсдөө:

1. `coa-hudaldaa` — худалдааны салбарын дансны сан
   (knowledge/03-стандарт/chart-of-accounts.md-ээс)
2. `coa-uilchilgee` — үйлчилгээний салбарын дансны сан
3. `skill-tatvar-huugatsaa` — татварын хугацааны сануулгын skill
   (НӨАТ 10, НДШ 5, ААНОАТ улирлын 20 — regulatory дататай уялдана)

Бүгд validation давсан, README-тэй, бодит хэрэглээнд шалгагдсан.

## Хатуу дүрэм

- Фаз 0-д төлбөрийн ямар ч механизм ХИЙХГҮЙ (үнийн талбар manifest-д
  байж болно, гэхдээ enforcement байхгүй)
- CLI нь `custom/`-оос гадна юу ч бичихгүй
- Код бүхий багц автоматаар идэвхжихгүй — үргэлж хэрэглэгчийн ил үйлдэл
  (index.ts бүртгэл) шаардана

## Хамрахгүй

- Төлбөр, шимтгэл, орлого хуваарилалт (фаз 1+, 20+ багцын дараа)
- Marketplace веб UI (GitHub README + registry.json хангалттай)
- Багцын гарын үсэг/signing (төлбөртэй фазад)
- Хувилбарын автомат шинэчлэлт

## Хүлээн авах шалгуур

- [ ] packages-repo-template бүрэн, validation + CI workflow ажиллана
- [ ] 3 жишээ багц validation давсан, цэвэр систем дээр суулгаж туршсан
- [ ] `npm run entry:add -- coa-hudaldaa` бүрэн урсгалаар ажиллана
      (татах → compat шалгах → хуулах → заавар хэвлэх → seed dry-run)
- [ ] hasCode багцад анхааруулга гарна
- [ ] README статус хүснэгт шинэчлэгдсэн
