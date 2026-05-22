# BuhClaude — production runbook

Чек-лист реальных операций для эксплуатации BuhClaude: первый запуск, миграции,
health-checks, бэкапы, восстановление, типовой troubleshooting.

Все команды проверены на Windows 11 + Docker Desktop 29.x + Node 20+ из
`D:\git\buh\Claude` (git-bash и Windows PowerShell 5.1). Где нужны Linux/macOS
варианты — приводятся через `scripts/*.sh`.

> Это операционный runbook. Архитектура и фичи — в [README](../README.md).
> Безопасность — в [docs/security-checklist.md](security-checklist.md).

---

## 1. Prerequisites

| Требование | Версия | Проверка |
|---|---|---|
| Docker Desktop | 24+ | `docker --version`, `docker compose version` |
| Node.js | 20+ | `node --version` |
| npm | 10+ | `npm --version` |
| Свободное место | ~2 GB | для node_modules + образа postgres + бэкапов |
| Порты | 3001 (backend), 5173 (frontend dev), 5432 (postgres) | должны быть свободны |

**Windows:** Docker Desktop с WSL2 backend. Git-bash или PowerShell 5.1/7+.

## 2. .env setup

```bash
cp backend/.env.example backend/.env
```

Минимально надо проверить / поправить:

| Переменная | Значение для локалки | Примечание |
|---|---|---|
| `DATABASE_URL` | `postgresql://buhclaude:buhclaude_secret@localhost:5432/buhclaude?schema=public` | host = `localhost` для dev, `postgres` для docker-compose backend |
| `JWT_SECRET` | случайные **≥ 32 символа** | используется и как ключ AES-256-GCM для AI apiKey — менять → инвалидирует сессии и ai-секреты |
| `NODE_ENV` | `development` | `production` для боевого |
| `CORS_ORIGIN` | `http://localhost:5173` | для prod — реальный URL фронта |
| `UPLOADS_DIR` | `./uploads` | в docker-compose маппится на volume |

> ⚠ **Никогда не коммитьте `backend/.env`.** Файл уже в `.gitignore`.
> `docker compose config` целиком распечатывает `env_file` в STDOUT — не публикуйте его вывод.

## 3. First run (dev)

```bash
# 1. Postgres
docker compose up -d postgres

# 2. Зависимости
npm run install:all

# 3. .env
cp backend/.env.example backend/.env       # отредактируйте JWT_SECRET

# 4. Миграции
npm run migrate                            # prisma migrate dev в backend/

# 5. Демо-данные (опционально)
npm run seed                               # test@buhclaude.local / superpass1

# 6. Dev-серверы
npm run dev                                # backend:3001 + frontend:5173
```

## 4. Migrations

**Dev (interactive — создаёт миграцию из изменений schema.prisma):**
```bash
cd backend && npx prisma migrate dev
```

**Production / накат уже существующих:**
```bash
cd backend && npx prisma migrate deploy
```

**Test DB** (для `npm run test:integration` нужна отдельная БД):
```bash
docker exec buhclaude-postgres psql -U buhclaude -d postgres \
  -c "CREATE DATABASE buhclaude_test;"
DATABASE_URL="postgresql://buhclaude:buhclaude_secret@localhost:5432/buhclaude_test?schema=public" \
  npx prisma migrate deploy
```

## 5. Seed

```bash
npm run seed
```

Создаёт: `test@buhclaude.local / superpass1`, ООО «Альфа», 2 контрагента,
4 номенклатуры, договор Д-001/2026 + 5 документов 2026 года.

Для production seed обычно не запускают — реальные данные вводятся вручную или
импортируются (см. README, раздел «Импорт банковской выписки»).

## 6. Health checks

| Endpoint | Auth | Ответ ok | Что проверяет |
|---|---|---|---|
| `GET /api/v1/health` | публичный | 200 + `{status:"ok", service, version, uptimeSec, nodeEnv, timestamp}` | процесс жив (liveness) |
| `GET /api/v1/ready` | публичный | 200 + `{checks:{database:"ok", uploads:"ok"}}` или **503** при degraded | БД (`SELECT 1`) и доступ к `uploads/` (readiness) |

```bash
# bash / git-bash
curl -fsS http://localhost:3001/api/v1/health
curl -fsS http://localhost:3001/api/v1/ready
```

```powershell
# Windows PowerShell
Invoke-RestMethod -Uri http://localhost:3001/api/v1/health
Invoke-RestMethod -Uri http://localhost:3001/api/v1/ready
```

Эндпоинты **не раскрывают секретов** — только статус, версия и имена под-чеков.
Используются Docker healthcheck-ом в `docker-compose.prod.yml` и подходят для
readiness/liveness K8s.

## 7. Backup

**Linux / macOS / git-bash:**
```bash
./scripts/backup-db.sh                          # → backups/buhclaude-<timestamp>.dump
DB=buhclaude_test ./scripts/backup-db.sh        # другая БД
OUT_DIR=/var/backups ./scripts/backup-db.sh     # другая папка
```

**Windows PowerShell (5.1 или pwsh 7+):**
```powershell
powershell -File scripts/backup-db.ps1
powershell -File scripts/backup-db.ps1 -Database buhclaude_test
powershell -File scripts/backup-db.ps1 -OutDir D:\bk
```

Формат: `pg_dump -Fc --no-owner --no-acl` (custom binary). Восстанавливается
через `pg_restore`. Папка `backups/` и файлы `*.dump`/`*.sql.gz` исключены
из git. **Никогда не коммитьте дампы — они содержат все пользовательские данные.**

