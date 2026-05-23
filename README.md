# BuhClaude

Self-hosted система документооборота и бухгалтерского учёта для малого бизнеса в РФ.
Учитывает налоговую реформу 2026 (ФЗ от 28.11.2025 № 425-ФЗ): НДС 22%, режимы УСН-НДС 5/7%, АУСН.

## Возможности

**Справочники:**
- **Организации** — реквизиты, банковские счета, налоговый режим (ОСН/УСН/АУСН/ПСН/НПД), режим НДС (общий / УСН-5% / УСН-7% / без НДС)
- **Контрагенты** — с подсказками от DaData по ИНН, контрольные суммы ИНН/ОГРН на клиенте и сервере
- **Номенклатура** — товары / услуги / работы, единицы ОКЕИ, ставки НДС
- **Договоры** — со связкой организация ↔ контрагент, период действия, сумма, статус

**Документы:**
- **Счета на оплату** — автонумерация, расчёт сумм с decimal-точностью, статусы DRAFT / SENT / PARTIALLY_PAID / PAID / OVERDUE / CANCELLED
- **Акты выполненных работ** (402-ФЗ ст. 9)
- **УПД** — универсальный передаточный документ (приказ ФНС ММВ-7-15/820@), статус 1 (СЧФ+ДОП) и статус 2 (ДОП)
- **ТОРГ-12** — товарная накладная (ОКУД 0330212)
- **Document chain:** «Создать на основании» — договор → счёт → акт/УПД/ТОРГ-12 с авто-копированием позиций
- **Блокировка редактирования** для SIGNED/ACCEPTED/PAID/CANCELLED (по 402-ФЗ — только исправления)

**Финансы:**
- **Платежи** — поступления и расходы; **multi-allocation:** один платёж может закрывать несколько счетов одного контрагента (`allocations: [{invoiceId, amount}]`); сохранена обратная совместимость с одиночным `invoiceId`.
- **Автостатусы счетов** — auto-пересчёт по сумме всех `PaymentAllocation`: частичная → PARTIALLY_PAID, полная → PAID + `paidAt`; редактирование/удаление платежа пересчитывает все затронутые счета (старые и новые).
- **Авансы** — если сумма платежа > распределённого, нераспределённый остаток считается авансом контрагента (виден на платеже и в выписке как «Аванс»).
- **Валидации:** OUT-платёж не закрывает наш счёт; нельзя распределить на CANCELLED; нельзя переплатить счёт; все счета пакета должны быть той же организации и того же контрагента.
- **Карточка контрагента** (`/counterparties/:id`) — выписка с реквизитами, договорами, счетами, актами, платежами и блоком «Баланс» (выставлено / оплачено / распределено / аванс / долг / просроченный долг). Быстрые действия: создать счёт / договор / платёж / акт сверки.
- **Акт сверки** — взаимные расчёты за период; счёт = дебет, IN-платёж (включая нераспределённый аванс) = кредит; акт на основании счёта **не удваивает** задолженность; PDF с подписью и расшифровкой «долг контрагента / аванс».

**Помощник:**
- **AI ассистент** — OpenAI-compatible (OpenAI, VseGPT, AITunnel, локальные); structured JSON actions с preview перед применением; не пишет в БД без подтверждения
- **Импорт справочников** — XLSX/CSV для контрагентов, номенклатуры, платежей; dry-run preview с отчётом по строкам
- **Импорт банковской выписки** — CSV/XLSX → preview с авто-сопоставлением (контрагент по ИНН/имени, счёт по номеру в назначении или авторазнос FIFO) → подтверждение → Payment + PaymentAllocation. Дубль-детект по reference+date+amount или date+amount+purpose. Пример: `examples/bank-statements/sample-bank-statement.csv`
- **Экспорт** — список любого типа документов в CSV (UTF-8 BOM) и XLSX

**PDF и печатные формы (Sprint 5):**
- 6 шаблонов: счёт / акт / УПД / ТОРГ-12 / акт сверки / договор
- **Реквизиты организации:** руководитель/должность/«на основании» (Устава), бухгалтер с должностью, юр./факт./почтовый адрес, телефон, email, сайт
- **Изображения для печатных форм:** логотип / печать / подпись — загрузка PNG/JPG/WEBP (до 5 MB), локальное хранилище `backend/uploads/<userId>/<orgId>/...`, доступ только владельцу
- **Настройки печати:** чекбоксы (показывать логотип/печать/подпись/колонку бухгалтера/банковские реквизиты), кастомные тексты «Без НДС», условия оплаты, footer, индивидуальные note для каждого типа документа
- **Шаблоны договоров** (`/contract-templates`): CRUD, переменные `{{organization.fullName}}`, `{{counterparty.inn}}`, `{{contract.number}}`, `{{directorName}}` и др., live-предпросмотр рендера, подсветка missing/unknown переменных. Договор использует выбранный шаблон или поле `description` как fallback
- **HTML-предпросмотр** (`/preview` endpoint) для всех 6 типов документов — модалка с iframe; внутри кнопка «Скачать PDF»
- **Предупреждения перед генерацией** (`/print-warnings` endpoint): отсутствие ИНН / банковского счёта / адреса / руководителя / контрагента / позиций / включённой-но-не-загруженной печати или подписи. Не блокируют генерацию, отображаются над документом
- PT Sans с кириллицей, сумма прописью на русском, форматирование сумм с неразрывным пробелом
- Превью PDF прямо в браузере через `<iframe>` blob-URL

