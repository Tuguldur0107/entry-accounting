# Цахим татварын систем

Эх сурвалж: https://developer.itc.gov.mn/detail/proj-1787125468395

## Гарчиг

- 1. Танилцуулга
- 2. Release Notes
- 3. Цахим татварын систем API
  - 3.1. `POST` Token авах
  - 3.2. `GET` Байгууллагын мэдээлэл авах
  - 3.3. `GET` Тушаах тайлангийн жагсаалт авах
  - 3.4. `GET` Тайлангийн түүх харах
  - 3.5. `GET` Хоцорсон тайлангийн жагсаалт авах
  - 3.6. `GET` Тайлангийн формын жагсаалт авах
  - 3.7. `GET` Тайлангийн формын загвар авах
  - 3.8. `GET` Тайлангийн формын дата авах
  - 3.9. `POST` Тайлан хадгалах
  - 3.10. `POST` Тайлан илгээх
  - 3.11. `GET` Тайлангийн мэдээний жагсаалт авах
  - 3.12. `GET` Тайлангийн мэдээний загвар авах
  - 3.13. `GET` Тайлангийн мэдээний дата авах
  - 3.14. `POST` Тайлангийн мэдээ хадгалах
  - 3.15. `POST` Тайлангийн мэдээг мөрөөр устгах
  - 3.16. `GET` Тайлангийн мэдээг устгах
- 4. Татварын цахим нэхэмжлэх
  - 4.1. `GET` Татварын цахим нэхэмжлэхийн жагсаалт лавлах сервис
  - 4.2. `GET` XYP-Төлөгдөөгүй татварын нэхэмжлэх лавлах сервис
  - 4.3. `POST` XYP-Татварын төлбөрийн хүсэлт үүсгэх сервис
  - 4.4. `GET` XYP-Татварын төлөлт шалгах сервис


## 1. Танилцуулга

