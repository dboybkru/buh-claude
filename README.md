# BuhClaude

Российская система управления документами и бухгалтерского учёта. Self-hosted, без облачных БД.

## Стек

- **Backend:** Node.js + Fastify + Prisma + PostgreSQL 16 + JWT
- **Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query
- **PDF:** @react-pdf/renderer (счета, акты, УПД, ТОРГ-12)
- **Инфраструктура:** Docker Compose (PostgreSQL + pgAdmin)

## Быстрый старт

```bash
# 1. Поднять БД
make docker-up           # или: docker compose up -d

# 2. Установить зависимости
make install             # или: npm run install:all

# 3. Скопировать .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 4. Применить миграции
make migrate

# 5. Заполнить тестовыми данными
make seed

# 6. Запустить dev-серверы
make dev                 # или: npm run dev
```

После запуска:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001/api/v1
- pgAdmin: http://localhost:5050

## Документы

Поддерживаются (с учётом законодательства РФ):

| Документ | Норма |
|---|---|
| Счёт на оплату | информационный, требует реквизиты сторон и банка |
| Акт выполненных работ | 402-ФЗ ст. 9 |
| УПД (универсальный передаточный документ) | НК РФ ст. 169 + приказ ФНС ММВ-7-15/820@ |
| Товарная накладная ТОРГ-12 | ОКУД 0330212 |

## Лицензия

Private.
