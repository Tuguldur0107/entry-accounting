# Монголын сүлжээнээс хийх ажлууд — runbook

> ТЕГ / ITC-ийн систем (`api.ebarimt.mn`, `auth.itc.gov.mn`, `developer.itc.gov.mn`)
> ЗӨВХӨН Монголын IP-ээс хандагддаг. Entry-ийн сервер (Railway, Сингапур) болон
> Claude-ийн орчин тэдгээрт хүрэхгүй. Энэ баримт Монголд байгаа хүн/сервер хийх
> бүх ажлыг хуулж ажиллуулахад бэлэн хэлбэрээр цуглуулна.
> Холбоотой: `docs/pos/05-ebarimt-invoice-plan.md`, `docs/integrations/00-itc-developer-portal.md`,
> `docs/integrations/01-ebarimt-posapi-verification.md`, `docs/deployment/ebarimt.md` §4a.

| # | Ажил | Хэн | Хугацаа | Юуг нээнэ |
|---|---|---|---|---|
| **A** | `ebarimt.chipmo.mn`-ийн nginx-д 3 прокси зам | Серверийн админ | ~15 мин | ААН-ийн регистр → нэр (касс), ТЕГ ↔ Entry тулгалт (TPI), ITC нэвтрэлт |
| **B** | Staging PosAPI суулгаж нэхэмжлэхийн туршилт | Серверийн админ / хөгжүүлэгч | ~1–2 цаг | eBarimt нэхэмжлэх + төлөлт (05-ийн Q1–Q6) |
| **C** | developer.itc.gov.mn-ийн хуудсуудыг хадгалах | Монголын интернэттэй хэн ч | ~30 мин | Албан спек (нэхэмжлэх, TPI, eTax) |
| **D** | ITC-д албан захидал | Та | 5 мин | Q1–Q8 + eTax + TPI эрх |

Нууц үг, API түлхүүр, сугалааны дугаар, QR — энэ ажлуудын аль ч үр дүнд
ОРУУЛАХГҮЙ, чатад бичихгүй.

---

## A. nginx прокси (`ebarimt.chipmo.mn`, 43.231.113.138)

**Байдал (2026-09-27):** Cloudflare WAF «PosAPI зөвхөн Entry» дүрэм `/rest/`,
`/teg/`, `/tpi/`, `/itc-auth/` замыг аль хэдийн хамгаалж байна — гаднаас нууц
header-гүй хүсэлт 403 (`/rest/`-д 18.141.63.247 хэвээр зөвшөөрөгдөнө). Тиймээс
nginx-д зам нэмэхэд гаднаас ил гарахгүй.

### A.1 Серверийн админд илгээх мессеж (хуулж явуулна)

