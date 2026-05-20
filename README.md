# BuhClaude

Российская система управления документами и бухгалтерского учёта. Self-hosted, без облачных БД.
Поддерживает 402-ФЗ, НК РФ ст. 169, приказ ФНС ММВ-7-15/820@ (УПД), форму ТОРГ-12 (ОКУД 0330212).

## Возможности

- **Аутентификация:** регистрация, вход, JWT-сессии, защита роутов
- **Справочники:** мои организации (с банковскими счетами), контрагенты, номенклатура (товары/услуги/работы), договоры
- **Документы (4 типа):**
  - Счёт на оплату (Invoice)
  - Акт выполненных работ (Act)
  - Универсальный передаточный документ (УПД, статусы 1 и 2)
  - Товарная накладная ТОРГ-12 (Waybill)
- **Автонумерация:** сквозная по `(организация, тип документа, год)`, формат `СЧ-/АКТ-/УПД-/ТН-NNNN/YYYY`
- **Пересчёт сумм:** серверный, с decimal-точностью (half-even). НДС "включён" / "сверху", смешанные ставки 0/10/20/без НДС в одном документе
- **Блокировка по статусу:** документы в `SIGNED/ACCEPTED/PAID/CANCELLED` нельзя редактировать (402-ФЗ — только исправления)
- **PDF:** генерация на сервере через `@react-pdf/renderer` с шрифтом PT Sans (кириллица), "сумма прописью", все обязательные реквизиты
- **Превью PDF:** в браузере через `<iframe>` на blob URL
- **Экспорт:** CSV (UTF-8 BOM, разделитель `;` для Excel-RU) и XLSX (exceljs, форматирование, шапка, итоги)
- **Подсказки контрагента:** интеграция с DaData (заполнение по ИНН), опциональная
- **Дашборд:** выручка за год/месяц, счета по статусам, топ-контрагенты, просроченные счета, истекающие договоры
- **Валидация на клиенте и сервере:** контрольные суммы ИНН (10/12 цифр), ОГРН (13/15), регексы КПП/БИК/расчётного счёта

## Стек

- **Backend:** Node.js 24 + Fastify 5 + Prisma 5 + PostgreSQL 16 + JWT + bcrypt + Zod + `@react-pdf/renderer` + exceljs + undici, TypeScript strict, ESM
- **Frontend:** Vite 6 + React 18 + TypeScript + Tailwind 3 + shadcn/ui (вручную, 11 компонентов) + TanStack Query 5 + react-hook-form + Zod + react-router v6 + sonner
- **Инфраструктура:** Docker Compose (PostgreSQL 16-alpine + pgAdmin), миграции Prisma

## Структура репозитория

```
buh-claude/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # 13 моделей: User, Organization, Counterparty,
│   │   │                          # Contract, Nomenclature, Invoice, Act, UpdDocument,
│   │   │                          # Waybill, DocumentItem, BankAccount,
│   │   │                          # DocumentNumbering, UserSession
│   │   ├── migrations/            # init + add_document_numbering
│   │   └── seed.ts                # демо-данные
│   └── src/
│       ├── index.ts               # точка входа, graceful shutdown
│       ├── server.ts              # Fastify, CORS, JWT, регистрация роутов
│       ├── lib/                   # auth, prisma, env, recalc, numbering,
│       │                          # document-status, document-items, validators,
│       │                          # csv, dadata, http
│       ├── plugins/jwt.ts         # @fastify/jwt + decorator authenticate
│       ├── routes/                # 12 файлов: auth, organizations, bankAccounts,
│       │                          # counterparties, nomenclature, contracts,
│       │                          # invoices, acts, upds, waybills,
│       │                          # dadata, dashboard, export
│       └── pdf/                   # шрифты, шаблоны @react-pdf/renderer
│           ├── fonts/             # PTSans-Regular/Bold.ttf (OFL)
│           ├── lib/               # format, amount-to-words, styles
│           ├── templates/         # Invoice/Act/Upd/WaybillPdf.tsx + common
│           ├── fonts.ts           # Font.register
│           ├── render.ts          # renderToStream
│           ├── map.ts             # Prisma → Pdf props
│           └── filename.ts        # Content-Disposition (RFC 5987)
└── frontend/
    └── src/
        ├── App.tsx                # router + QueryClient + AuthProvider + Toaster
        ├── main.tsx               # точка входа
        ├── lib/                   # api, auth-context, format, utils,
        │                          # checksums, download, errors, hooks,
        │                          # documents-config
        ├── components/
        │   ├── ui/                # 11 shadcn-style: button, input, label, card,
        │   │                      # table, badge, dialog, select, textarea,
        │   │                      # separator, dropdown-menu
        │   ├── AppShell.tsx       # sidebar + outlet + dropdown профиля
        │   ├── ProtectedRoute.tsx # ждёт auth и редирект на /login
        │   ├── DataTable.tsx      # общая таблица с поиском/пагинацией
        │   ├── ItemsEditor.tsx    # редактор позиций с пересчётом
        │   └── PdfPreviewDialog.tsx
        └── pages/                 # Login, Register, Dashboard, Organizations,
                                   # Counterparties, Nomenclature, Contracts,
                                   # DocumentsList, DocumentEdit, Placeholder
```

## Быстрый старт

**Требования:** Docker Desktop, Node.js 20+ (рекомендовано 22 или 24), npm 10+.