**Дашборд:** выручка за год/месяц, счета по статусам, топ должников, ближайшие платежи, истекающие договоры

**Роли и доступ (Sprint 9):**
- **OWNER** — полный доступ: настройки организации, члены, удаление, AI-провайдер, файлы (логотип/печать/подпись). Последнего OWNER нельзя удалить.
- **ADMIN** — может приглашать/удалять ACCOUNTANT/VIEWER, менять настройки организации и печатные формы, управлять AI и файлами. **Не может** удалить или демоушнуть OWNER.
- **ACCOUNTANT** — операционная работа: создание/редактирование документов, контрагентов, платежей, банковский импорт, AI-confirm. **Не может** менять настройки организации, файлы, AI-провайдера, приглашать членов.
- **VIEWER** — только чтение: документы, платежи, контрагенты, дашборд. **Не может** ничего создавать/менять.
- **Приглашения** (`/organizations/:id/members`): по email; если пользователь существует — мгновенно ACTIVE; если нет — INVITED, привязывается к userId при следующей регистрации с этим email. Без email-доставки в MVP.

**UX:** тёмная тема с сохранением в localStorage, серверные фильтры и сортировка таблиц, единый формат ошибок API

## Стек

- **Backend:** Node.js 20+ · Fastify 5 · Prisma 5 · PostgreSQL 16 · JWT · Zod · @react-pdf/renderer · exceljs · undici · TypeScript strict, ESM
- **Frontend:** Vite 6 · React 18 · TanStack Query · React Hook Form · Zod · React Router · Tailwind 3 + shadcn-style компоненты · sonner
- **Тесты:** Vitest + @testing-library/react (smoke); Fastify `app.inject()` для integration
- **Инфра:** Docker Compose (Postgres 16-alpine + pgAdmin)

## Запуск

Требования: Docker Desktop, Node.js 20+, npm 10+.

```bash
git clone https://github.com/dboybkru/buh-claude.git
cd buh-claude

# 1. PostgreSQL
docker compose up -d postgres

# 2. Зависимости backend + frontend
npm run install:all

# 3. .env (значения по умолчанию подходят для локалки)
cp backend/.env.example backend/.env

# 4. Миграции
npm run migrate

# 5. Демо-данные
npm run seed

# 6. Dev-серверы (backend:3001 + frontend:5173 параллельно)
npm run dev
```

После запуска:
- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001/api/v1
- **pgAdmin:** http://localhost:5050 (`admin@buhclaude.local` / `admin`, поднимается отдельно: `docker compose up -d pgadmin`)

### Тестовый логин

- **Email:** `test@buhclaude.local`
- **Пароль:** `superpass1`

## Проверки

```bash
# Backend
cd backend
npm run typecheck          # tsc --noEmit
npm run test:unit          # vitest unit (121 тест): validators/recalc/format/amount-to-words + contract-template/print-warnings/print-settings/uploads/html-preview + ai (schemas/action-plan/mock/prompt — 6A+6B+6C) + env (Sprint 7)
npm run test:integration   # vitest integration (110 тестов): auth/orgs/cps/invoices/payments/lock/bank-import/recon/files/contract-templates/print-warnings/stress-print + ai-flow + ai-sprint6b + ai-sprint6_1 + ai-sprint6c + ai-full-flow + health (Sprint 7)
npm test                   # unit + integration вместе
npm run build              # tsc -p tsconfig.json
npm run print:check        # Sprint 5.1: stress-рендер всех PDF/HTML в tmp/print-check/

# Frontend
cd frontend
npm run typecheck          # tsc --noEmit (project references)
npm test                   # vitest smoke (16 тестов): рендер 11 страниц + тёмная тема + PrintWarnings + HtmlPreviewDialog + AI pages
npm run build              # tsc -b && vite build

# Сразу всё из корня
npm run build              # backend + frontend production-сборка
```

### Test database

Integration-тесты используют **отдельную БД `buhclaude_test`**:

```bash
docker exec buhclaude-postgres psql -U buhclaude -d postgres -c "CREATE DATABASE buhclaude_test;"
DATABASE_URL="postgresql://buhclaude:buhclaude_secret@localhost:5432/buhclaude_test?schema=public" \
  npx prisma migrate deploy
```

После этого `npm run test:integration` будет работать. Тесты сами чистят таблицы через `TRUNCATE ... RESTART IDENTITY CASCADE` перед каждым кейсом.

## Ручной smoke-сценарий

После `npm run seed` зайти под `test@buhclaude.local` / `superpass1` и пройти полный цикл:

1. **Справочники → Мои организации** → ООО «Альфа» уже есть. Открыть, увидеть два банковских счёта.
2. **Справочники → Контрагенты** → создать нового, попробовать поиск по ИНН через DaData (если задан ключ).
3. **Справочники → Договоры** → открыть Д-001/2026 → внизу «Создать счёт».
4. На странице нового счёта добавить позиции → видеть live-пересчёт сумм → сохранить → получить автономер СЧ-NNNN/2026.
5. **Финансы → Платежи → Внести платёж** → выбрать созданный счёт, частичная сумма → счёт переходит в **PARTIALLY_PAID**.
6. Внести остаток → счёт **PAID**, появляется `paidAt`.
7. Создать ещё один счёт того же контрагента. Зайти в **Внести платёж**, переключить «Несколько счетов», нажать **«Распределить автоматически»**, указать сумму больше суммы счетов → видеть «Аванс» в нижней панели → сохранить.
8. Открыть СЧ-0001/2026 → кнопки «Акт» / «УПД» / «ТОРГ-12» — создаст наследник с теми же позициями.
9. **Контрагенты → клик по строке** → карточка контрагента: видеть **баланс** (выставлено / оплачено / аванс / долг / просрочено), список счетов с оплатой и остатком, список платежей с разнесением.
10. **Финансы → Акты сверки → Сформировать акт** → выбрать организацию, контрагента, период → видеть live-preview → сохранить.
11. На любом документе — «Превью» (PDF в модалке) или «Скачать PDF».
12. **Дашборд:** виджеты выручки, топ должников, ближайшие платежи; ниже — **калькулятор НДС для УСН 2026**.
13. **Помощник → Импорт:** скачать шаблон контрагентов, отредактировать, загрузить → dry-run → applied.
14. **Финансы → Импорт выписки:** загрузить `examples/bank-statements/sample-bank-statement.csv` → выбрать ООО «Альфа» → «Предпросмотр». В таблице должно появиться: строка 1 — `ready` со счётом СЧ-0001/2026 (если он есть); строка 2 — `needs_review` (аванс ООО Бета); строка 3 — `OUT` без allocations; строка 4 — `error` (битая сумма). Нажать «Импортировать выбранные» → отчёт: создано N, ошибок 0. Открыть Платежи / счёт / карточку контрагента / акт сверки — везде новые данные.
15. **Печатные формы (Sprint 5):**
    1. Справочники → Мои организации → открыть ООО «Альфа» → внизу «Реквизиты и печатные формы» → загрузить логотип, печать, подпись (PNG/JPG/WEBP до 5 MB).
    2. Внизу же — «Настройки печати»: включить **Логотип / Печать / Подпись**, заполнить «Подпись внизу всех документов» и «Примечание на счёте». Сохранить.
    3. Открыть существующий счёт СЧ-0001/2026 → видеть **жёлтый блок предупреждений** (например, «Подпись/печать не загружены» если что-то пропущено).
    4. Кнопка **«Превью»** — открывается HTML-предпросмотр в модалке с логотипом, печатью, подписью.
    5. **«Превью PDF»** — открывается PDF; **«Скачать PDF»** — скачать.
    6. Справочники → **Шаблоны договоров** → открыть «Договор оказания услуг (базовый)» → нажать «Предпросмотр рендера» → видеть подстановку реквизитов организации/договора.
    7. Справочники → Договоры → открыть Д-001/2026 → видеть выбранный «Шаблон» → нажать «Превью» / «PDF» договора — содержит подстановки.
16. В профиле (нижняя кнопка sidebar) — переключить **тёмную тему**.

## Скрипты в корневом `package.json`

```bash
npm run install:all    # установка зависимостей backend + frontend
npm run docker:up      # docker compose up -d
npm run docker:down    # docker compose down
npm run migrate        # prisma migrate dev в backend/
npm run seed           # засеять демо-данные
npm run dev            # backend + frontend параллельно (concurrently)
npm run build          # production-сборка обоих
```

## Импорт банковской выписки

**Где:** Финансы → Импорт выписки (`/bank-import`).

**Поддерживаемые форматы:** CSV (`;` или `,` разделитель, UTF-8, опциональный BOM) и XLSX. Образцы — в `examples/bank-statements/`.

**Распознаваемые колонки** (русский + английский, регистронезависимо):
- `Дата` / `date` / `Дата операции` / `Дата проводки`
- `Сумма` / `amount` (со знаком) **либо** отдельные `Приход` / `Расход` (`income` / `expense` / `Кредит` / `Дебет`)
- `Назначение платежа` / `purpose` / `description`
- `Контрагент` / `counterpartyName` / `Плательщик` / `Получатель`
- `ИНН` / `counterpartyInn`
- `Номер документа` / `reference` / `№ п/п`
- `Расчётный счёт` / `account`

**Как работает preview:**
1. Файл парсится → строки нормализуются (даты в `ГГГГ-ММ-ДД`, суммы как число, направление IN/OUT).
2. Для каждой строки backend ищет контрагента: сначала по ИНН (точное совпадение), потом по уникальному имени.
3. Для входящих платежей подбираются неоплаченные счета этого контрагента: сначала по номеру в назначении (`СЧ-0001/2026`, `№ 0001` и пр.), затем при единственном совпадении суммы — по остатку, иначе авторазнос FIFO по дате.
4. `confidence`: 0.95 — номер в назначении, 0.80 — точная сумма / единственный счёт, 0.60 — авторазнос. Ниже 0.7 → status `needs_review`.

**Что такое аванс:** если сумма платежа больше распределённой по счетам, остаток сохраняется на платеже как `unallocatedAmount` и виден на карточке контрагента в блоке «Баланс → Аванс». Не списывается автоматически на следующий счёт — оператор сам распределяет.