> Монгол Улсын Засгийн газрын 2016 оны 12 дугаар сарын 07-ны өдрийн 177 дугаар тогтоолын хүрээнд татварын албанаас авах бүх төрлийн үйлчилгээг цахимжуулах, татвар төлөгчдийн тайлан илгээхтэй холбоотой хүндрэл бэрхшээлийг багасгах, шинэ хуулийн өөрчлөлтийн дагуу татварын тайлан хүлээн авах, санхүүгийн программаасаа хялбар шийдлээр илгээх боломжийг бүрдүүлэх, татварын албатай холбоотой хүсэлт, тодорхойлолтыг цахимаар хүлээн авах, хөндлөнгийн системүүдтэй уялдаа холбоог сайжруулах зорилготой уг төслийг хэрэгжүүлсэн. Сангийн сайдын 2019 оны 08 сарын 05-ны өдрийн 177 тоот тушаалаар Цахим татварын системийн шинэчилсэн хувилбарыг нэвтрүүлсэн.
> 
> [Сервисийн гарын авлага татах](https://share.itc.gov.mn/share/st-kc/user-manual/userguide.pdf)

> ETAX тайлангийн API сервисийг авч ашиглахдаа [posapi@itc.gov.mn](mailto:posapi@itc.gov.mn) мэйл рүү байгууллагынхаа дараах мэдээллүүдийг хүргүүлнэ. Сервис дээр ашиглах key-г [posapi@itc.gov.mn](mailto:posapi@itc.gov.mn)[-](mailto:posapi@itc.gov.mn-)с гаргаж өгнө. Тус өгсөн key-г ETAX API сервисүүдийн header хэсэгт тохируулна.

- Ашиглах системийн нэр:
- Байгууллагын нэр:
- Байгууллагын регистрийн дугаар:
- Ашиглах ажилтны нэр:
- Ажилтны утасны дугаар:
- Ажилтны мэйл хаяг:
- ETAX-н Тестийн орчинд/[st-etax.mta.mn/](http://st-etax.mta.mn/) бүртгэл үүсгэсэн ажилтны регистер

> ETAX нэхэмжлэхийн жагсаалтын API сервисийг авч ашиглахдаа Татварын ерөнхий газрын Татвар төлөгчдөд үйлчлэх газарт албан бичгээр хандаж Мэдээллийн технологийн төвөөр дамжуулж бодит орчинд ашиглагдах X-API-KEY болон NE-KEY үүсгүүлж авна.


## 2. Release Notes

**ХУР системээр дамжуулан төлөгдөөгүй татвар лавлах, татварын төлбөрийн хүсэлт үүсгэх, татварын төлөлтийн мэдээлэл лавлах API үйлчилгээг ашиглах боломжтой боллоо. Энэхүү үйлчилгээ нь төр, хувийн хэвшлийн байгууллагуудын систем хоорондын интеграцыг дэмжих бөгөөд татварын үйлчилгээг цахимаар авах боломжийг бүрдүүлнэ. Үйлчилгээг ашиглахтай холбоотой бизнес процесс, систем хоорондын мэдээлэл солилцооны бүтэц, хүсэлт, хариу өгөгдлийн формат, техникийн болон аюулгүй байдлын шаардлагыг API гарын авлагад тусгасан болно.**


## 3. Цахим татварын систем API

- `POST` Token авах
- `GET` Байгууллагын мэдээлэл авах
- `GET` Тушаах тайлангийн жагсаалт авах
- `GET` Тайлангийн түүх харах
- `GET` Хоцорсон тайлангийн жагсаалт авах
- `GET` Тайлангийн формын жагсаалт авах
- `GET` Тайлангийн формын загвар авах
- `GET` Тайлангийн формын дата авах
- `POST` Тайлан хадгалах
- `POST` Тайлан илгээх
- `GET` Тайлангийн мэдээний жагсаалт авах
- `GET` Тайлангийн мэдээний загвар авах
- `GET` Тайлангийн мэдээний дата авах
- `POST` Тайлангийн мэдээ хадгалах
- `POST` Тайлангийн мэдээг мөрөөр устгах
- `GET` Тайлангийн мэдээг устгах


### 3.1. `POST` Token авах

**Endpoint:** `POST https://auth.itc.gov.mn/auth/realms/ITC/protocol/openid-connect/token`  
**Content-Type:** `application/x-www-form-urlencoded` · **Token:** үгүй

> Сервисийн хариу амжилттай бол зөвхөн `access_token` ийг авч ашиглана уу

ETAX API сервисийг авч ашиглахдаа [request@itc.gov.mn](mailto:request@itc.gov.mn) мэйл рүү байгууллагынхаа дараах мэдээллүүдийг хүргүүлнэ.
Ашиглах системийн нэр:

- Байгууллагын нэр:
- Байгууллагын регистрийн дугаар:
- Ашиглах ажилтны нэр:
- Ажилтны утасны дугаар:
- Ажилтны мэйл хаяг:
- ETAX-н Тестийн орчинд/[st-etax.mta.mn/](http://st-etax.mta.mn/) бүртгэл үүсгэсэн ажилтны регистер:

Сервис дээр ашиглах key-г [request@itc.gov.mn](mailto:request@itc.gov.mn)[-](mailto:request@itc.gov.mn-)с гаргаж өгнө. Тус өгсөн key-г ETAX API сервисүүдийн header хэсэгт тохируулна.
Staging URL : [https://st.auth.itc.gov.mn/auth/realms/Staging**/protocol/openid-connect/token**](https://st.auth.itc.gov.mn/auth/realms/Staging/protocol/openid-connect/token)

**Request body:**

- `grant_type` (string, **заавал**) · Жишээ: `password`
- `client_id` (string, **заавал**) · Жишээ: `etax-api-staging`
- `username` (string, **заавал**) · Жишээ: `АА10010110`
- `password` (string, **заавал**) · Жишээ: `АА10010110`

**Response талбар:**

- `access_token` (string)
- `expires_in` (string)
- `refresh_expires_in` (string)
- `refresh_token` (string)
- `token_type` (string)
- `not-before-policy` (string)
- `session_state` (string)
- `scope` (string)

**Response жишээ:**

HTTP 200

```json
{
  "access_token": "string",
  "expires_in": "string",
  "refresh_expires_in": "string",
  "refresh_token": "string",
  "token_type": "string",
  "not-before-policy": "string",
  "session_state": "string",
  "scope": "string"
}
```


### 3.2. `GET` Байгууллагын мэдээлэл авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/user/getUserOrgs`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

> Системд нэвтэрсэн хэрэглэгч өөрийн эрхтэй холбосон байгууллагын жагсаалт авах сервис.

**Response талбар:**

- `id` (number) — Татвар төлөгчийн бүртгэлийн дугаар
- `Tin` (string) — Татвар төлөгчийн дугаар
- `entType` (number) — Татвар төлөгчийн төрөл 1-хувь хүн,2-хуулийн этгээд
- `parentId` (number) — Татвар төлөгчийн толгой компанийн бүртгэлийн дугаар
- `entStatus` (number) — Бүртгэлийн төлөв 2-бүртгэгдсэн,3-хасагдахаар хүлээж байгаа,4-хасагдсан
- `entityName` (string) — Татвар төлөгчийн нэр
- `Pin` (string) — Татвар төлөгчийн регистр
- `isConfirmed` (number) — Бүртгэл баталгаажсан эсэх
- `refEntType` (object) — Татвар төлөгчийн бүртгэлийн төрөл
  - `code` (string) — Бүртгэлийн код
  - `name` (string) — Бүртгэлийн нэр
- `refEntStatus` (object) — Бүртгэлийн төлөв
  - `Code` (string) — Төлөвийн код
  - `name` (string) — Төлөвийн нэр
- `taxpayerBranchView` (object) — Татварын албаны мэдээлэл
  - `branchCode` (string) — Татварын албаны код
  - `branchName` (string) — Татварын албаны нэр
  - `subBranchCode` (string) — Татварын дэд албаны код
  - `subBranchName` (string) — Татварын дэд албаны нэр
- `agreeGeneralRoleUser` (boolean) — Ерөнхий нягтлангийн эрхтэй эсэх
- `ebarimtLogin` (boolean) — Ибаримтад бүртгэлтэй эсэх

**Response жишээ:**

HTTP 200

```json
{
  "id": 8888888,
  "Tin": "888888888",
  "entType": 2,
  "parentId": 88888888,
  "entStatus": 2,
  "entityName": "Тестийн хэрэглэгч",
  "Pin": "88888888",
  "isConfirmed": 1,
  "refEntType": {
    "code": "Organization",
    "name": "Хуулийн этгээд"
  },
  "refEntStatus": {
    "Code": "REG",
    "name": "Бүртгэгдсэн"
  },
  "taxpayerBranchView": {
    "branchCode": "25",
    "branchName": "Сүхбаатар дүүрэг",
    "subBranchCode": "1548",
    "subBranchName": "18-р хороо"
  },
  "agreeGeneralRoleUser": true,
  "ebarimtLogin": true
}
```


### 3.3. `GET` Тушаах тайлангийн жагсаалт авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getList`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

Татвар төлөгчийн тушаах тайлангийн жагсаалт авах сервис

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар

**Response талбар:**

- `code` (number) — Сервисийн алдааны код
- `message` (string) — Сервисийн алдааны утга
- `reportList` (object) — Тайлангийн жагсаалт
  - `id` (string) — Тайлангийн маягтын бүртгэлийн дугаар
  - `taxReportCode` (string) — Тайлангийн маягтын код
  - `taxTypeId` (number) — Татварын төрлийн дугаар
  - `taxTypeName` (string) — Татварын төрлийн нэр
  - `branchId` (string) — Татварын албаны дугаар
  - `branchCode` (string) — Татварын албаны код
  - `branchName` (string) — Татварын албаны нэр
  - `branchLabel` (string) — Татварын албаны нэр
  - `periodId` (number) — Тайлан тушаах хугацааны дугаар
  - `period` (number) — Тайлант хугацаа улирал
  - `periodYear` (number) — Тайлант жил
  - `periodName` (string) — Тайлант хугацааны нэр
  - `returnBeginDate` (string) — Хуулийн хугацаа эхлэх огноо
  - `returnDueDate` (string) — Хуулийн хугацаа дуусах огноо
  - `reportNo` (number) — Тайлангийн дугаар
  - `taxReportStatus` (number) — Тайлангийн төлөв
  - `taxReportStatusName` (string) — Тайлангийн төлөвийн нэр
  - `formNo` (number) — Формын дугаар
  - `rsId` (number) — Хүсэлтийн дугаар
  - `licenseNo` (string) — Лицензийн дугаар
  - `descName` (string) — Тайлбар
  - `revenueId` (number) — Төрлийн бүртгэлийн дугаар
  - `subBranchId` (string) — Татварын дэд албаны дугаар
  - `subBranchCode` (string) — Татварын дэд албаны код
  - `subBranchName` (string) — Татварын дэд албаны нэр



### 3.4. `GET` Тайлангийн түүх харах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getHistory`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |



**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар
- `year` (number, **заавал**) — Тайлант жил

**Response талбар:**

- `code` (number) — Сервисийн алдааны код
- `message` (string) — Сервисийн алдааны утга
- `historyList` (object)
  - `taxReportCode` (string) — Тайлангийн маягтын код
  - `taxReportName` (string) — Тайлангийн маягтын нэр
  - `taxTypeCode` (string) — Татварын төрлийн код
  - `returnPeriods` (object) — Тайлант хугацааны жагсаалт
    - `year` (number) — Тайлант жил
    - `period` (number) — Тайлант хугацаа
    - `periodLabel` (string) — Тайлант хугацаа
    - `taxFrequency` (string) — Тайлант хугацааны давтамж
    - `startDate` (string) — Хуулийн хугацаа эхлэх огноо
    - `endDate` (string) — Хуулийн хугацаа дуусах огноо
    - `reports` (object)
      - `reportNo` (string) — Тайлангийн дугаар
      - `taxTypeId` (number) — Татварын төрлийн дугаар
      - `taxTypeCode` (string) — Татварын төрлийн код
      - `taxReportName` (string) — Тайлангийн нэр
      - `taxReportCode` (string) — Тайлангийн код
      - `taxFormNo` (number) — Формын дугаар
      - `branchId` (number) — Татварын албаны дугаар
      - `branchCode` (string) — Татварын албаны код
      - `branchName` (string) — Татварын албаны нэр
      - `year` (number) — Тайлант он
      - `period` (number) — Тайлант хугацаа
      - `receivedEmpCode` (string) — Хүлээн авсан байцаагчийн код
      - `receivedEmpName` (string) — Хүлээн авсан байцаагчийн нэр
      - `taxUserCode` (string) — Татвар төлөгчийн хэрэглэгчийн дугаар
      - `taxUserName` (string) — Татвар төлөгчийн хэргэлэгчийн нэр
      - `pin` (string) — Регистрийн дугаар
      - `tin` (string) — Татвар төлөгчийн дугаар
      - `refReportStatusId` (number) — Тайлангийн төлөвийн дугаар
      - `refReportStatusName` (string) — Тайлангийн төлөвийн нэр
      - `rsId` (string) — Хүсэлтийн дугаар
      - `rsStatus` (string) — Хүсэлтийн төлөв
      - `reqType` (string) — Хүсэлтийн төрөл
      - `licenseNo` (string) — Лицензийн дугаар
      - `assessmentAmount` (number) — Тайлангийн ногдолын дүн
      - `subBranchId` (number) — Татварын дэд албаны дугаар
      - `subBranchCode` (string) — Татварын дэд албаны код
      - `subBranchName` (string) — Татварын дэд албаны нэр
      - `revenueId` (number) — Төрлийн бүртгэлийн дугаар



### 3.5. `GET` Хоцорсон тайлангийн жагсаалт авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getLateList`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

Татвар төлөгчийн регистрийн дугаараар хүсэлт явуулан тухайн татвар төлөгчийн хоцорсон тайлангийн жагсаалт авах сервис. rsStatus = Хоцорсон тайлангийн төлөв

| **Хоцорсон төлвийн дугаар** | **Тайлбар** |
| --- | --- |
| null | Тайлан тушаагаагүй |
| 3 | Хүсэлт илгээсэн |
| 10 | Хуулийн хугацаа сунгасан |

**Query параметр:**

- `entId` (string, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар

**Response талбар:**

- `code` (number) — Сервисийн хариу дугаар
- `message` (string) — Сервисийн хариу тайлбар
- `reportLateList` (object) — Тайлангийн жагсаалт
  - `entId` (number) — Татвар төлөгчийн дугаар
  - `revenueId` (number) — Татварын дугаарлалт
  - `pin` (string) — Татвар төлөгчийн регистер
  - `reportFormId` (number) — Тайлангийн форм дугаар
  - `freqType` (string) — Тайлангийн хугацааны төрөл
  - `taxReportCode` (string) — Татварын тайлангийн дугаар
  - `taxTypeCode` (string) — Татварын төрлийн дугаар
  - `taxTypeId` (number) — Татварын төрлийн код
  - `taxTypeName` (string) — Татварын төрлийн нэр
  - `branchId` (number) — Татварын албаны дугаар
  - `branchCode` (string) — Татварын албаны нэр
  - `branchName` (string) — Татварын албаны код
  - `periodId` (number) — Тайлагнах хугацааны дугаар
  - `periodYear` (number) — Тайлагнах жил
  - `period` (number) — Тайлагнах хугацаа
  - `periodName` (string) — Тайлагнах хугацаа
  - `returnBeginDate` (string) — Тайлан тушааж эхлэх хугацаа
  - `returnDueDate` (string) — Тайлан тушааж дуусах хугацаа
  - `reportId` (number) — Тайлангийн дугаар
  - `status` (number) — Тайлангийн төлөв
  - `taxReportStatusName` (number) — Хоцорсон тайлангийн төлөв
  - `rsId` (number) — Хоцорсон хүсэлтийн дугаар
  - `formNo` (number)
  - `licenseNo` (string)
  - `subBranchId` (string)
  - `subBranchCode` (string)
  - `subBranchName` (string)
  - `descName` (string)



### 3.6. `GET` Тайлангийн формын жагсаалт авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getFormList`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |

> Татвар төлөгчийн нэг татварын төрөлд харгалзах тайлангийн маягтын жагсаалтууд авах сервис.

| **Тайлангийн төлвийн дугаар** | **Тайлбар** |
| --- | --- |
| 2 | Хадгалсан |
| 3 | Илгээсэн |
| 6 | Хуваарилсан |
| 11 | Хүлээн авсан |
| 8 | Буцаасан |

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар
- `formNo` (number, **заавал**) — Формын дугаар

**Response талбар:**

- `code` (number)
- `message` (string)
- `reportFormList` (object) — Тайлангийн форматын жагсаалт
  - `formNo` (number) — Маягтын дугаар
  - `formCode` (string) — Маягтын код
  - `formLabel` (string) — Маягтын гарчиг
  - `formName` (string) — Маягтын нэр
  - `taxTypeCode` (string) — Татварын төрөл
  - `formStatement` (string) — Маягтын тушаал
  - `type` (string) — Төрөл
  - `frequency` (string) — Тайлан тушаах давтамж
  - `listIndex` (number) — Индекс
  - `sublistIndex` (string)
  - `subForms` (array) — Хавсралт маягтийн жагсаалт
  - `expressionCells` (array) — Томьёоны жагс
    - `key` (string)
    - `tagId` (number)
    - `relations` (array)
      - `ssn` (number)
      - `key` (string)
      - `tagId` (number)
  - `infos` (array)

**Response жишээ:**

HTTP 200

```json
{
  "code": 0,
  "message": "string",
  "reportFormList": {
    "formNo": 0,
    "formCode": "string",
    "formLabel": "string",
    "formName": "string",
    "taxTypeCode": "string",
    "formStatement": "string",
    "type": "string",
    "frequency": "string",
    "listIndex": 0,
    "sublistIndex": null,
    "subForms": [
      {}
    ],
    "expressionCells": [
      {
        "key": "string",
        "tagId": 0,
        "relations": [
          {
            "ssn": 0,
            "key": "string",
            "tagId": 0
          }
        ]
      }
    ],
    "infos": [
      {}
    ]
  }
}
```


### 3.7. `GET` Тайлангийн формын загвар авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getFormDetail`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

> Татварын тайлан бүр тайлангийн батлагдсан маягттай байдаг. Маяг бүрийн агуулагдах мэдээлэл болон бүтэц өөр байдаг тул маягтын бүтцийг загварчлан динамик байдлаар сервисээр хүлээн авах боломжтой. Ингэснээр маягт бүр дээр тайланг зурах шаардлагагүй.

| **Тайлангийн төлвийн дугаар** | **Тайлбар** |
| --- | --- |
| 2 | Хадгалсан |
| 3 | Илгээсэн |
| 6 | Хуваарилсан |
| 11 | Хүлээн авсан |
| 8 | Буцаасан |

**Query параметр:**

- `branchId` (number, **заавал**) — Татварын албаны дугаар
- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар
- `formNo` (number, **заавал**) — Маягтын дугаар
- `period` (number, **заавал**) — Тайлант хугацаа
- `taxTypeId` (number, **заавал**) — Татварын төрлийн дугаар
- `year` (number, **заавал**) — Тайлант жил

**Response талбар:**

- `code` (number)
- `message` (string)
- `reportFormPass` (object)
  - `reportFormInfo` (object) — Маягтын ерөнхий мэдээлэл
    - `formNo` (string) — Формын дугаар
    - `reportCode` (string) — Тайлангийн код
    - `taxTypeCode` (string) — Татварын төрлийн код
    - `reportName` (string) — Тайлангийн нэр
    - `reportFrequency` (string) — Тайлангийн хуулийн хугацааны давтамж
    - `reportStatement` (string) — Тайлангийн батлагдсан тушаалын мэдээлэл
    - `version` (number) — Хувилбар
  - `sections` (array) — Бүлэг
    - `title` (string) — Гарчиг
    - `key` (string) — Түлхүүр үг
    - `sectionNo` (number) — Бүлгийн дугаар
    - `sequence` (number) — Дараалал
    - `colSpan` (number) — Баганы зай
    - `type` (string) — Төрөл
    - `headerHtml` (string)
    - `headers` (array) — Маягтын хүснэгтийн толгой
      - `sequence` (number)
      - `name` (string) — Нэр
      - `definition` (number) — Мөрийн дугаар
      - `field` (string) — Талбар
      - `colSpan` (number)
      - `width` (string) — Өргөн
      - `innerHtml` (string)
      - `style` (string) — Загвар
      - `dataType` (string) — Мэдээллийн төрөл
      - `hidden` (boolean)
    - `rows` (array) — Мөрний жагсаалт
      - `rowNumber` (number) — Мөрийн дугаар
      - `cells` (array)
        - `tagId` (number)
        - `columnKey` (string) — Баганын түлхүүр үг
        - `columnSequence` (number) — Баганын дугаар
        - `key` (string)
        - `defaultValue` (string) — Тогтмол утга
        - `regex` (string)
        - `expression` (string)
        - `dataType` (string) — Мэдээллийн төрөл
        - `drawType` (string) — Талбарын төрөл
        - `isTag` (boolean) — Таг эсэх
        - `isDisable` (boolean) — Утга авах эсэх true-утга авна
        - `allowMinus` (boolean) — Хасах утга авах эсэх/false бол хасах утга авахгүй
        - `rowSpan` (number) — Мөрийн зай
        - `colSpan` (number)
        - `style` (string)
        - `isAssessment` (number) — Ногдол татах
        - `rowNumber` (number) — Мөрийн дугаар
        - `sectionNo` (number)
        - `formNo` (number)
        - `validations` (array)
          - `validationKey` (string) — Шалгуурын код
          - `cellKey` (string) — Тухайн нэг нүдний код
          - `validCondition` (string) — Шалгах нөхцөл
          - `errorType` (string) — Алдааны төрөл
          - `errorMessage` (string) — Алдааны мэдээ
          - `status` (number) — Төлөв
    - `viewHeader` (boolean)
    - `viewDefinition` (boolean)

**Response жишээ:**

HTTP 200

```json
{
  "code": 0,
  "message": "string",
  "reportFormPass": {
    "reportFormInfo": {
      "formNo": "string",
      "reportCode": "string",
      "taxTypeCode": "string",
      "reportName": "string",
      "reportFrequency": "string",
      "reportStatement": "string",
      "version": 0
    },
    "sections": [
      {
        "title": "string",
        "key": "string",
        "sectionNo": 0,
        "sequence": 0,
        "colSpan": 0,
        "type": "string",
        "headerHtml": "string",
        "headers": [
          {
            "sequence": 0,
            "name": "string",
            "definition": 0,
            "field": "string",
            "colSpan": 0,
            "width": "string",
            "innerHtml": "string",
            "style": "string",
            "dataType": "string",
            "hidden": true
          }
        ],
        "rows": [
          {
            "rowNumber": 0,
            "cells": [
              {
                "tagId": 0,
                "columnKey": "string",
                "columnSequence": 0,
                "key": "string",
                "defaultValue": "string",
                "regex": null,
                "expression": "string",
                "dataType": "string",
                "drawType": "string",
                "isTag": true,
                "isDisable": true,
                "allowMinus": true,
                "rowSpan": 0,
                "colSpan": 0,
                "style": null,
                "isAssessment": 0,
                "rowNumber": 0,
                "sectionNo": 0,
                "formNo": 0,
                "validations": [
                  {
                    "validationKey": "string",
                    "cellKey": "string",
                    "validCondition": "string",
                    "errorType": "string",
                    "errorMessage": "string",
                    "status": 0
                  }
                ]
              }
            ]
          }
        ],
        "viewHeader": true,
        "viewDefinition": true
      }
    ]
  }
}
```


### 3.8. `GET` Тайлангийн формын дата авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getFormData`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

> Тайлангийн маягтын загварыг дуудсаны дараа тайлангийн мэдээлэл сервисийг дуудаж тухайн нэг нүдэнд харгалзах tagKey–р холбогдож утга бөглөгдөнө.

| **Тайлангийн төлвийн дугаар** | **Тайлбар** |
| --- | --- |
| 2 | Хадгалсан |
| 3 | Илгээсэн |
| 6 | Хуваарилсан |
| 11 | Хүлээн авсан |
| 8 | Буцаасан |

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар
- `reportId` (number, **заавал**) — Тайлангийн дугаар

**Response талбар:**

- `reportNo` (number) — Тайлангийн дугаар
- `reportNoStr` (string) — Тайлангийн UUID
- `pin` (string) — Татвар төлөгчийн регистр
- `taxTypeId` (number) — Татварын төрлийн дугаар
- `taxTypeDesc` (string) — Татварын төрлийн
- `taxTypeCode` (string) — Татварын төрлийн код
- `branchId` (number) — Татварын албаны дугаар
- `branchCode` (string) — Татварын албаны код
- `branchName` (string) — Татварын албаны нэр
- `formNo` (string) — Маягтын дугаар
- `entId` (number) — Татвар төлөгчийн бүртгэлийн дугаар
- `entName` (string) — Татвар төлөгчийн нэр
- `year` (number) — Тайлант жил
- `period` (number) — Тайлант хугацаа
- `isXreport` (boolean) — Х тайлан эсэх
- `reportStatusId` (number) — Тайлангийн төлөвийн дугаар
- `reportStatusName` (string) — Тайлангийн төлөвийн нэр
- `receivedDate` (string) — Хүлээн авсан огноо
- `receivedEmp` (string) — Хүлээн авсан байцаагч
- `submittedDate` (string) — Илгээсэн огноо
- `doneDate` (string)
- `activitiType` (string)
- `resubmitId` (number)
- `licenseNo` (string) — Тусгай зөвшөөрлийн дугаар
- `fileGroupId` (string) — Файлын дугаар
- `revenueId` (number) — Төрлийн бүртгэлийн дугаар
- `tagKey` (string) — Тухайн нэг нүдний код
- `value` (string) — Тухайн нэг нүдний утга
- `type` (number) — Төрөл
- `tagId` (number) — Нүдний дугаар

**Response жишээ:**

HTTP 200

```json
{
  "reportNo": 9784777,
  "reportNoStr": "b8986db1-1161-4c14-a2c1-ba1d6dc6da588",
  "pin": "99999999",
  "taxTypeId": 0,
  "taxTypeDesc": "01010101-Цалин, хөдөлмөрийн  хөлс, тэдгээртэй адилтгах  орлогоос суутгасан татвар",
  "taxTypeCode": "01010101",
  "branchId": 1,
  "branchCode": "39",
  "branchName": "ТЕГ",
  "formNo": "1145",
  "entId": 10124763,
  "entName": "ТЕСТИЙН ХЭРЭГЛЭГЧ",
  "year": 2024,
  "period": 5,
  "isXreport": true,
  "reportStatusId": 2,
  "reportStatusName": "Шинэ",
  "receivedDate": "2020-05-26 21:44:29",
  "receivedEmp": "СИСТЕМ",
  "submittedDate": "2020-05-26 21:44:29",
  "doneDate": "2020-05-26 21:44:29",
  "activitiType": "null",
  "resubmitId": 0,
  "licenseNo": "null",
  "fileGroupId": "null",
  "revenueId": 7472744,
  "tagKey": "TG4232",
  "value": "0",
  "type": 0,
  "tagId": 8888
}
```


### 3.9. `POST` Тайлан хадгалах

**Endpoint:** `POST https://etax.mta.mn/api/beta/return/saveFormData`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

> Татварын тайлан хадгалах сервис.

| **Тайлангийн төлвийн дугаар** | **Тайлбар** |
| --- | --- |
| 2 | Хадгалсан |
| 3 | Илгээсэн |
| 6 | Хуваарилсан |
| 11 | Хүлээн авсан |
| 8 | Буцаасан |

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар

**Request body:**

- `reportData` (object, **заавал**)
  - `reportNo` (number, **заавал**) — Татварын тайлангийн дугаар
  - `taxTypeId` (number, **заавал**) — Татварын төрөл
  - `branchId` (number, **заавал**) — Татварын албаны дугаар
  - `year` (number, **заавал**) — Тайлант жил
  - `period` (number, **заавал**) — Тайлант хугацаа
  - `isXreport` (number, **заавал**) — Үйл ажиллагаа явуулаагүй бол X тайлан илгээнэ
  - `formNo` (number, **заавал**) — Тайлангийн формын дугаар
  - `activitiType` (number, **заавал**) — Хуваарилалтын төрөл
  - `resubmitId` (number, **заавал**) — Хүсэлтийн дугаар
  - `fileGroupId` (string, **заавал**) — Файлын дугаар
  - `reportStatusId` (number, **заавал**) — Тайлангийн төлөвийн дугаар
  - `licenseNo` (string, **заавал**) — Лицензтэй тайлангийн лицензийн дугаар
  - `revenueId` (number, **заавал**) — Тайлангийн төрлийн дугаар
- `reportDataDetail` (array, **заавал**) — Тайлангийн маягтын дэлгэрэнгүй мэдээлэл
  - `tagId` (number, **заавал**)
  - `type` (number, **заавал**)
  - `tagKey` (string, **заавал**)
  - `value` (string, **заавал**)

**Response талбар:**

- `code` (number)
- `message` (string)
- `reportData` (object)
  - `reportNo` (number)
  - `reportNoStr` (string)
  - `taxTypeId` (number)
  - `taxTypeCode` (number)
  - `taxTypeDesc` (number)
  - `branchId` (number)
  - `formNo` (number)
  - `entId` (number)
  - `entName` (string)
  - `year` (number)
  - `period` (number)
  - `isXreport` (number)
  - `reportStatusId` (number)
  - `branchName` (string)
  - `branchCode` (number)
  - `pin` (string)
  - `reportStatusName` (string)
  - `recievedEmp` (string)
  - `recievedDate` (string)
  - `submittedDate` (string)
  - `doneDate` (string)
  - `activitiType` (number)
  - `resubmitId` (number)
  - `licenseNo` (string)
  - `fileGroupId` (string)
  - `revenueId` (string)
  - `createdBy` (string)
  - `createdDate` (string)
  - `isConfirmOther` (string)
  - `noticeInfo` (string)

**Response жишээ:**

HTTP 200

```json
{
  "code": 0,
  "message": "Таны оруулсан мэдээлэл амжилттай хадгалагдлаа. Баярлалаа",
  "reportData": {
    "reportNo": 9644301,
    "reportNoStr": "TT-02",
    "taxTypeId": 32,
    "taxTypeCode": 32,
    "taxTypeDesc": 32,
    "branchId": 31,
    "formNo": 1252,
    "entId": 123456789,
    "entName": "Test",
    "year": 2024,
    "period": 4,
    "isXreport": 0,
    "reportStatusId": 2,
    "branchName": "Test",
    "branchCode": 12,
    "pin": "2830213",
    "reportStatusName": null,
    "recievedEmp": null,
    "recievedDate": null,
    "submittedDate": null,
    "doneDate": null,
    "activitiType": 1,
    "resubmitId": 0,
    "licenseNo": "0",
    "fileGroupId": null,
    "revenueId": null,
    "createdBy": null,
    "createdDate": null,
    "isConfirmOther": null,
    "noticeInfo": null
  }
}
```


### 3.10. `POST` Тайлан илгээх

**Endpoint:** `POST https://etax.mta.mn/api/beta/return/submit`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

> Тайлан хадгалсаны дараа тайлан илгээх боломжтой байна. Тайлан илгээхэд тайлангийн формын загвар авах сервисийн validations хэсгийн шалгуурыг хангасан үед тайлан илгээгдэнэ.

| **Тайлангийн төлвийн дугаар** | **Тайлбар** |
| --- | --- |
| 2 | Хадгалсан |
| 3 | Илгээсэн |
| 6 | Хуваарилсан |
| 11 | Хүлээн авсан |
| 8 | Буцаасан |

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар

**Request body:**

- `reportNo` (number) — Тайлангийн дугаар
- `taxTypeId` (number) — Татварын төрлийн дугаар
- `branchId` (number) — Татварын албаны дугаар
- `year` (number) — Тайлант жил
- `period` (number) — Тайлант хугацаа
- `isXreport` (number) — Х тайлан эсэх
- `formNo` (number) — Маягтын дугаар
- `resubmitId` (number)
- `activitiType` (number)
- `reportStatusId` (number) — Тайлангийн төлөвийн дугаар

**Response талбар:**

- `code` (number)
- `message` (string)

**Response жишээ:**

HTTP 200

```json
{
  "code": 0,
  "message": "string"
}
```


### 3.11. `GET` Тайлангийн мэдээний жагсаалт авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getSheetList`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

Тухайн тайлангийн маягтын хавсралт мэдээний жагсаалт авах сервис

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар
- `formNo` (number, **заавал**) — Маягтын дугаар
- `reportNo` (number, **заавал**) — Тайлангийн дугаар

**Response талбар:**

- `sheetFormNo` (number) — Мэдээний маягтын дугаар
- `sheetName` (string) — Мэдээний нэр
- `sheetCode` (string) — Мэдээний код
- `sheetLabel` (string) — Мэдээний гарчиг
- `sheetVersion` (string) — Хувилбар
- `sequence` (number) — Мэдээний дараалал
- `status` (number) — Төлөв
- `statusDesc` (string) — Төлөвийн нэр
- `updateDate` (string) — Засварласан огноо
- `createDate` (string) — Хадгалсан огноо
- `listIndex` (number) — Жагсаалтын индекс
- `listName` (string) — Жагсаалтын нэр
- `sheetType` (number) — Мэдээний төрөл
- `sheetSum` (object)
  - `key` (string) — Нүдний код
  - `value` (string) — Утга
- `sheetSubSum` (object)

**Response жишээ:**

HTTP 200

```json
{
  "sheetFormNo": 0,
  "sheetName": "string",
  "sheetCode": "string",
  "sheetLabel": "string",
  "sheetVersion": "string",
  "sequence": 0,
  "status": 0,
  "statusDesc": "string",
  "updateDate": "string",
  "createDate": "string",
  "listIndex": 0,
  "listName": "string",
  "sheetType": 0,
  "sheetSum": {
    "key": "string",
    "value": "string"
  },
  "sheetSubSum": {}
}
```


### 3.12. `GET` Тайлангийн мэдээний загвар авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getSheetDetail`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

> Тайлангийн мэдээний маягтын загвар авах сервис.

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар
- `sheetFormNo` (number, **заавал**) — Мэдээний дугаар

**Response талбар:**

- `sheetName` (string) — Мэдээний нэр
- `sheetCode` (string) — Мэдээний код
- `sheetVersion` (string) — Хувилбар
- `sheetFormNo` (number) — Мэдээний дугаар
- `sheetLabel` (string) — Мэдээний гарчиг
- `listName` (string) — Маягтын хүснэгтийн толгой
- `createdDate` (string) — Үүсгэсэн огноо
- `isActive` (number) — Идэвхтэй эсэх
- `headerInfoText` (string)
- `sheetType` (number) — Мэдээний төрөл
- `isNewRow` (number)
- `isRemoveRow` (number)
- `isInsertDeleteRow` (number)
- `isExcelImport` (number)
- `isExcelExport` (number)
- `sheetFormHtmlShow` (number)
- `child` (string)
- `sequence` (number) — Дараалал
- `name` (string) — Нэр
- `definition` (string)
- `field` (string) — Талбар
- `colSpan` (string)
- `width` (string) — Өргөн
- `innerHtml` (string)
- `style` (string) — Загвар
- `dataType` (string) — Өгөгдлийн төрөл
- `columnKey` (string) — Баганын код
- `columnSequence` (number) — Баганын дугаар
- `defaultValue` (string) — Тогтмол утга
- `expression` (string) — Томьёо
- `drawType` (string)
- `isDisable` (boolean) — Утга авах эсэх
- `hasSum` (number)
- `formulaType` (number)
- `maxLength` (number)
- `hidden` (boolean)
- `accuracy` (number)
- `isNull` (number)
- `groupSum` (number)
- `tagKeyChar` (string)

**Response жишээ:**

HTTP 200

```json
{
  "sheetName": "string",
  "sheetCode": "string",
  "sheetVersion": "string",
  "sheetFormNo": 0,
  "sheetLabel": "string",
  "listName": "string",
  "createdDate": "string",
  "isActive": 0,
  "headerInfoText": "string",
  "sheetType": 0,
  "isNewRow": 0,
  "isRemoveRow": 0,
  "isInsertDeleteRow": 0,
  "isExcelImport": 0,
  "isExcelExport": 0,
  "sheetFormHtmlShow": 0,
  "child": "string",
  "sequence": 0,
  "name": "string",
  "definition": "string",
  "field": "string",
  "colSpan": "string",
  "width": "string",
  "innerHtml": "string",
  "style": "string",
  "dataType": "string",
  "columnKey": "string",
  "columnSequence": 0,
  "defaultValue": "string",
  "expression": "string",
  "drawType": "string",
  "isDisable": true,
  "hasSum": 0,
  "formulaType": 0,
  "maxLength": 0,
  "hidden": true,
  "accuracy": 0,
  "isNull": 0,
  "groupSum": 0,
  "tagKeyChar": "string"
}
```


### 3.13. `GET` Тайлангийн мэдээний дата авах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/getSheetData`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

Тайлангийн мэдээний дата авах сервис

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар
- `filter` (number, **заавал**) — Шүүлтүүр
- `page` (number, **заавал**) — Хуудасны дугаар
- `reportNo` (number, **заавал**) — Тайлангийн дугаар
- `sheetFormNo` (number, **заавал**) — Мэдээний дугаар
- `size` (number, **заавал**) — Хуудаслалтын хэмжээ

**Response талбар:**

- `sheetFormNo` (string) — Мэдээний дугаар
- `sheetCode` (string) — Мэдээний код
- `reportNo` (number) — Тайлангийн дугаар
- `mapId` (number)
- `isTotal` (number) — Нийт дүн
- `rowNumber` (number) — Мөрийн дугаар
- `type` (number) — Төрөл
- `key` (string) — Нүдний код
- `value` (string) — Нүдний утга

**Response жишээ:**

HTTP 200

```json
{
  "sheetFormNo": "string",
  "sheetCode": "string",
  "reportNo": 0,
  "mapId": 0,
  "isTotal": 0,
  "rowNumber": 0,
  "type": 0,
  "key": "string",
  "value": "string"
}
```


### 3.14. `POST` Тайлангийн мэдээ хадгалах

**Endpoint:** `POST https://etax.mta.mn/api/beta/return/saveSheetData`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapit@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

Тайлангийн мэдээ хадгалах сервис

**Query параметр:**

- `entId` (string, **заавал**) — Татвар төлөгчийн бүртгэлийн дугаар

**Request body:**

- `sheetFormNo` (number) — Мэдээний формын дугаар
- `reportNo` (number) — Тайлангийн дугаар
- `activitiType` (number) — Хуваарилалтын төрөл
- `resubmitId` (number) — Хүсэлтийн дугаар
- `sheetCode` (string) — Мэдээний код
- `sheetDataDetail` (array) — Мэдээний дэлгэрэнгүй
  - `rowNumber` (number) — Мөрийн дугаар
  - `isTotal` (number) — Нийт дүн
  - `isChecked` (boolean)
  - `isEdit` (boolean)
  - `type` (string)
  - `cells` (array) — Нүдний жагсалт
    - `key` (string) — Нүдний код
    - `value` (string) — Нүдний утга

**Response талбар:**

- `reportData` (object)
  - `reportNo` (number)
  - `taxTypeId` (string)
  - `branchId` (string)
  - `year` (number)
  - `period` (number)
  - `isXreport` (number)
  - `formNo` (number)
  - `activitiType` (number)
  - `resubmitId` (number)
  - `fileGroupId` (string)
  - `reportStatusId` (string)
- `reportDataDetail` (array<string>)

**Response жишээ:**

HTTP 200

```json
{
  "reportData": {
    "reportNo": 0,
    "taxTypeId": "7",
    "branchId": "23",
    "year": 2024,
    "period": 3,
    "isXreport": 0,
    "formNo": 1250,
    "activitiType": 1,
    "resubmitId": 0,
    "fileGroupId": "",
    "reportStatusId": null
  },
  "reportDataDetail": [
    null
  ]
}
```


### 3.15. `POST` Тайлангийн мэдээг мөрөөр устгах

**Endpoint:** `POST https://etax.mta.mn/api/beta/return/deleteAllSheetData`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | ‘request@itc.gov.mn мэйлээр ирсэн тусгай key тохируулна” |

Тайлангийн мэдээг мөрөөр устгах сервис

**Query параметр:**

- `entId` (number, **заавал**) — Татвар төлөгчийн дугаар

**Request body:**

- `sheetFormNo` (number, **заавал**) — Мэдээний дугаар
- `reportNo` (number, **заавал**) — Тайлангийн дугаар
- `activitiType` (number, **заавал**) — Хуваарилалтын төрөл
- `resubmitId` (number, **заавал**) — Хүсэлтийн дугаар

**Response талбар:**

- `code` (number)
- `message` (string)

**Response жишээ:**

HTTP 200

```json
{
  "code": 0,
  "message": "string"
}
```


### 3.16. `GET` Тайлангийн мэдээг устгах

**Endpoint:** `GET https://etax.mta.mn/api/beta/return/deleteAllSheetData`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `` | posapi@itc.gov.mn -с мэйлээс авсан тусгай key-г тохируулна |

Тайлангийн мэдээг устгах сервис.

**Response талбар:**

- `msg` (string)
- `status` (number)
- `data` (array)
  - `invoiceNo` (string)
  - `taxTypeName` (string)
  - `branchId` (number)
  - `branchCode` (string)
  - `branchName` (string)
  - `subBranchId` (number)
  - `subBranchCode` (string)
  - `subBranchName` (string)
  - `year` (number)
  - `period` (number)
  - `astRegNumber` (string)
  - `payable` (number)
  - `invoiceStatusName` (string)
  - `invoiceType` (number)
  - `balance` (number)
  - `pin` (string)
  - `tin` (string)

**Response жишээ:**

HTTP 200

```json
{
  "msg": "string",
  "status": 0,
  "data": [
    {
      "invoiceNo": "string",
      "taxTypeName": "string",
      "branchId": 0,
      "branchCode": "string",
      "branchName": "string",
      "subBranchId": 0,
      "subBranchCode": "string",
      "subBranchName": "string",
      "year": 0,
      "period": 0,
      "astRegNumber": null,
      "payable": 0,
      "invoiceStatusName": "string",
      "invoiceType": 0,
      "balance": 0,
      "pin": "string",
      "tin": "string"
    }
  ]
}
```


## 4. Татварын цахим нэхэмжлэх

- `GET` Татварын цахим нэхэмжлэхийн жагсаалт лавлах сервис
- `GET` XYP-Төлөгдөөгүй татварын нэхэмжлэх лавлах сервис
- `POST` XYP-Татварын төлбөрийн хүсэлт үүсгэх сервис
- `GET` XYP-Татварын төлөлт шалгах сервис


### 4.1. `GET` Татварын цахим нэхэмжлэхийн жагсаалт лавлах сервис

**Endpoint:** `GET https://etax.mta.mn/api/beta/actTransactions/getUnPaidInvoiceByPinAndYear`  
**Content-Type:** `application/json` · **Token:** тийм

| Header | Утга | Тайлбар |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Нэвтрэх токен |
| `NE-KEY` | `Хөгжүүлэлтийн орчинд шаардлагагүй` | Татварын ерөнхий газрын-Татвар төлөгчид үйлчлэх газарт албан тоотоор хүсэлт гарган авна |
| `X-API-KEY` | `d8589771105c5eeb003734480b74b0d267d643ad /Хөгжүүлэлтийн орчинд ашиглах` | Татварын ерөнхий газрын-Татвар төлөгчид үйлчлэх газарт албан тоотоор хүсэлт гарган авна |

> Татварын нэхэмжлэхийн төлбөрийн үйл явцыг хялбарчилж, хурдасгах зорилгоор нээлттэй API сервисийг хөгжүүлэн нэвтрүүллээ.

**Татварын нэхэмжлэхийн сервис ашиглах ерөнхий процесс**

![зураг](https://developer.itc.gov.mn/api/developer-itc-service/uploads/images/proj-1787125468395_ea5ea50c-7a0e-4768-8f34-0325f8ca2f56.png)

> Анхаарах асуудал: Бодит орчинд тус сервисийг зөвхөн 01:00–07:00 цагийн хооронд дуудан ашиглах боломжтой ба хөгжүүлэлтийн орчинд тестийн хэрэглэгчийн мэдээлэл татахад цагийн хязгаарлалт үйлчлэхгүй болно.

**Query параметр:**

- `year` (string, **заавал**) — Нэхэмжлэх лавлах он · Жишээ: `2026`

**Response талбар:**

- `msg` (string) — Сервисийн хариу тайлбар
- `status` (number) — 200 OK — Амжилттай
- `data` (array) — Нэхэмжлэхийн жагсаалт
  - `invoiceNo` (string) — Нэхэмжлэхийн дугаар
  - `taxTypeName` (string) — Татварын төрөл
  - `branchCode` (string) — Татварын албаны код
  - `branchName` (string) — Татварын албаны нэр
  - `subBranchCode` (string) — Татварын дэд албаны код
  - `subBranchName` (string) — Татварын дэд албаны нэр
  - `year` (number) — Татварын тайлант он
  - `period` (number) — Тайлагналын хугацаа
  - `astRegNumber` (string) — Хөрөнгийн дугаар
  - `astChassisNo` (string) — Арлын дугаар
  - `payable` (number) — Татварын нэхэмжлэхийн дагуу төлөх дүн
  - `invoiceStatusName` (string) — Нэхэмжлэхийн төлвийн нэр
  - `invoiceType` (number) — Нэхэмжлэхийн төлвийн код
  - `balance` (number) — Татварын нэхэмжлэхийн үлдэгдэл дүн
  - `pin` (string) — Регистрийн дугаар
  - `tin` (string) — Бүртгэлийн дугаар

**Response талбар — дэлгэрэнгүй:**

###### `period`

periodType нь Жил байвал 1 гэж буцаана, periodType нь Улирал байвал 1, 2,3,4 гэж буцаана, periodType нь Сар байвал 1-12 гэж буцаана,

**Response жишээ:**

HTTP 200

```json
{
  "msg": "Амжилттай",
  "status": 200,
  "data": [
    {
      "invoiceNo": "1251000001501",
      "taxTypeName": "Автын агаарын бохирдлын төлбөр",
      "branchCode": "36",
      "branchName": "ТЕГ",
      "subBranchCode": null,
      "subBranchName": null,
      "year": 2026,
      "period": 10,
      "astRegNumber": "5626УБГ",
      "astChassisNo": "ZVW301178145",
      "payable": 30000,
      "invoiceStatusName": "Хүлээгдэж байгаа",
      "invoiceType": 1,
      "balance": -30000,
      "pin": "99119911",
      "tin": "37900846788"
    }
  ]
}
```


### 4.2. `GET` XYP-Төлөгдөөгүй татварын нэхэмжлэх лавлах сервис

**Endpoint:** `GET /WS100636_UnpaidTaxInformationService`  
**Content-Type:** `application/json` · **Token:** үгүй

> Энэхүү сервис нь төлөгдөөгүй татварын нэхэмжлэх лавлах зориулалттай бөгөөд татварын төрлөөс хамааран тохирох параметрийг ашиглан хүсэлт илгээнэ.

1. "Автотээвэр болон өөрөө явагч хэрэгслийн албан татвар"- carNumber эсхүл chassisNo талбарт автомашины улсын дугаар эсхүл арлын дугаарыг дамжуулна.
2. "Үл хөдлөх хөрөнгийн албан татвар"- certificateNo талбарт үл хөдлөхийн гэрчилгээний дугаарыг дамжуулна.
3. "Газрын албан татвар"- parcelNo талбарт газрын нэгж талбарын дугаарыг дамжуулна.
4. "Галт зэвсэгийн албан татвар"- lockNo эсхүл barrelNo талбаруудад харгалзах утгыг дамжуулна.
5. "Татварын нэхэмжлэхийн дугаараар лавлах"- invoiceNo талбарт нэхэмжлэхийн дугаарыг дамжуулна.

**Анхаарна уу:**  Нэг хүсэлтэд зөвхөн тухайн татварын төрөлд хамаарах параметрт утга дамжуулна. Бусад параметрийг хоосон эсхүл дамжуулахгүй байна

**Query параметр:**

- `barrelNo` (string) — Галт зэвсэгийн гол төмрийн дугаар
- `carNumber` (string) — Автомашины улсын дугаар
- `certificateNo` (string) — Үл хөдлөхийн гэрчилгээний дугаар
- `invoiceNo` (string) — Нэхэмжлэхийн дугаар
- `lockNo` (string) — Галт зэвсэгийн түгжээний дугаар
- `parcelNo` (string) — Газрын нэгж талбарын дугаар
- `chassisNo` (string) — Автомашины арлын дугаар

**Response талбар:**

- `invoices` (array) — Нэхэмжлэхийн жагсаалт
  - `name` (string) — Татварын төрөл
  - `amount` (number) — Төлөх дүн
  - `invoiceNo` (string) — Нэхэмжлэхийн дугаар
  - `year` (number) — Он
- `info` (object)
  - `lockNo` (string) — Галт зэвсэгийн түгжээний дугаар
  - `barrelNo` (string) — Галт зэвсэгийн гол төмрийн дугаар
  - `regNumber` (string) — Автомашины улсын дугаар
  - `chassisNo` (string) — Автомашины арлын дугаар
  - `model` (string) — Загвар
  - `mark` (string) — Үйлдвэрлэгч/марк
  - `certificateNo` (string) — Гэрчилгээний дугаар

**Response жишээ:**

HTTP 200

```json
{
  "invoices": [
    {
      "name": "Автотээвэр, өөрөө явагч хэрэгслийн албан татвар",
      "amount": 100000,
      "invoiceNo": "123456789123",
      "year": 2026
    }
  ],
  "info": {
    "lockNo": null,
    "barrelNo": null,
    "regNumber": "1234УБА",
    "chassisNo": "645fg55458454d",
    "model": null,
    "mark": "Toyota",
    "certificateNo": null
  }
}
```


### 4.3. `POST` XYP-Татварын төлбөрийн хүсэлт үүсгэх сервис

**Endpoint:** `POST /WS100637_TaxPaymentService`  
**Content-Type:** `application/json` · **Token:** үгүй

> Энэхүү сервис нь төлөгдөөгүй татварын төлөлт хийх QR үүсгэх зориулалттай. Сервисийн хариунд буцсан төрийн сангийн дансны дугаар (stateAccountNo) руу шилжүүлэг хийхдээ description талбарын утгыг гүйлгээний утга болгон ашиглана.

> **Анхаарна уу:**  stateAccountNo болон description талбарын утгыг сервисийн хариунаас өөрчлөлтгүйгээр ашиглана. description талбарын утгыг өөрчилсөн тохиолдолд төлөлт хаагдахгүй.

**Мэдэгдэл хүргүүлэх (Callback)**

Төлбөр амжилттай төлөгдөх үед системээс fintechCallback URL руу POST хүсэлт илгээнэ.

```
Method: POST
Headers: Content-Type: application/json
Request Body:
{  
"uuid": "Гүйлгээний лавлах дугаар", 
"transactionNo": "Төлбөрийн дугаар",  
"fintechId": "Финтек ID",  
"mofRefNum": 2922,  
"amount": 1000.0,  
"date": "2025-05-06 23:10:09"
}
```

**Тайлбар:**

- date формат: yyyy-MM-dd HH:mm:ss
- mofRefNum: MOF-оос ирсэн гүйлгээний лавлах дугаар (тоо/BigDecimal хэлбэрээр).

**Request body:**

- `payments` (array, **заавал**)
  - `invoiceNo` (string, **заавал**) — Нэхэмжлэхийн дугаар
  - `amount` (number, **заавал**) — Төлөх дүн
- `payerReg` (string, **заавал**) — Татвар төлөгчийн регистр
- `transactionNo` (string, **заавал**) — Финтекийн гүйлгээний дугаар
- `callBack` (string, **заавал**) — Финтек рүү мэдэгдэл хүргүүлэх callback

**Response талбар:**

- `statementNo` (string) — Гүйлгээний дугаар
- `stateAccountNo` (string) — Төрийн сангийн дансны дугаар
- `stateAccountName` (string) — Төрийн сангийн дансны нэр
- `totalAmount` (number) — Төрийн сангийн дансны нэр
- `description` (string) — Гүйлгээний утга
- `transactionNo` (string) — Финтекийн гүйлгээний дугаар

**Response жишээ:**

HTTP 200

```json
{
  "statementNo": "GJ4554545",
  "stateAccountNo": "11452010201",
  "stateAccountName": "Төрийн сан",
  "totalAmount": 100000,
  "description": "123456789123-Автотээвэр, өөрөө явагч хэрэгслийн албан татвар",
  "transactionNo": "9876543бб21"
}
```


### 4.4. `GET` XYP-Татварын төлөлт шалгах сервис

**Endpoint:** `GET /WS100638_TaxPaymentVerificationService`  
**Content-Type:** `application/json` · **Token:** үгүй

> Энэхүү сервис нь татварын нэхэмжлэхийн төлөлтийн мэдээллийг шалгах зориулалттай.

#####

**Query параметр:**

- `statementNo` (string) — Гүйлгээний дугаар
- `transactionNo` (string) — Финтекийн гүйлгээний дугаар

**Response талбар:**

- `msg` (string, **заавал**) — Хариу мессэж
- `status` (number, **заавал**) — Хүсэлтийн үр дүнгийн код
- `data` (string, **заавал**) — Төлбөрийн төлөв (PAID) эсхүл хоосон утга ("")

**Response жишээ:**

HTTP 200

```json
{
  "msg": "Амжилттай",
  "status": 200,
  "data": "PAID"
}
```
