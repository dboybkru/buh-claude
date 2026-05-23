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
| `APP_ENCRYPTION_KEY` | `<openssl rand -base64 32>` | **Sprint 10:** отдельный ключ для шифрования секретов IntegrationSetting (DaData/AI/SMTP в админке). Опционален, fallback на `JWT_SECRET` — но в продакшене лучше задать явно. |

Сгенерировать `APP_ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

(PowerShell-вариант: `[Convert]::ToBase64String((1..32 | %{ Get-Random -Min 0 -Max 256 } -as [byte[]]))`)

> ⚠ **Никогда не коммитьте `backend/.env`.** Файл уже в `.gitignore`.
> `docker compose config` целиком распечатывает `env_file` в STDOUT — не публикуйте его вывод.

> ⚠ Ротация `APP_ENCRYPTION_KEY` инвалидирует все сохранённые секреты в `IntegrationSetting`. После ротации откройте `/admin/system` и заново введите DaData token / SMTP password / AI apiKey.

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

## 10. Production-like Docker run (Sprint 8)

Полный «с чистого клона до прохождения smoke» путь — без локальной установки
Node, только Docker и `git`. Все четыре сервиса (`postgres`, `migrate`,
`backend`, `frontend`) поднимаются из одного `docker compose`.

### 10.1. Клон + env

```bash
git clone https://github.com/dboybkru/buh-claude.git
cd buh-claude

# 1. Корневой .env (postgres credentials, host port для frontend)
cp .env.production.example .env
#    Открыть .env, заменить <REPLACE-WITH-STRONG-DB-PASSWORD>.

# 2. backend/.env (JWT_SECRET, CORS_ORIGIN, …)
cp backend/.env.production.example backend/.env
#    Сгенерировать JWT_SECRET:
openssl rand -hex 32
#    Вставить в backend/.env вместо <REPLACE-WITH-32-CHAR-RANDOM-SECRET>.
#    Поправить CORS_ORIGIN на реальный URL.
```

⚠ Никогда не публикуйте `.env` / `backend/.env`. `docker compose config`
печатает их в STDOUT — не выкладывайте этот вывод никуда.

### 10.2. Build образов

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
```

Первая сборка ~2-4 минуты (compile TS, prisma generate, vite build).
Повторные сборки ускоряются благодаря BuildKit cache.

### 10.3. Запуск

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Порядок старта (compose обеспечивает через `depends_on` + healthcheck):
1. `postgres` — поднимается с healthcheck `pg_isready`.
2. `migrate` — one-shot контейнер, делает `prisma migrate deploy` и выходит 0.
3. `backend` — стартует только после успешного `migrate` (`service_completed_successfully`).
4. `frontend` — стартует только после `backend healthy`.

### 10.3a. Membership after migration (Sprint 9)

Миграция `20260522220000_sprint9_organization_members` добавляет таблицу
`OrganizationMember` + два enum (`OrganizationRole`, `OrganizationMemberStatus`)
и **backfill**-ит OWNER для каждой существующей организации по полю
`Organization.userId`. После накатки убедитесь:

```sql
SELECT o.id, o.name, m.role, m.status
FROM "Organization" o
LEFT JOIN "OrganizationMember" m ON m."organizationId" = o.id AND m.role = 'OWNER' AND m.status = 'ACTIVE'
WHERE m.id IS NULL;
```

Запрос должен вернуть 0 строк. Если есть org без OWNER, восстановите:

```sql
INSERT INTO "OrganizationMember" (id, "organizationId", "userId", role, status, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), '<orgId>', '<userId>', 'OWNER', 'ACTIVE', NOW(), NOW());
```

### 10.3b. Promote platform admin (Sprint 9C/10)

Назначить пользователя платформенным админом (даёт implicit OWNER во всех
организациях + доступ к `/admin/system`):

```sql
UPDATE "User" SET role='ADMIN' WHERE email='<your-email>';
```

После повышения откройте `https://<your-domain>/admin/system` и настройте:

| Таб | Что | Когда нужно |
|---|---|---|
| **DaData** | token + secret + baseUrl | для autosuggest контрагентов / адресов |
| **AI Provider** | apiKey + baseUrl + defaultModel | system default; org-level `AiSettings` сохраняет приоритет |
| **SMTP** | host + port + username + password + fromEmail | будущая email-доставка приглашений (пока только настройки + test) |
| **App** | publicUrl + supportEmail + appName | метаданные платформы |

Тест-кнопки на каждом табе делают safe lightweight-запрос к настоящему сервису.

### 10.4. Опциональный seed демо-данных

В production обычно **не выполняется**. Если хотите наполнить чистую БД
демо-аккаунтом и образцами:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm --no-deps backend npx tsx prisma/seed.ts
```

`--no-deps` нужен, чтобы не дёргать migrate/postgres повторно. `--rm` удаляет
контейнер после выхода. Seed безопасно запускать **только один раз** — повторный
запуск упадёт на уникальном индексе `User.email`.

### 10.5. Health / ready

```bash
# через nginx (рекомендуемый production-путь):
curl -fsS http://localhost:${FRONTEND_PORT:-8080}/api/v1/health
curl -fsS http://localhost:${FRONTEND_PORT:-8080}/api/v1/ready

# если открыли порт backend наружу — напрямую:
curl -fsS http://localhost:3001/api/v1/health
```

Внутри compose backend всегда доступен по `http://backend:3001`. Nginx делает
`location /api/ → proxy_pass http://backend:3001`, поэтому одного публичного
порта frontend достаточно.

### 10.6. Прогон smoke

```bash
# bash / git-bash
FRONTEND_URL=http://localhost:8080 ./scripts/prod-smoke.sh
```

