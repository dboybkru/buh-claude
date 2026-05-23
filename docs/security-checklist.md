# BuhClaude — security checklist (Sprint 7)

Список проверок, которые должны быть включены в проекте на момент production-релиза. Используется как чек-лист при ревью PR и при подготовке нового деплоя.

Статусы: ✅ выполнено, ⚠ частично / требует внимания, ❌ не сделано.

---

## 1. Аутентификация и JWT

| # | Проверка | Статус | Где |
|---|---|---|---|
| 1.1 | JWT_SECRET минимум 32 символа, валидируется на старте | ✅ | `backend/src/lib/env.ts` |
| 1.2 | JWT хранится в `localStorage.buhclaude.token`, на 401 сбрасывается + redirect /login | ✅ | `frontend/src/lib/api.ts` |
| 1.3 | Все protected роуты регистрируются с `app.addHook("onRequest", app.authenticate)` | ✅ | каждый `routes/*.ts` |
| 1.4 | `request.user.sub` используется для фильтра в WHERE — изоляция пользователей | ✅ | все CRUD-роуты |
| 1.5 | bcrypt с 12 раундами для паролей | ✅ | `prisma/seed.ts`, auth-роуты |

## 2. Ownership и cross-organization isolation

| # | Проверка | Статус | Где |
|---|---|---|---|
| 2.1 | Каждый CRUD по сущности проверяет `userId: request.user.sub` | ✅ | все роуты |
| 2.2 | `validateAllocations` проверяет, что invoice принадлежит организации + контрагенту платежа | ✅ | `lib/payments-service.ts` |
| 2.3 | AI executor имеет `ensureOrganizationOwner` / `ensureCounterpartyOwner` перед записью | ✅ | `lib/ai/executor.ts` |
| 2.4 | Integration-тесты `ai-sprint6c.test.ts` проверяют отклонение чужого invoice / cp / bankAccount | ✅ | tests |

## 3. File uploads

| # | Проверка | Статус | Где |
|---|---|---|---|
| 3.1 | MIME-whitelist: PNG / JPEG / WEBP | ✅ | `lib/uploads.ts` |
| 3.2 | Лимит размера 5 MB через @fastify/multipart | ✅ | `routes/files.ts` |
| 3.3 | `resolveSafeAssetPath` блокирует path traversal через `..` | ✅ | `lib/uploads.ts:resolveSafeAssetPath` |
| 3.4 | GET `/api/v1/files/*` отдаёт файл только если путь начинается с `<userId>/` | ✅ | `routes/files.ts` |
| 3.5 | `uploads/` исключена из git через `.gitignore` | ✅ | `.gitignore:38` |
| 3.6 | Integration-тест: чужой user не может скачать файл | ✅ | `test/integration/files.test.ts` |

## 4. AI безопасность

| # | Проверка | Статус | Где |
|---|---|---|---|
| 4.1 | `AiSettings.apiKey` шифруется AES-256-GCM перед записью в БД | ✅ | `lib/crypto.ts` |
| 4.2 | На фронт возвращается только `maskedApiKey` (см. `serializeSettings`) | ✅ | `routes/ai.ts` |
| 4.3 | AI никогда не пишет бизнес-данные сам — только через явный `confirm` от пользователя | ✅ | `routes/ai.ts:/chat` сохраняет DRAFT, executor только после `/confirm` |
| 4.4 | Whitelist `ALLOWED_ACTION_TYPES` блокирует unknown action types | ✅ | `lib/ai/schemas.ts` + `parseActionPlan` |
| 4.5 | Repeat confirm одного plan → 409 (предотвращает дубль-выполнение) | ✅ | `routes/ai.ts` |
| 4.6 | Expired plan (TTL 24 ч) переводится в EXPIRED при попытке confirm | ✅ | `routes/ai.ts` |
| 4.7 | Unknown approvedActions id → HTTP 400 | ✅ | Sprint 6.1 fix |
| 4.8 | `payloadJson` audit log НЕ возвращается через GET `/audit-log` (минимизация утечек) | ✅ | `routes/ai.ts:/audit-log` |
| 4.9 | Audit log пишется ТОЛЬКО для успешно применённых actions (failed не пишет) | ✅ | `routes/ai.ts:/confirm` |
| 4.10 | Context-loader НЕ передаёт `apiKey` или зашифрованные секреты в модель | ✅ | `lib/ai/context-loader.ts` |

## 5. Bank import

| # | Проверка | Статус | Где |
|---|---|---|---|
| 5.1 | Preview хранится в памяти процесса с TTL 30 мин, изоляция по userId | ✅ | `lib/bank-import/store.ts` |
| 5.2 | confirm атомарен per-row — частичная ошибка не откатывает другие строки | ✅ | `routes/bank-import.ts` |
| 5.3 | Dup-detect по `reference+date+amount` или `date+amount+purpose` (fallback) | ✅ | `routes/bank-import.ts` |
| 5.4 | Integration-тесты cross-org: чужой invoice/importId/orga отклоняются | ✅ | `test/integration/bank-import.test.ts` |
| 5.5 | AI bank-import write-logic НЕ реализован — только ручной импорт через `/bank-import` | ✅ | сознательное ограничение Sprint 6C |