Для регулярных бэкапов используйте cron / Windows Scheduled Task с ротацией
(например, хранить 7 дневных + 4 недельных + 12 месячных).

## 8. Restore

> ⚠ **`--clean --if-exists` удаляет существующие public.* объекты в целевой БД.**
> Перед restore в продакшен — **сделайте свежий бэкап** и проверьте имя `-Database`.
> Для тренировки восстановления — используйте `buhclaude_test`.

**Linux / macOS / git-bash:**
```bash
./scripts/restore-db.sh backups/buhclaude-<timestamp>.dump
DB=buhclaude_test ./scripts/restore-db.sh backups/<file>.dump   # безопасный dry-run
```

**Windows PowerShell:**
```powershell
powershell -File scripts/restore-db.ps1 -File backups/<file>.dump
powershell -File scripts/restore-db.ps1 -File backups/<file>.dump -Database buhclaude_test
```

После restore проверьте, что данные читаются:
```bash
docker exec buhclaude-postgres psql -U buhclaude -d <db> -c 'SELECT count(*) FROM "User";'
```

Все скрипты используют `docker cp` + `pg_restore` внутри контейнера, чтобы
обойти binary-pipe проблемы PowerShell / git-bash MSYS.

## 9. Print check

Stress-рендер всех 8 PDF + 2 HTML предпросмотров без подъёма БД:
```bash
cd backend && npm run print:check
```

Артефакты появятся в `tmp/print-check/` (папка в `.gitignore`). Смотрите
README раздел «Проверка печатных форм» — что глазами проверять.

## 10. Docker production overlay

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config   # синтаксис
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Что меняет `docker-compose.prod.yml` по сравнению с базовым:

- `backend` сервис c build из `./backend/Dockerfile`, healthcheck по `/api/v1/ready`, restart `always`, volume для uploads;
- `postgres` без публичного порта (`ports: []`) — доступен только из docker network;
- pgadmin **не запускается** в prod (запускайте только при необходимости через `docker compose up -d pgadmin`).

⚠ **`backend/Dockerfile` пока не добавлен.** Когда будете деплоить — добавьте
multi-stage Node 20-alpine + `prisma generate` + `tsc`. Без него `compose up`
для backend упадёт на build.

## 11. Troubleshooting

| Симптом | Причина / решение |
|---|---|
| `failed to connect to the docker API ... daemon` | Docker Desktop не запущен. Старт: открыть Docker Desktop вручную, дождаться `whale` в трее. |
| `psql: could not connect ... refused` | Postgres-контейнер не поднят. `docker compose up -d postgres`. Проверить: `docker ps`. |
| `database "buhclaude_test" does not exist` при `npm run test:integration` | Создать test DB и накатить миграции — см. §4. |
| Backend падает на старте с zod-ошибкой про env | `JWT_SECRET` короче 32 символов или нет `DATABASE_URL`. Проверьте `backend/.env`. Имя переменной в ошибке указано, само значение **не** выводится. |
| `pg_restore: ... Segmentation fault` или мусорный dump | Если использовали `docker exec -t pg_dump` (без `-i`) — TTY-режим портит binary stdout. Скрипты в репо это исправили (используют `docker cp`). Если делаете руками — `docker exec` без `-t`. |
| `/api/v1/ready` → 503 | Один из checks упал. См. поле `checks` в ответе: `database:"error"` — Postgres недоступен; `uploads:"error"` — `UPLOADS_DIR` не существует / нет прав. Создать: `mkdir -p backend/uploads`. |
| `CORS` ошибки в браузере | `CORS_ORIGIN` в `backend/.env` не совпадает с реальным URL фронта. Можно указать несколько через запятую. |
| Frontend bundle > 500 KB warning | Главный chunk должен быть ~410 KB (gzip ~133 KB). Если больше — кто-то импортировал тяжёлую библиотеку синхронно в `App.tsx`. Используйте `React.lazy` для страниц. |
| PS-скрипты падают с `parse error` / странной кодировкой | На Windows PowerShell 5.1 убедитесь что `*.ps1` сохранены с UTF-8 BOM (текущие в репо — да). Альтернатива: установить PowerShell 7 (`winget install Microsoft.PowerShell`) и запускать через `pwsh`. |
| `MSYS_NO_PATHCONV` warning в git-bash при работе с `docker cp` | Git-bash на Windows конвертирует `/tmp/...` в `C:/Users/...`. Все скрипты в репо уже учитывают это. При ручных командах — префиксуйте: `MSYS_NO_PATHCONV=1 docker cp ...`. |

## 12. Checklist перед продом

- [ ] `JWT_SECRET` сгенерирован случайной строкой ≥ 32 символа, не дефолтный.
- [ ] `CORS_ORIGIN` указывает на реальный URL фронта.
- [ ] `NODE_ENV=production` в `backend/.env`.
- [ ] `backend/Dockerfile` добавлен и проходит `docker build`.
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` без warning.
- [ ] `/api/v1/health` и `/api/v1/ready` отвечают 200.
- [ ] Сделан и проверен (restore в `buhclaude_test`) первый бэкап.
- [ ] Настроено cron-расписание backup с ротацией.
- [ ] `npm run typecheck`, `npm test`, `npm run print:check` зелёные.
- [ ] Пройден [security-checklist.md](security-checklist.md).
- [ ] Известные пробелы (rate-limit, CSP, 2FA) — решены или приняты как риск.