**Дубли:**
- Если в новом импорте найден `reference + date + amount + organizationId + direction` уже существующий — строка отклоняется с сообщением «Дубликат».
- Если `reference` пустой — fallback на `date + amount + purpose`.

**Атомарность строки:** одна строка применяется атомарно (Payment + Allocation в одной транзакции). Если одна строка падает с ошибкой — остальные строки этого импорта успешно создаются.

**Ограничения MVP:**
- Preview хранится в памяти процесса (TTL 30 минут). После перезапуска backend pending-превью теряется → нужно повторно загрузить файл и пройти preview.
- Маппинг колонок — базовый; парсер не подкалиброван под форматы конкретных банков (Сбер, Тинькофф, Альфа выгрузки могут потребовать ручного маппинга колонок в исходном файле).
- Прямая интеграция с API банков **не реализована** — только импорт файла выгрузки.

## AI assistant — full workflow (Sprint 6A + 6B + 6.1 + 6C + 6.2)

Полный AI workflow покрывает 7 безопасных действий:

| Action | Что делает | Read-only? |
|---|---|:-:|
| `create_counterparty` | Создаёт нового контрагента | — |
| `create_invoice` | Создаёт счёт с позициями (НДС: `no_vat / 0 / 10 / 20 / 22`) | — |
| `create_act_from_invoice` | Создаёт акт на основании существующего счёта (защита от дубля) | — |
| `create_contract` | Создаёт договор (auto-number, опц. templateId или default-template организации) | — |
| `analyze_debt` | Возвращает должников + просроченные суммы + рекомендации | ✓ |
| `create_payment` | Создаёт `Payment` через единый payments-service (IN с опц. allocations / OUT без allocations) | — |
| `suggest_payment_allocations` | Возвращает FIFO-предложение распределения суммы по неоплаченным счетам | ✓ |

**Безопасный flow:**

```
message → action plan (DRAFT) → preview → confirm → executor → audit log
```

AI **никогда не пишет в БД сам**. Любой запрос превращается в action plan со status `DRAFT`, который вы видите в чате и явно подтверждаете кнопкой «Подтвердить действия». Read-only actions (`analyze_debt`, `suggest_payment_allocations`) показывают результат, но НЕ пишут бизнес-данные. Audit log записывает все подтверждённые действия с targetId (или null для read-only).

**История AI-действий** доступна на странице `/ai` — последние 50 подтверждённых действий по выбранной организации, со ссылками на созданные сущности (контрагент / счёт / акт / договор / платёж). Кнопка «Обновить» обновляет список. `payloadJson` action НЕ возвращается наружу — только тип, цель и краткое сообщение пользователя.

**Подробный пошаговый smoke (31 шаг + 9 негативных сценариев):** [docs/ai-smoke-checklist.md](docs/ai-smoke-checklist.md).

### Что AI пока НЕ умеет (важно)

- **НЕ импортирует банковскую выписку** — bank-import работает только вручную через `/bank-import`. AI bank-import сознательно не реализован.
- **НЕ редактирует** и **НЕ удаляет** существующие документы / контрагентов / договоры / платежи (нет `update_*` / `delete_*` actions).
- **НЕ меняет** статусы документов или суммы существующих записей.
- **НЕ распределяет** платежи автоматически без подтверждения — только через явное `create_payment` с allocations или после ручного review результата `suggest_payment_allocations`.
- **НЕ даёт юридических или налоговых гарантий** — это инструмент-помощник.

Эти ограничения закреплены в `SYSTEM_PROMPT` и в whitelist `ALLOWED_ACTION_TYPES` (только 7 разрешённых типов).

---

## AI assistant — конфигурация (Sprint 6A)

Sprint 6A построил безопасную базу AI-помощника. AI **никогда не пишет в БД сам** — все действия проходят через двухступенчатый flow:

```
message → action plan (DRAFT) → preview → confirm → executor → audit log
```

### Что реализовано

- **Провайдеры** (`backend/src/lib/ai/providers/`):
  - **OpenAI-compatible** — один класс на все совместимые API (`/chat/completions`, `/models`).
  - **MockAIProvider** — детерминированный mock для dev/test без обращения в сеть. Понимает команды «создай контрагента ...» и «создай счёт ...», парсит ИНН и сумму, возвращает план с missingFields когда данных не хватает.
- **Поддерживаемые типы провайдеров** (UI presets в `/ai/settings`):

  | Provider | baseUrl | Примечание |
  |---|---|---|
  | OpenAI       | `https://api.openai.com/v1`        | прямой доступ, ключ `sk-...` |
  | VseGPT       | `https://api.vsegpt.ru/v1`         | российский прокси, оплата RUB |
  | AITunnel     | `https://api.aitunnel.ru/v1`       | российский прокси, оплата RUB |
  | Custom       | `https://api.example.com/v1`       | любой OpenAI-совместимый endpoint |
  | Local (Ollama) | `http://localhost:11434/v1`      | локальная модель (llama3, qwen и т.п.) |
  | Mock         | `mock://local`                     | dev/test без сети |