```text
Сайн байна уу! ebarimt.chipmo.mn серверийн nginx-д 3 прокси зам нэмэх хүсэлт байна
(~15 мин). Одоо ажиллаж байгаа PosAPI (/rest/...)-д огт нөлөөлөхгүй.

Яагаад: ТЕГ-ийн API (api.ebarimt.mn, auth.itc.gov.mn) зөвхөн Монголын IP-д
хариулдаг. Манай Entry систем гадаадад байрладаг тул энэ сервераар дамжуулна.
Гаднаас хэн ч хандахгүй — Cloudflare нууц header-гүй хүсэлтийг хаадаг (аль хэдийн
тохируулсан).

1) Сервер ТЕГ-т хүрч байгааг шалгах:
   curl -s "https://api.ebarimt.mn/api/info/check/getInfo?tin=90201194984"
   curl -s -o /dev/null -w '%{http_code}\n' https://auth.itc.gov.mn/auth/realms/ITC/.well-known/openid-configuration
   → эхнийх нь компанийн нэртэй JSON, хоёр дахь нь 200 байх ёстой.

2) Тохиргооны файл олох:  sudo grep -rl "ebarimt.chipmo.mn" /etc/nginx/
3) Нөөц хуулбар:          sudo cp <файл> <файл>.bak-$(date +%F)
4) server_name ebarimt.chipmo.mn гэсэн server { } блок дотор (443/ssl талынх),
   одоо байгаа location-уудыг ХӨНДӨХГҮЙГЭЭР дараахыг нэмэх:

    # Entry — ТЕГ/ITC-ийн API-г Монголын IP-ээр (Cloudflare WAF нууц header-ээр хамгаална)
    location /teg/ {
        limit_except GET { deny all; }
        proxy_pass https://api.ebarimt.mn/api/info/check/;
        proxy_set_header Host api.ebarimt.mn;
        proxy_set_header X-Entry-Gateway-Key "";
        proxy_ssl_server_name on;
        proxy_connect_timeout 5s;
        proxy_read_timeout 15s;
    }
    location /tpi/ {
        proxy_pass https://api.ebarimt.mn/;
        proxy_set_header Host api.ebarimt.mn;
        proxy_set_header X-Entry-Gateway-Key "";
        proxy_ssl_server_name on;
        proxy_connect_timeout 5s;
        proxy_read_timeout 70s;
        client_max_body_size 1m;
    }
    location /itc-auth/ {
        limit_except GET POST { deny all; }
        proxy_pass https://auth.itc.gov.mn/;
        proxy_set_header Host auth.itc.gov.mn;
        proxy_set_header X-Entry-Gateway-Key "";
        proxy_ssl_server_name on;
        proxy_connect_timeout 5s;
        proxy_read_timeout 15s;
        access_log off;
    }

   Тайлбар: proxy_pass-ын төгсгөлийн "/" заавал. X-Entry-Gateway-Key "" нь манай
   хамгаалалтын header-ийг ТЕГ рүү дамжуулахгүй. /itc-auth/ нэвтрэлтийн хүсэлт
   дамжуулдаг тул лог унтраалттай.

5) Шалгаад reload (restart биш — PosAPI тасрахгүй):
   sudo nginx -t && sudo systemctl reload nginx

6) Серверээс өөрөөс нь шалгах (Cloudflare-ийг тойрч локал nginx руу):
   curl -sk --resolve ebarimt.chipmo.mn:443:127.0.0.1 "https://ebarimt.chipmo.mn/teg/getInfo?tin=90201194984"
   curl -sk --resolve ebarimt.chipmo.mn:443:127.0.0.1 "https://ebarimt.chipmo.mn/tpi/api/info/check/getInfo?tin=90201194984"
   curl -sk --resolve ebarimt.chipmo.mn:443:127.0.0.1 -o /dev/null -w '%{http_code}\n' \
     "https://ebarimt.chipmo.mn/itc-auth/auth/realms/ITC/.well-known/openid-configuration"
   → эхний хоёр нь компанийн нэртэй JSON, гурав дахь нь 200.
   Гаднаас (өөр компьютероос) ижил хаяг 403 буцаавал хамгаалалт зөв ажиллаж байна.

Буцаах: нэмсэн 3 location-ийг устгаад "sudo nginx -t && sudo systemctl reload nginx".
Алдаа гарвал reload хийлгүй нөөцөөс сэргээж, алдааны текстийг явуулаарай. Баярлалаа!
```

### A.2 Дууссаны дараа (Claude хийнэ)

Railway `entry-accounting`-д:

| Env | Утга | Юу ажиллана |
|---|---|---|
| `EBARIMT_PUBLIC_API_BASE` | `https://ebarimt.chipmo.mn/teg` | Касс/тохиргоонд ААН-ийн 7 оронтой регистр → ТТД + нэр (`lib/ebarimt/lookup.ts`) |
| `ITC_TPI_BASE` | `https://ebarimt.chipmo.mn/tpi` | TPI (`lib/itc/client.ts`) — X-API-KEY ирсний дараа |
| `ITC_AUTH_BASE` | `https://ebarimt.chipmo.mn/itc-auth` | ITC Keycloak token (`itcTokenUrl`) |

`EBARIMT_GATEWAY_HOSTS=ebarimt.chipmo.mn` аль хэдийн тохируулагдсан тул нууц
header эдгээр хүсэлтэд автоматаар нэмэгдэнэ (албан ITC хост руу ХЭЗЭЭ Ч).
Шалгалт: кассын «ААН» дээр `6596177` (Гарааны хос хас технологи) → нэр гарна.