```bash
# 1. Клонировать
git clone https://github.com/dboybkru/buh-claude.git
cd buh-claude

# 2. Поднять PostgreSQL и pgAdmin
docker compose up -d postgres

# 3. Установить зависимости (backend + frontend)
npm run install:all

# 4. Скопировать .env (значения по умолчанию подходят для локальной разработки)
cp backend/.env.example backend/.env
# при желании поменяйте JWT_SECRET и добавьте DADATA_API_KEY

# 5. Применить миграции БД
npm run migrate

# 6. Засеять демо-данные
npm run seed

# 7. Запустить dev-серверы (backend + frontend параллельно)
npm run dev
```

После запуска:

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001/api/v1
- **pgAdmin:** http://localhost:5050 — `admin@buhclaude.local` / `admin`

### Тестовые учётные данные

После `npm run seed` для входа в систему используйте:

- **Email:** `test@buhclaude.local`
- **Пароль:** `superpass1`

В БД после seed лежат: организация ООО «Альфа» (ИНН 7707083893) с двумя банковскими счетами, контрагенты ООО «Бета» и ИП Кузнецов А.И., 4 позиции номенклатуры, договор Д-001/2026, 2 счёта (один оплачен, один выставлен), акт, УПД и ТОРГ-12.

## Переменные окружения (`backend/.env`)

| Переменная | Назначение | Значение по умолчанию |
|---|---|---|
| `DATABASE_URL` | Строка подключения к Postgres | `postgresql://buhclaude:buhclaude_secret@localhost:5432/buhclaude?schema=public` |
| `NODE_ENV` | development / production | `development` |
| `PORT` | Порт API | `3001` |
| `HOST` | Bind-адрес | `0.0.0.0` |
| `CORS_ORIGIN` | Разрешённые origin-ы фронта (через запятую) | `http://localhost:5173` |
| `JWT_SECRET` | Секрет для подписи JWT (мин. 32 символа) | сгенерируется при init |
| `JWT_EXPIRES_IN` | Срок жизни токена | `7d` |
| `UPLOADS_DIR` | Директория для загрузок (зарезервировано) | `./uploads` |
| `MAX_UPLOAD_SIZE_MB` | Лимит размера файла | `10` |
| `DADATA_API_KEY` | Ключ DaData (опционально) | пустая строка → DaData-эндпойнты возвращают 503 |
| `DADATA_SECRET_KEY` | Секрет DaData (для серверных операций) | пусто |
| `LOG_LEVEL` | Уровень логов Pino | `info` |

## Доступные API-эндпойнты

Все защищены JWT, кроме `/auth/register`, `/auth/login`, `/health`.

- `GET /health`
- `POST /auth/register` · `POST /auth/login` · `GET /auth/me` · `POST /auth/logout`
- `GET/POST/PATCH/DELETE /organizations[/:id]`, `/.../bank-accounts[/:id]`
- `GET/POST/PATCH/DELETE /counterparties[/:id]`
- `GET/POST/PATCH/DELETE /nomenclature[/:id]`
- `GET/POST/PATCH/DELETE /contracts[/:id]`
- `GET/POST/PATCH/DELETE /invoices[/:id]` · `/acts` · `/upds` · `/waybills`
- `GET /:type/:id/pdf` — генерация PDF для документа (стрим)
- `GET /dadata/party/by-inn?inn=...` · `/party/suggest?query=...` · `/address/suggest?query=...`
- `GET /dashboard` — агрегированная статистика
- `GET /export/{invoices|acts|upds|waybills}.{csv|xlsx}` — экспорт списка

## Скрипты в корневом `package.json`

```bash
npm run install:all   # установить зависимости backend + frontend
npm run docker:up     # docker compose up -d
npm run docker:down   # docker compose down
npm run migrate       # prisma migrate dev в backend/
npm run seed          # засеять демо-данные
npm run dev           # запустить backend + frontend параллельно
npm run build         # собрать оба проекта в production
```

## Соответствие нормативке РФ

| Документ | Норма |
|---|---|
| Первичные документы (общие реквизиты) | Федеральный закон от 06.12.2011 № 402-ФЗ, ст. 9 |
| Счёт-фактура (УПД статус 1) | НК РФ ст. 169 |
| УПД (форма) | Приказ ФНС России от 19.12.2018 № ММВ-7-15/820@ |
| Товарная накладная ТОРГ-12 | Постановление Госкомстата России от 25.12.1998 № 132, ОКУД 0330212 |
| Ставки НДС | НК РФ ст. 164 (0% / 10% / 20% / без НДС) |
| Сроки хранения | НК РФ ст. 169.1 (счета-фактуры — 4 года), 402-ФЗ (первичные — 5 лет) |
| Контрольные суммы ИНН | Алгоритм ФНС, веса `[2,4,10,3,5,9,4,6,8,0]` для юрлица |
| Контрольные суммы ОГРН | 13 цифр — `mod 11`, 15 цифр (ОГРНИП) — `mod 13` |

## Известные ограничения

- Хранилище файлов (логотипы организаций, сканы) пока не используется (поля в схеме есть, UI — нет).
- Сортировка колонок в таблицах не реализована (только серверная сортировка `?sort=date:desc` по умолчанию).
- Тёмная тема не подключена (CSS-переменные есть в `index.css`).
- Подписи и печати в PDF не подгружаются как картинки (только текстовые подписи).
- DaData использует только публичный suggest API (для очистки данных нужен серверный токен).
- Юнит-тестов и e2e нет (проект сейчас полностью на ручной валидации через UI и curl).

## Лицензия

Private.