- **Хранение ключа**: AES-256-GCM, ключ деривируется от `JWT_SECRET`. На клиент возвращается только `maskedApiKey` (например `sk-•••••••abcd`).
- **JSON action-plan**: AI всегда возвращает один JSON-объект с полями `intent / summary / confidence / missingFields / warnings / actions[]`. Любые типы action кроме `create_counterparty` и `create_invoice` отклоняются на уровне валидатора.
- **Executor** в Sprint 6A+6B+6C поддерживает 7 действий:
  - `create_counterparty` — name + ИНН (+ опц. КПП/адрес/телефон/email);
  - `create_invoice` — date + items (`vatRate: "no_vat" | 0 | 10 | 20 | 22`);
  - `create_act_from_invoice` (Sprint 6B) — копирует позиции счёта в акт; защита от дубля (1 акт на счёт); cancelled счёт отклоняется;
  - `create_contract` (Sprint 6B) — создаёт договор с обязательным `subject`; auto-number `Д-NNN/YYYY`; опциональный `templateId` (проверяется owner); опциональный default-template организации, если задан;
  - `analyze_debt` (Sprint 6B) — **read-only** анализ задолженностей. Возвращает `totalDebt / overdueDebt / counterparties[] / recommendations[]`. Не пишет бизнес-данные.
  - `create_payment` (Sprint 6C) — создаёт `Payment` через существующий `payments-service.createPaymentInTx` (единая бизнес-логика). IN с опц. allocations; OUT без allocations (executor отклоняет). Все safety-проверки (ownership / переплата / cross-org / cancelled invoice) идут из payments-service.
  - `suggest_payment_allocations` (Sprint 6C) — **read-only** FIFO-предложение распределения суммы по неоплаченным счетам контрагента. Возвращает `allocatedAmount / advanceAmount / allocations[]` без записи в БД.
  - Каждое действие проверяет ownership organization / counterparty / invoice / template / bankAccount (нельзя писать в чужую организацию).
- **Audit log** (`AiAuditLog`) — каждое успешно применённое действие записывается с `actionType / targetType / targetId / payloadJson`.
- **TTL** action plan — 24 часа. Повторный confirm одного и того же plan возвращает 409.
- **Контекст-лоадер** (`lib/ai/context-loader.ts`): подгружает только данные текущего пользователя — организации, до 20 контрагентов, последние 20 счетов, неоплаченные счета, последние 20 платежей. `apiKey` и зашифрованные секреты НЕ передаются модели. Объём лимитирован.

### Endpoints

```
GET  /api/v1/ai/settings                            настройки (maskedApiKey)
PUT  /api/v1/ai/settings                            сохранить настройки
POST /api/v1/ai/test                                проверка соединения
POST /api/v1/ai/models                              список моделей провайдера
POST /api/v1/ai/chat                                сформировать DRAFT plan
POST /api/v1/ai/action-plans/:id/confirm            применить approved actions
```

### Почему AI не пишет в БД напрямую

- Любая ошибка модели (галлюцинация ИНН, неверный organizationId, неполный payload) превращается из необратимой записи в **видимый план**, который пользователь может отклонить.
- Подписи / номера / суммы / даты — AI не выдумывает их. Если их нет в контексте, попадают в `missingFields` и UI блокирует confirm.
- Все изменения проходят через `executor.ts` с явной валидацией ownership — даже подделанный JSON не сможет записать в чужую организацию.

### Ограничения Sprint 6A + 6B

- В executor поддерживаются **5 типов action** (см. список выше). Платежи / распределения / редактирование / удаление документов / bank-import AI — отсутствуют **сознательно** и отложены на следующие спринты.
- AI **НЕ умеет**:
  - создавать платежи (`Payment`) и разносить оплаты (`PaymentAllocation`);
  - импортировать банковскую выписку;
  - редактировать или удалять существующие счета / акты / договоры / контрагентов;
  - менять статусы документов или suммы;
  - менять `AiSettings` / `AiAuditLog` / какие-либо системные сущности.
- Качество AI-плана зависит от модели и провайдера. Mock-провайдер даёт детерминированные ответы только на простые шаблоны.
- AI не даёт юридических / налоговых гарантий — это инструмент-помощник.
- Внешние API могут быть недоступны (502, timeout, rate-limit) — настройки сохраняются, но `/chat` вернёт ошибку.

### Ручной smoke (Mock provider, без внешней сети)

Полный пошаговый чек-лист с позитивными и негативными сценариями: **[docs/ai-smoke-checklist.md](docs/ai-smoke-checklist.md)** (Sprint 6.1).

Кратко:

1. Открыть `/ai/settings` → выбрать «Mock (dev/test)» → Сохранить.
2. Нажать «Проверить подключение» — должно вернуть `ok`.
3. Открыть `/ai` → выбрать организацию (через выпадающий список вверху).
4. Отправить «**Создай контрагента ООО Ромашка ИНН 7701234567**» → action plan с `create_counterparty`, confidence ≈ 0.92 (badge «высокий»). Подтвердить.
5. Отправить «**Создай счёт за консультацию 10000 рублей без НДС**» → action plan с `create_invoice`, vatRate=`no_vat`. Подтвердить → счёт появится в **Документы → Счета**.
6. Отправить «**Создай акт по последнему счёту**» (Sprint 6B) → action plan с `create_act_from_invoice`. Подтвердить → акт появится в **Документы → Акты**. Повторная отправка вернёт ошибку «по счёту уже создан акт».
7. Отправить «**Создай договор на оказание консультационных услуг**» (Sprint 6B) → action plan с `create_contract`. Подтвердить → договор появится в **Справочники → Договоры** (auto-number `Д-NNN/2026`).
8. Отправить «**Покажи должников**» (Sprint 6B) → action plan с `analyze_debt`, бейдж **«Только анализ, данные не изменяются»**. Подтвердить → виден блок «Задолженность» с totalDebt / overdueDebt / списком должников / рекомендациями.
8.5. (Sprint 6C) Отправить «**Создай входящий платёж на 10000 по счёту**» → action plan с `create_payment`, IN, бейдж «Создаст платёж после подтверждения», в preview видны allocations. Подтвердить → платёж появится в **Финансы → Платежи**, счёт станет PAID/PARTIALLY_PAID.
8.6. (Sprint 6C) Отправить «**Распредели платёж 50000 по счетам контрагента**» → action plan с `suggest_payment_allocations` (read-only badge). Подтвердить → виден блок «Предложение распределения» с FIFO-разнесением и advance. Платежи в БД не создаются.
9. На странице `/ai` под чатом — блок **«История AI-действий»** (Sprint 6.1): последние 50 подтверждённых действий по выбранной организации, с ссылками на созданные сущности. Для `analyze_debt` targetId=null (read-only).
10. (опц.) Через API: `GET /api/v1/ai/audit-log?organizationId=<id>` — тот же список, только свои организации.

### Что AI пока НЕ умеет (важно)

- **НЕ** импортирует банковскую выписку (это делается вручную через `/bank-import`) — Sprint 6C сознательно не включил bank-import AI.
- **НЕ** редактирует и **НЕ** удаляет существующие документы / контрагентов / договоры / платежи (нет `update_*` / `delete_*` action).
- **НЕ** меняет статусы документов или суммы существующих записей.
- **НЕ** распределяет платежи автоматически — только через явное подтверждение `create_payment` с allocations или после ручного review результата `suggest_payment_allocations`.
- **НЕ** даёт юридических или налоговых гарантий — это инструмент-помощник.

Эти ограничения закреплены в SYSTEM_PROMPT и в whitelist `ALLOWED_ACTION_TYPES`. Если в одном из этих сценариев AI вернёт action — это бага.

### Что НЕ входит в Sprint 6A+6B (планируется отдельно)

- `create_payment`, `allocate_payment` — создание и разнесение оплат;
- `update_invoice` / `update_contract` / `cancel_*` — редактирование документов;
- AI-помощь в bank-import (автокатегоризация банковских транзакций);
- streaming response от провайдера;
- diff-view для предлагаемых изменений;
- multi-turn планы (последовательность связанных action в одном чате).

## Проверка печатных форм (Sprint 5.1)

Sprint 5.1 добавил скрипт `print:check` для stress-генерации всех PDF и HTML предпросмотров на специально подготовленной длинной фикстуре — для ручной визуальной проверки качества печатных форм без необходимости поднимать БД и кликать в UI.

```bash
cd backend
npm run print:check
```

Скрипт **не трогает БД**, рендерит 10 артефактов прямо в `tmp/print-check/` (папка в `.gitignore`):

| Файл | Что проверить глазами |
|---|---|
| `invoice-one-page.pdf` | компактный счёт на одну позицию: шапка, реквизиты, банк, подписи + печать |
| `invoice-many-items.pdf` | 17 позиций с длинными названиями: переносы по строкам, многостраничность, корректное продолжение шапки таблицы |
| `invoice-no-vat.pdf` | «Без НДС (НК РФ ст. 145)», корректная сумма прописью |
| `act.pdf` | смешанные ставки НДС (22% / 10% / 0%), период оказания услуг |
| `upd.pdf` | landscape A4, шапка УПД, реквизиты, дата отгрузки, paymentDocRef |
| `waybill.pdf` | ТОРГ-12 landscape, тип операции SALE, отпустил/получил |
| `contract.pdf` | многостраничный договор по шаблону, реквизиты сторон, подпись со штампом |
| `reconciliation.pdf` | акт сверки с 14 движениями: open/close сальдо, обороты |
| `invoice-preview.html` | HTML-предпросмотр счёта (data-URL изображений inline — открывается без backend) |
| `contract-preview.html` | HTML-предпросмотр договора с подстановками |

**Что смотреть:**
- кириллица не превратилась в `□□□` (PT Sans содержит всё нужное);
- кавычки `«»`, № и тире — присутствуют;
- сумма прописью корректна для разных ставок и сумм;
- логотип не растянут (objectFit: contain, 64×64);
- печать (rgba 180,30,30,200) не закрывает текст подписи (она с opacity 0.85 и position absolute right);
- если печать/подпись не загружены — sigImageBox схлопывается и не оставляет пустой 40pt-слот.