---

## B. Staging PosAPI + нэхэмжлэхийн туршилт

**Хаана:** Монголын сүлжээнд байгаа тусдаа Ubuntu машин/VM. Production PosAPI-тай
сервер дээр БИШ (порт 7080, өгөгдөл холилдохгүйн тулд).

1. **Staging PosAPI суулгах, идэвхжүүлэх** — `docs/integrations/01-ebarimt-posapi-verification.md`
   §4 (staging `.deb` share.itc.gov.mn-ээс, `st-operator.ebarimt.mn`-д тест операторын
   эрхээр PosAPI бүртгэх, `http://localhost:7080/web/`-ээр идэвхжүүлэх, тест мерчант
   `37900846788`-ийг нэмж `stg-invoice.ebarimt.mn`-д батлах).
2. **Шалгах:**
   ```bash
   curl -s http://localhost:7080/rest/info | jq '{operatorTIN, posNo, merchants: [.merchants[].tin]}'
   ```
   `merchants`-д `37900846788` байх ёстой; `posNo`-г тэмдэглэнэ.
3. **Скрипт татах** (repo нийтэд нээлттэй):
   ```bash
   mkdir -p ~/ebarimt-invoice-test && cd ~/ebarimt-invoice-test
   base=https://raw.githubusercontent.com/Tuguldur0107/entry-accounting/main/docs/pos/ebarimt-invoice-staging
   curl -fsSLO "$base/run.sh" && curl -fsSLO "$base/invoice-b2b.json" && chmod +x run.sh
   sudo apt-get install -y jq   # байхгүй бол
   ```
4. **Ажиллуулах** (`BUYER_TIN` — staging-д бүртгэлтэй өөр ААН-ийн ТТД; туршилтын
   заавар дахь түрээслэгч `61200064714` эсвэл ITC-ийн өгсөн тест ТТД):
   ```bash
   STAGING=yes POSAPI=http://localhost:7080 MERCHANT_TIN=37900846788 \
     BUYER_TIN=61200064714 POS_NO=<2-р алхмын posNo> DISTRICT=2301 ./run.sh
   ```
   T1–T6 хувилбар бүр өөр нэхэмжлэх дээр явна; нэг нь алдаа өгсөн ч бусад нь
   үргэлжилнэ. Хариунаас сугалаа/QR хадгалагдахгүй.
5. **Гар шалгалт** — `stg-invoice.ebarimt.mn`-д мерчант (37900846788) ба худалдан
   авагчаар нэвтэрч дэлгэцийн зураг авах:
   - T1/T3/T4-ийн нэхэмжлэх ямар төлөвтэй (нээлттэй / хэсэгчлэн / төлөгдсөн);
   - Нэхэмжлэх ↔ төлөлтийн холбоос (эх нэхэмжлэхийн дугаар) харагдах эсэх;
   - Худалдан авагч батлах/татгалзах товч бий эсэх (Q7).
6. **Илгээх:** `results/` хавтас + дэлгэцийн зургуудыг zip-лээд Entry багт.

---

## C. developer.itc.gov.mn — албан спекийг хадгалах

Монголын интернэттэй браузераас (нэвтрэх шаардлагагүй хуудсууд). Хуудас бүрийг
**Print → Save as PDF** (эсвэл Stoplight «Export → Original»), нэг хавтсанд:

| Проект | Хуудас | Юунд |
|---|---|---|
| PosAPI 3.0 (eBarimt) | Баримт илгээх (`/rest/receipt`), **төлбөрийн хэлбэр / payments**, **нэхэмжлэх / invoice**, буцаалт (DELETE), `inactiveId` | Q1–Q5 |
| ebarimt-api (TPI) | `getSalesTotalData`, `getSaleListERP`, нэвтрэлт (`vatps`), X-API-KEY | Шат 4, худалдан авалт |
| etax-api | Бүх хуудас + **«ETAX API documentation v1.1» PDF** | eTax тайлан илгээх |