## 6. PDF / printing

| # | Проверка | Статус | Где |
|---|---|---|---|
| 6.1 | `mapAssets` использует `resolveSafeAssetPath` — нет path-traversal в src `<Image>` | ✅ | `pdf/map.ts` |
| 6.2 | HTML preview экранирует пользовательские данные (XSS-инъекция в наименовании позиции) | ✅ | `lib/html-preview.ts:esc` + unit-тест |
| 6.3 | Content-Disposition использует RFC 5987 `filename*=UTF-8''` для кириллицы | ✅ | `lib/http.ts:contentDisposition` |

## 7. CORS / network

| # | Проверка | Статус | Где |
|---|---|---|---|
| 7.1 | CORS_ORIGIN whitelist через `env.CORS_ORIGIN.split(",")` — нет `*` | ✅ | `server.ts` |
| 7.2 | `credentials: true` только при явно заданном origin | ✅ | `server.ts` |
| 7.3 | В production не отдавать stack trace и raw err.message при 500 | ✅ | Sprint 7 fix в `setErrorHandler` |

## 8. Logging / диагностика

| # | Проверка | Статус | Где |
|---|---|---|---|
| 8.1 | pino redact для `authorization / cookie / x-api-key / apiKey / password / token / secret / passwordHash` | ✅ | Sprint 7 в `server.ts` |
| 8.2 | requestId в каждом логе (через `genReqId: crypto.randomUUID`) | ✅ | Sprint 7 в `server.ts` |
| 8.3 | userId / orgId в child logger при наличии JWT | ✅ | Sprint 7 в `server.ts` |
| 8.4 | 500-ошибки логируются с stack только server-side, не клиенту | ✅ | `setErrorHandler` |

## 9. Backups

| # | Проверка | Статус | Где |
|---|---|---|---|
| 9.1 | Скрипты `backup-db.{ps1,sh}` и `restore-db.{ps1,sh}` | ✅ | `scripts/` |
| 9.2 | Папка `backups/` в `.gitignore` — реальные дампы не коммитятся | ✅ | `.gitignore` |
| 9.3 | pg_dump через docker exec (нет SSH к контейнеру) | ✅ | scripts |
| 9.4 | Бэкапы должны храниться вне репозитория и быть зашифрованы при передаче | ⚠ | оператор-зависимо, см. README §«Production hardening» |

## 10. Frontend

| # | Проверка | Статус | Где |
|---|---|---|---|
| 10.1 | Глобальный ErrorBoundary не даёт упасть всей странице | ✅ | Sprint 7 в `App.tsx` |
| 10.2 | Stack trace в ErrorBoundary показывается ТОЛЬКО в DEV (`import.meta.env.DEV`) | ✅ | `ErrorBoundary.tsx` |
| 10.3 | Code splitting через `React.lazy` — главный chunk ~410 KB (с 716 KB) | ✅ | Sprint 7 в `App.tsx` |

## 11. RBAC / membership (Sprint 9)

| # | Проверка | Статус | Где |
|---|---|---|---|
| 11.1 | Каждая организация имеет минимум одного ACTIVE OWNER (backfill для existing) | ✅ | `prisma/migrations/20260522220000_sprint9_organization_members` |
| 11.2 | Создатель организации авто-получает OWNER membership (в одной транзакции с create) | ✅ | `routes/organizations.ts` |
| 11.3 | Last-owner guard: PATCH/DELETE не могут оставить org без активного OWNER | ✅ | `routes/members.ts:activeOwnerCount` |
| 11.4 | ADMIN не может назначить OWNER / демоушнуть OWNER / удалить OWNER | ✅ | `canManageMember`, `canInviteRole` |
| 11.5 | ACCOUNTANT / VIEWER не могут приглашать / управлять членами | ✅ | `permissions.ts:PERMISSION_MIN_ROLE.members:*` |
| 11.6 | VIEWER не может писать данные (data:write), создавать платежи, импортировать банк, подтверждать AI | ✅ | permission matrix |
| 11.7 | Cross-org access возвращает 404 (privacy obfuscation), не 403 | ✅ | `org-access.ts:requireOrgAccess` |
| 11.8 | INVITED row автоматически принимается при register/login с тем же email | ✅ | `routes/auth.ts:claimInvitations` |
| 11.9 | Files upload/delete требует ADMIN+; download для любого ACTIVE member | ✅ | `routes/files.ts` |
| 11.10 | AI settings требует ADMIN+; chat/confirm требуют ACCOUNTANT+ | ✅ | `routes/ai.ts:assertCanSettings` |
| 11.11 | Bank import требует ACCOUNTANT+ | ✅ | `routes/bank-import.ts` |
| 11.12 | Permission unit-tests покрывают всю матрицу (OWNER > ADMIN > ACCOUNTANT > VIEWER) | ✅ | `lib/permissions.test.ts` |
| 11.13 | Integration-тесты проверяют: invite, last-owner, ADMIN не демоушит OWNER, VIEWER не пишет invoice/files | ✅ | `test/integration/members.test.ts` |
| 11.14 | Email delivery для приглашений | ❌ | TODO — пока MVP claims invite при логине |
| 11.15 | Row-level audit для каждой write-операции (кто менял что) | ❌ | TODO — только AI-actions покрыты |
| 11.16 | Counterparty / Nomenclature / ContractTemplate без orgId column — переходный compromise (filter by accessibleUserIds) | ⚠ | будущая миграция должна добавить orgId на справочники |
| 11.17 | Sprint 9A debt: `acts`, `upds`, `waybills`, `contracts`, `reconciliations`, `contract-templates` ещё используют `userId` filter и не переведены на `requireOrgAccess` + permission gates | ⚠ | Sprint 9B — мигрировать эти routes на полноценный RBAC |