```powershell
# Windows PowerShell
powershell -File scripts\prod-smoke.ps1 -FrontendUrl http://localhost:8080
```

Скрипт читает только URL (никаких креденшалов), проверяет:
1. `GET /` → 200 + SPA shell с `<div id="root">`.
2. `GET /login` → 200 (SPA fallback, не 404).
3. `GET /api/v1/health` → 200, `status=ok`.
4. `GET /api/v1/ready` → 200, `database=ok`, `uploads=ok`.
5. `GET /api/v1/auth/me` без токена → 401, в теле **нет stack / секретов**.
6. Первый hashed `/assets/*.js` из shell отдаётся 200.

Любой провал отображается строкой `FAIL ...` и скрипт выходит с кодом 1.

### 10.7. Backup в проде

См. §7. Скрипты `backup-db.{sh,ps1}` уже совместимы с prod compose:
`docker exec` идёт в контейнер `buhclaude-postgres`, дамп пишется в
`backups/` на хосте. Папка в `.gitignore`.

```bash
./scripts/backup-db.sh
```

Cron / Windows Scheduled Task:
- ежедневно в 03:00 локального времени;
- ротация: 7 daily + 4 weekly + 12 monthly (можно через `tmpreaper` / `logrotate`);
- хранить дампы вне хоста БД (S3 / другой сервер).

### 10.8. Restore в test DB перед прод-restore

Реальный restore в production обычно делается **в копию**:

```bash
# 1. Создать целевую БД, если её нет.
docker exec buhclaude-postgres psql -U buhclaude -d postgres \
  -c "CREATE DATABASE buhclaude_test;"

# 2. Накатить миграции (если БД пустая).
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm --no-deps -e DATABASE_URL="postgresql://buhclaude:<DB_PASSWORD>@postgres:5432/buhclaude_test?schema=public" \
  migrate npx prisma migrate deploy

# 3. Restore в test DB (safe dry-run).
DB=buhclaude_test ./scripts/restore-db.sh backups/buhclaude-<timestamp>.dump

# 4. Проверить количество строк перед restore в боевую БД.
docker exec buhclaude-postgres psql -U buhclaude -d buhclaude_test \
  -c 'SELECT count(*) FROM "User";'
```

### 10.9. Stop / update / restart

```bash
# Остановить и сохранить volumes (данные БД и uploads).
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Обновить образы и перезапустить.
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Полное удаление, включая БД и uploads (⚠ необратимо).
docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v
```

`migrate` сервис перезапустится автоматически при `up -d --build` и накатит
любые новые миграции до старта backend.

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
| Порт занят: `Bind for 0.0.0.0:8080 failed: port is already allocated` | Сменить `FRONTEND_PORT` в `.env` или освободить порт (`docker ps`, `netstat -ano \| findstr 8080`). |
| `backend cannot connect to the database` | Чаще всего — `DATABASE_URL` указывает на `localhost` вместо `postgres` (внутри сети compose host = `postgres`). См. `backend/.env.production.example`. |
| `migrate` сервис падает с `P1001 / P3000` | БД ещё не готова. compose ждёт `service_healthy`, но если health-check timeout вышел — `docker compose logs migrate`, потом `up -d` ещё раз: команда идемпотентна. |
| `Cannot find module '@prisma/client'` в backend | Образ собран без `npx prisma generate`. Передобрать: `docker compose ... build --no-cache backend`. |
| `EACCES: permission denied, open '/app/uploads/...'` | Volume владелец не совпадает с `node` юзером в контейнере. Удалить volume `docker volume rm claude_uploads_data` (⚠ удаляет логотипы/печати) или вручную `docker exec -u root buhclaude-backend chown -R node:node /app/uploads`. |
| Frontend deep route 404 (`/payments` → nginx 404) | `nginx.conf` потерял `try_files $uri $uri/ /index.html`. Сравните с `frontend/nginx.conf` в репо. |
| Браузер не видит API: CORS preflight `OPTIONS /api/v1/...` 4xx | `CORS_ORIGIN` в `backend/.env` не содержит реальный origin фронта (включая `https://` и порт). Поправить и `docker compose restart backend`. |
| `docker compose ps` → backend `(unhealthy)` | `docker compose logs backend` → если zod-ошибка про env: см. строку выше. Если `database error` — postgres ещё не готов. Перезапустить через `docker compose restart backend`. |
| Бэкап-скрипт падает: `mkdir backups/ permission denied` | Запускаете изнутри docker volume или из read-only монтирования. Запускайте `./scripts/backup-db.sh` **на хосте**, не в контейнере. |

## 12. Checklist перед продом

- [ ] `JWT_SECRET` сгенерирован случайной строкой ≥ 32 символа, не дефолтный.
- [ ] `CORS_ORIGIN` указывает на реальный URL фронта.
- [ ] `NODE_ENV=production` в `backend/.env`.
- [ ] `POSTGRES_PASSWORD` в `.env` заменён на длинный случайный, не дефолтный `buhclaude_secret`.
- [ ] `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` без warning.
- [ ] `docker compose ... build` — backend и frontend образы собрались.
- [ ] `docker compose ... up -d` — все сервисы healthy через минуту.
- [ ] `scripts/prod-smoke.sh` (или `.ps1`) зелёный на live стеке.
- [ ] Сделан и проверен (restore в `buhclaude_test`) первый бэкап.
- [ ] Настроено cron-расписание backup с ротацией.
- [ ] `npm run typecheck`, `npm test`, `npm run print:check` зелёные.
- [ ] Пройден [security-checklist.md](security-checklist.md), включая раздел Docker/Deployment.
- [ ] Известные пробелы (rate-limit, CSP, 2FA) — решены или приняты как риск.