Нууц үг/түлхүүр агуулсан хуудас байвал хадгалахгүй. Хавтсыг Entry багт илгээнэ —
бид `docs/integrations/`-д оруулна.

---

## D. ITC-д албан захидал

**Хэнд:** posapi@itc.gov.mn (хуулбар: info@itc.gov.mn). **Гарчиг:** «PosAPI 3.0
нэхэмжлэх, TPI, eTax API — хэрэглэгчийн систем нийлүүлэгчийн асуулт»

```text
Сайн байна уу.

Бид Entry нягтлан бодох бүртгэлийн системийг (entry.mn) хөгжүүлж, PosAPI 3.0-оор
(оператор: Хос хас технологи, ТТД 90201194984, posNo 10000878) харилцагчдынхаа
төлбөрийн баримтыг илгээж байна. Нэхэмжлэх, TPI, eTax-ийн холболтын талаар дараах
асуултад хариулж, холбогдох баримт бичгийг илгээнэ үү.

А. Нэхэмжлэх (B2B_INVOICE / B2C_INVOICE) — «POS API 3.0» гарын авлагад тусгагдаагүй:
 1. Нэхэмжлэх төлөгдөхөд PosAPI-д юу илгээх вэ (inactiveId-тай дахин илгээх үү;
    RECEIPT эсвэл INVOICE төрлөөр)? TPI-ийн prParentRno хэрхэн бүрддэг вэ?
 2. Төлөгдөөгүй дүнгийн payments[].code ба status ямар утгатай байх вэ
    (PAY / PAID төлөвийн албан жагсаалт)?
 3. Нэхэмжлэхийг хэсэгчлэн (хэд хэдэн удаа) төлөхөд юу илгээх вэ?
 4. B2C_INVOICE ба түүний төлөлтөд сугалаа олгогдох уу?
 5. Нэхэмжлэхийг цуцлах / кредит нэхэмжлэл гаргах зөв арга?
 6. Төлөлтийн баримт аль тайлант сард (reportMonth) хамаарах вэ?
 7. B2B нэхэмжлэхийг худалдан авагч баталгаажуулах шаардлагатай юу, хугацаатай юу?
 8. Харилцан суутган тооцоогоор хаагдсан авлагыг төлөлт гэж илгээх үү?

Б. TPI (api.ebarimt.mn):
 9. getSalesTotalData / getSaleListERP-д хандах X-API-KEY-г хэрхэн авах вэ —
    оператор (хэрэглэгчийн систем нийлүүлэгч) бүрд нэг үү, татвар төлөгч бүрд үү?
10. Нэг компани (толгой/охин биш) өөрийн ХУДАЛДАН АВАЛТЫН баримтыг TPI-ээр татах
    боломжтой юу (getSaleListERP эсвэл өөр сервис)?
11. Татвар төлөгчийн өгөгдлийг гуравдагч системд дамжуулах зөвшөөрөл хэрхэн бүртгэгдэх вэ?

В. eTax (Цахим татварын систем):
12. Санхүүгийн программаас тайлан (НӨАТ, ХАОАТ, ААНОАТ) шууд илгээх API-д хандах
    эрх, гэрээ, шалгалт; client_id / realm; staging орчин.
13. Дэмжигдэх маягтууд, JSON/XML схем, мөрийн код; илгээлтийн урсгал (ноорог →
    шалгалт → баталгаажуулалт, тоон гарын үсэг), залруулсан тайлан.

Хариу, баримт бичгийг энэ хаягаар илгээнэ үү. Баярлалаа.
```

---

## E. Үр дүнг хаана илгээх, дараа нь юу болох

| Ирсэн | Claude хийх |
|---|---|
| A дууссан | §A.2 env → ААН-ийн лавлах ажиллана (шалгаж баталгаажуулна) |
| B-ийн `results/` + зураг | `05` §3-ийн Q1–Q7-г хааж, АР нэхэмжлэхийн eBarimt илгээлтийн payload-ыг баталгаажуулна |
| C-ийн хавтас | `docs/integrations/`-д оруулж спектэй тулгана |
| D-ийн хариу | Q8–Q13-ыг хааж eTax / TPI-ийн ажлыг төлөвлөнө |
