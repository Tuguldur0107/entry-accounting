# Tech Stack — Entry Accounting

Шийдвэр гаргасан огноо: 2026-05-06

---

## Бүрэн stack

| Давхарга | Технологи | Хувилбар |
|----------|-----------|----------|
| Framework | Next.js (App Router) | 15+ |
| UI | Ant Design | 5+ |
| State | Zustand | 5+ |
| Database | PostgreSQL | 16+ |
| ORM | Drizzle | latest |
| Hosting | Railway | — |
| Auth | NextAuth.js (Auth.js) | 5+ |
| AI | Claude API (@anthropic-ai/sdk) | latest |
| Хэл | TypeScript | 5+ |
| Build | Turbopack (Next.js built-in) | — |

---

## Технологи тус бүрийн шийдвэрийн үндэслэл

### Next.js (App Router)

**Сонгосон шалтгаан:**
- Claude API key-г server-side API route-д нуух боломжтой — тусдаа backend хэрэггүй
- File-based routing — хуудас нэмэхэд хялбар
- API Routes болон Server Actions нэг дор — backend хожим өргөтгөхөд бэлэн
- Олон хэрэглэгч, auth нэмэхэд NextAuth-тай шууд нэгддэг
- Vercel болон Railway-д deployment хялбар

**Орхисон сонголт:** React + Vite
- Claude API key browser-д задрах эрсдэлтэй
- Backend тусдаа барих шаардлагатай болно

---

### Ant Design

**Сонгосон шалтгаан:**
- Хүснэгт (Table), Form, DatePicker, Modal — нягтлан бодох аппд хэрэгтэй бүх компонент бэлэн
- Тооны өгөгдөл, хүснэгт харуулахад хамгийн тохиромжтой UI сан
- TypeScript дэмжлэг маш сайн
- Нягтлан бодох системүүдэд өргөн хэрэглэгддэг (ERP, финанс)

**Орхисон сонголт:** Chakra UI
- `knowledge/03-стандарт/ui-standards/` файлууд Chakra spec-тэй боловч нягтлан бодох UI-д Ant Design илүү тохиромжтой

---

### Zustand

**Сонгосон шалтгаан:**
- Маш хялбар API — boilerplate бага
- localStorage sync middleware бэлэн (`persist`)
- Backend нэмэхэд store-оос API call руу шилжих хялбар
- React Context-ээс хурдан, Redux Toolkit-ээс хялбар

**Хэрэглэх хүрээ:**
- UI state (нээлттэй modal, сонгосон period, filter)
- localStorage-аас ачаалах өгөгдөл (offline/cached)
- DB нэмсний дараа server state-д React Query нэмж болно

---

### PostgreSQL

**Сонгосон шалтгаан:**
- ACID transaction — нягтлан бодох өгөгдөлд заавал шаардлагатай
- Dr=Cr баланс, period lock, audit trail — бүгд transaction-д найдна
- JSON өгөгдлийн дэмжлэг (journal metadata)
- Complex SQL query (тайлан, нийлбэр, group by) — маш сайн

**Орхисон сонголт:** MongoDB
- NoSQL нь санхүүгийн өгөгдлийн ACID шаардлагад тохиромжгүй

---

### Drizzle ORM

**Сонгосон шалтгаан:**
- SQL-д маш ойр синтакс — нягтлан бодох нарийн query бичихэд хялбар
- TypeScript type inference маш сайн — compile-д алдаа илрэнэ
- Prisma-аас хурдан (runtime overhead бага)
- Migration файл SQL хэлбэртэй — ойлгомжтой, version control-д тохиромжтой
- Next.js + Railway-тэй сайн ажилладаг

**Орхисон сонголт:** Prisma
- Хялбар боловч Drizzle-ээс удаан, SQL-д бага ойр

---

### Railway

**Сервис:**
- Next.js app hosting
- PostgreSQL database hosting
- Нэг платформд app + DB — хялбар

**Сонгосон шалтгаан:**
- Азийн сервер байдаг — Монгол хэрэглэгчдэд latency бага
- PostgreSQL + Next.js хоёрыг нэг дор хост хийнэ
- GitHub-тай холбоход auto-deploy
- Vercel-ээс өгөгдөл Монголд ойр байрладаг

**Орхисон сонголт:** Vercel + Neon, Supabase
- Supabase: Auth + DB нэгдсэн боловч Монголд latency их
- Vercel + Neon: Next.js-д тохиромжтой боловч Railway-аас өгөдөл хол

---

### NextAuth.js (Auth.js v5)

**Сонгосон шалтгаан:**
- Үнэгүй, open-source
- Next.js App Router-тэй бүрэн нийцтэй
- Drizzle adapter бэлэн — DB-тэй шууд холбогдоно
- Email/password, Google, GitHub provider бэлэн
- Session management, JWT — бүгд дотор

**Орхисон сонголт:** Clerk
- Хялбар боловч production-д төлбөртэй

---

### Claude API (@anthropic-ai/sdk)

**Сонгосон шалтгаан:**
- Монгол хэлний ойлголт маш сайн
- Tool use / function calling — expert accountant agent-д шаардлагатай
- Streaming дэмжлэг — хэрэглэгчид хариу хурдан харуулна
- `knowledge/02-нягтлан-бодох-мэргэжлийн/expert-accountant-SKILL.md`-д тодорхойлсон tool-уудыг хэрэгжүүлэхэд хамгийн тохиромжтой

**Аюулгүй байдал:**
- API key Next.js API Route / Server Action-д хадгалагдана — browser-д задрахгүй
- `ANTHROPIC_API_KEY` environment variable → Railway-д тохируулна

---

## Folder бүтэц (төлөвлөгдсөн)

```
entry-accounting/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   ├── (dashboard)/
│   │   ├── journal/        # Ерөнхий журнал
│   │   ├── accounts/       # Дансны тохиргоо
│   │   ├── periods/        # Period систем
│   │   ├── vat/            # НӨАТ модуль
│   │   ├── payroll/        # Цалингийн модуль
│   │   └── reports/        # Тайлан
│   └── api/
│       ├── auth/           # NextAuth
│       └── agent/          # Claude API (server-side)
├── components/
│   ├── journal/
│   ├── payroll/
│   └── common/
├── db/
│   ├── schema/             # Drizzle schema
│   └── migrations/
├── lib/
│   ├── agent/              # Expert accountant tools
│   └── store/              # Zustand stores
└── knowledge/              # Мэргэжлийн мэдлэгийн сан
```

---

## Хөгжүүлэлтийн дараалал

```
1. Next.js + Ant Design + Zustand scaffold
2. Drizzle + PostgreSQL schema (journal, accounts, periods)
3. NextAuth — нэвтрэх систем
4. Railway deploy (app + DB)
5. Claude API agent (expert-accountant tools)
6. Одоогийн index.html логикийг шилжүүлэх (GL журнал)
7. Draft → Post журнал систем
8. Period систем
9. НӨАТ модуль
10. Цалингийн модуль
```