**Ограничения:**
- Логотип/печать/подпись в тестовом скрипте — мини-PNG'и (120×60 / 160×160 / 200×60, без альфа-канала на печати); реальные сканы из uploads могут иметь иные пропорции — это видно сразу.
- `@react-pdf/renderer` 4.x в node-среде корректно работает с изображениями только через `data:` URL — поэтому `pdf/map.ts:mapAssets` читает файл с диска и инлайнит base64 на каждый PDF. Для файлов до 5 MB (текущий лимит uploads) это не критично; для будущего S3-хранилища нужно вынести генерацию в воркер с кешированием.

## Production hardening (Sprint 7)

Sprint 7 подготовил проект к более реальной эксплуатации — без новых бизнес-фич, только устойчивость и диагностика. Операционный чек-лист (env, миграции, health, backup, restore, troubleshooting) собран отдельно: **[docs/production-runbook.md](docs/production-runbook.md)**.

### Env validation

`backend/src/lib/env.ts` строго валидирует переменные через Zod при старте. Полный список — см. `backend/.env.example`. Минимум обязательно:

| Переменная | Описание |
|---|---|
| `DATABASE_URL`     | PostgreSQL connection string |
| `JWT_SECRET`       | минимум **32 символа**; используется и для AES-256-GCM шифрования AI apiKey |
| `NODE_ENV`         | `development \| test \| production` |
| `PORT`             | дефолт 3001 |
| `CORS_ORIGIN`      | список разрешённых origin через запятую |
| `UPLOADS_DIR`      | путь к каталогу с логотипами / печатями / подписями |
| `LOG_LEVEL`        | `fatal \| error \| warn \| info \| debug \| trace \| silent` |

При невалидной конфигурации backend **не стартует** — выводит список ошибок без раскрытия фактических значений переменных.

### Health checks

| Endpoint | Что делает |
|---|---|
| `GET /api/v1/health` | публичный, без auth. Возвращает `status / version / uptimeSec / nodeEnv`. Подходит для liveness-проб. |
| `GET /api/v1/ready`  | публичный. Проверяет БД (`SELECT 1`) и доступ к `uploads/`. Возвращает 200 при ok, **503** при degraded. Подходит для readiness-проб K8s и Docker healthcheck. |

### Structured logging

- Каждому запросу присваивается `requestId` (UUID v4), доступен в заголовке `x-request-id`.
- В лог добавляются `userId` / `orgId` из JWT (если есть).
- Pino `redact` маскирует чувствительные поля: `authorization`, `cookie`, `x-api-key`, `apiKey`, `password`, `passwordHash`, `token`, `jwt`, `secret`.
- В production stack trace 500-ошибок остаётся только в server-side логах, клиенту возвращается сообщение «Внутренняя ошибка сервера».

### Backup / restore

Скрипты в `scripts/` для PowerShell и bash:

```powershell
# Windows / PowerShell (5.1 или pwsh 7+)
powershell -File scripts/backup-db.ps1                              # → backups/buhclaude-<timestamp>.dump
powershell -File scripts/restore-db.ps1 -File backups/<file>.dump   # ⚠ --clean удалит public.*

# По умолчанию restore в БД buhclaude. Для безопасного dry-run:
powershell -File scripts/restore-db.ps1 -File backups/<file>.dump -Database buhclaude_test
```

```bash
# Linux / macOS
./scripts/backup-db.sh
./scripts/restore-db.sh backups/buhclaude-2026-05-22_12-00-00.dump
```

Папка `backups/` и файлы `*.dump`, `*.sql.gz` исключены из git. **Никогда не коммитьте дампы.**

### Docker production profile (Sprint 8)