## 12. Docker / deployment (Sprint 8)

| # | Проверка | Статус | Где |
|---|---|---|---|
| 11.1 | `backend/.dockerignore` исключает `.env`, `.env.*` (с allow для `.env.example`) — секреты не попадают в image | ✅ | `backend/.dockerignore` |
| 11.2 | `frontend/.dockerignore` исключает `.env`, `node_modules`, тесты | ✅ | `frontend/.dockerignore` |
| 11.3 | Backend контейнер запускается под `USER node` (uid 1000), не root | ✅ | `backend/Dockerfile` |
| 11.4 | `tini` форвардит SIGTERM в node — graceful shutdown через `app.close()` | ✅ | `backend/Dockerfile` ENTRYPOINT |
| 11.5 | Backend healthcheck по `/api/v1/health` (no auth, не раскрывает секреты) | ✅ | `backend/Dockerfile` HEALTHCHECK |
| 11.6 | Frontend healthcheck по `/` (только liveness, без auth) | ✅ | `frontend/Dockerfile` |
| 11.7 | `postgres` в prod overlay БЕЗ публичного порта (`ports: []`) | ✅ | `docker-compose.prod.yml` |
| 11.8 | `uploads_data` — named volume, **не внутри image** (отделено от перезапуска) | ✅ | `docker-compose.prod.yml` volumes |
| 11.9 | nginx: `server_tokens off`, `autoindex off`, deny `/\.` (запрет на dotfiles) | ✅ | `frontend/nginx.conf` |
| 11.10 | nginx security headers: `X-Content-Type-Options nosniff`, `X-Frame-Options SAMEORIGIN`, `Referrer-Policy strict-origin-when-cross-origin` | ✅ | `frontend/nginx.conf` |
| 11.11 | nginx SPA fallback `try_files $uri $uri/ /index.html` — последний `location /` | ✅ | `frontend/nginx.conf` |
| 11.12 | Migrations one-shot service (`migrate`) с `restart: "no"` — НЕ выполняет `seed` и `db push` автоматически | ✅ | `docker-compose.prod.yml` |
| 11.13 | `backend/.env.production.example` явно требует замены `JWT_SECRET` и `CORS_ORIGIN` (no wildcard) | ✅ | `backend/.env.production.example` |
| 11.14 | `.env.production.example` явно требует замены `POSTGRES_PASSWORD` | ✅ | `.env.production.example` |
| 11.15 | `prod-smoke` script проверяет что unauthenticated `/api/v1/auth/me` → 401 БЕЗ stack/секретов в теле | ✅ | `scripts/prod-smoke.{sh,ps1}` |
| 11.16 | CSP headers через `@fastify/helmet` или nginx CSP | ❌ | TODO для public deploy |
| 11.17 | Rate-limit (`@fastify/rate-limit`) | ❌ | TODO для public deploy |
| 11.18 | Secrets через secret-manager (HashiCorp Vault / AWS SSM / docker secrets), не `.env` файл | ⚠ | для self-hosted MVP `backend/.env` приемлемо; для public — переехать |
| 11.19 | TLS / HTTPS перед nginx (через cloudflare / traefik / caddy) | ⚠ | контейнер слушает 80, TLS терминируется снаружи. Документировать в deploy guide. |

---

## Что НЕ покрыто (явные TODO для production)

- ❌ **Rate limiting** (например `@fastify/rate-limit`) — добавить перед публичным деплоем.
- ❌ **CSP headers** через `@fastify/helmet` — добавить.
- ❌ **Webhook-сигнатуры** для внешних интеграций — пока их нет.
- ❌ **2FA / TOTP** для пользователей — отложено.
- ❌ **Audit log retention policy** — таблица растёт безусловно, нет ротации.
- ❌ **Encryption-at-rest для uploads** — файлы лежат в plain. Для production — рассмотреть S3 + SSE-S3.
- ⚠ **JWT_SECRET rotation** — текущая архитектура завязывает rotation на инвалидацию всех сессий и потерю расшифровки старых AiSettings.apiKey. Нужен план миграции (key versioning).

Если перед публичным деплоем находите багу из этого списка — фиксите её отдельным PR с тегом `security`.