Полная stack-связка из четырёх сервисов (`postgres` + one-shot `migrate` + `backend` + `frontend` nginx) — пошаговый run в [docs/production-runbook.md §10](docs/production-runbook.md#10-production-like-docker-run-sprint-8).

```bash
# c чистого клона:
cp .env.production.example .env                          # → отредактировать POSTGRES_PASSWORD
cp backend/.env.production.example backend/.env          # → JWT_SECRET (openssl rand -hex 32) + CORS_ORIGIN
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# проверка (URL = http://localhost:${FRONTEND_PORT:-8080}):
./scripts/prod-smoke.sh                                  # bash / git-bash
powershell -File scripts/prod-smoke.ps1                  # Windows
```

Что внутри overlay:

- **`backend/Dockerfile`** — multi-stage Node 20 alpine, `prisma generate` + `tsc`, non-root `USER node`, tini для graceful SIGTERM, healthcheck по `/api/v1/health`. Образ ~250 MB. dev-deps в runtime stage отсутствуют.
- **`frontend/Dockerfile`** — Vite build → nginx:1.27-alpine со static SPA + reverse proxy `/api/*` → backend, SPA fallback `try_files /index.html`, gzip, security headers. Образ ~76 MB.
- **`migrate`** service — one-shot контейнер: `npx prisma migrate deploy`, выходит 0. Backend ждёт `service_completed_successfully` перед стартом. Никаких `db push` / автоматического `seed`.
- **`uploads_data`** — named volume для логотипов/печатей/подписей. Образ остаётся read-only по этому пути.
- **postgres** — без публичного порта (`ports: []`), доступен только из сети compose.

Секреты — из `backend/.env`. **Никогда не публикуйте вывод `docker compose config`** (он печатает env_file целиком).

### Frontend resilience

- **ErrorBoundary** (`frontend/src/components/ErrorBoundary.tsx`) ловит unhandled-исключения, показывает понятный fallback с кнопками «Перезагрузить» и «Попробовать снова». Технические детали — только в DEV.
- **Code splitting**: главный chunk сжался с **716 KB до 410 KB** (gzip 133 KB) — vite-warning исчез. Каждая страница в отдельном bundle, грузится по требованию через `React.lazy + Suspense`.

### Security review

Полный чек-лист — **[docs/security-checklist.md](docs/security-checklist.md)** (10 разделов, статус каждого пункта). Известные пробелы для production:

- ❌ rate-limit, CSP/helmet
- ❌ 2FA
- ❌ JWT_SECRET rotation plan
- ❌ audit log retention
- ⚠ encryption-at-rest для uploads (когда переедем на S3)

### Troubleshooting

| Симптом | Решение |
|---|---|
| Backend не стартует с ошибкой про env | См. вывод — выведено имя переменной и причина. Проверьте `backend/.env`. |
| `npm run test:integration` падает с `database "buhclaude_test" does not exist` | См. раздел «Test database» выше — создайте `buhclaude_test` и накатите миграции. |
| `print:check` молча генерит PDF без логотипа | Проверьте `pdf/map.ts:mapAssets` — должен возвращать `data:image/png;base64,...`, а не file path. См. Sprint 5.1 в `project-buhclaude-progress.md`. |
| Frontend bundle > 500 KB | Sprint 7 — проверьте `vite build` output. Главный chunk должен быть ~410 KB. Если больше — кто-то импортировал тяжёлую библиотеку синхронно в `App.tsx`. |
| `/api/v1/ready` возвращает 503 | Проверьте подключение к Postgres и существование `uploads/` каталога. |

## Соответствие нормативке РФ

| Документ | Норма |
|---|---|
| Первичные документы | 402-ФЗ ст. 9 |
| Счёт-фактура (УПД статус 1) | НК РФ ст. 169 |
| Форма УПД | Приказ ФНС России от 19.12.2018 № ММВ-7-15/820@ |
| ТОРГ-12 | Постановление Госкомстата от 25.12.1998 № 132, ОКУД 0330212 |
| Ставки НДС (с 01.01.2026) | НК РФ ст. 164 — 22% / 10% / 0% + УСН 5% и 7% (ФЗ от 28.11.2025 № 425-ФЗ) |
| Сроки хранения | НК РФ ст. 169.1 (4 года для счетов-фактур), 402-ФЗ (5 лет для первички) |
| Контрольные суммы ИНН/ОГРН | Алгоритм ФНС (веса и mod 11/13) |

## Known issues

- **PDF акта сверки:** символ `→` отсутствует в глифах PT Sans → заменён на тире `—`. Долгосрочно — embed-нуть NotoSans или Material Symbols (TODO в `pdf/templates/ReconciliationPdf.tsx`).
- **Откат статуса после удаления платежа:** PAID → DRAFT/OVERDUE (не SENT). Это требует хранения «предыдущего статуса» или явного состояния — не в MVP.
- **Распределение нераспределённых авансов:** при появлении нового счёта аванс автоматически на него **не** разносится — оператор сам распределяет через диалог платежа (это сознательно для прозрачности учёта).
- **Frontend chunk warning:** `dist/assets/index-*.js` > 500 KB (gzip 200 KB — допустимо для SPA). Будущее: code-splitting через `manualChunks`.
- **Локальное хранилище загруженных файлов (Sprint 5):** логотип/печать/подпись лежат в `backend/uploads/<userId>/<orgId>/...` на диске. Для self-hosted MVP этого достаточно, но при горизонтальном масштабировании или Docker volume-monting нужно вынести в S3-совместимое хранилище. Папка добавлена в `.gitignore`.
- **УПД и ТОРГ-12 — упрощённый MVP:** формы соблюдают приказ ФНС ММВ-7-15/820@ / постановление Госкомстата № 132 по составу полей, но **не являются строго гос. формами** для печати на бланках. Для отправки через ЭДО (Контур.Диадок / СБИС) нужна интеграция, которая пока не реализована.
- **QR-код для оплаты на счёте — TODO.** Чекбокс «Показывать QR-код оплаты» в настройках печати оставляет место на странице, но кодогенерация ещё не реализована (нужно генерить по СБП-стандарту ST00012).
- **DOCX-экспорт не реализован.** В Sprint 5 выбран HTML-preview как более лёгкий и универсальный путь (можно «Печать → Сохранить как PDF» из браузера для разовых исключений).
- **@react-pdf 4.x и Image src (Sprint 5.1):** библиотека в node-среде корректно загружает изображения только из `data:` URL — не из абсолютных путей и не из `file://`. Поэтому `mapAssets` читает файл с диска и инлайнит base64 в каждый PDF (`backend/src/pdf/map.ts`). На больших файлах (>5 MB) это создаст memory pressure — текущий лимит uploads 5 MB этого не допускает, но при будущем S3 нужно вынести рендеринг в воркер.
- **Бизнес-фичи в roadmap:** банковская выписка `1CClientBankExchange`, КУДиР + книги покупок/продаж, декларация НДС XML формата ФНС, ЭДО (Контур.Диадок / СБИС), e2e тесты Playwright.

## Лицензия

Private.
