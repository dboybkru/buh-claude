.PHONY: help install docker-up docker-down docker-logs migrate migrate-prod seed dev build clean reset

help:
	@echo "BuhClaude — команды разработки"
	@echo ""
	@echo "  make install       Установить зависимости backend + frontend"
	@echo "  make docker-up     Поднять PostgreSQL + pgAdmin"
	@echo "  make docker-down   Остановить контейнеры"
	@echo "  make docker-logs   Логи Postgres"
	@echo "  make migrate       Применить миграции Prisma (dev)"
	@echo "  make migrate-prod  Применить миграции (production)"
	@echo "  make seed          Заполнить БД тестовыми данными"
	@echo "  make dev           Запустить backend + frontend одновременно"
	@echo "  make build         Собрать production-сборки"
	@echo "  make reset         Сбросить БД (drop + migrate + seed)"
	@echo "  make clean         Удалить node_modules и dist"

install:
	cd backend && npm install
	cd frontend && npm install

docker-up:
	docker compose up -d
	@echo "Postgres: localhost:5432  |  pgAdmin: http://localhost:5050"

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f postgres

migrate:
	cd backend && npx prisma migrate dev

migrate-prod:
	cd backend && npx prisma migrate deploy

seed:
	cd backend && npx tsx prisma/seed.ts

dev:
	npm run dev

build:
	cd backend && npm run build
	cd frontend && npm run build

reset:
	cd backend && npx prisma migrate reset --force
	cd backend && npx tsx prisma/seed.ts

clean:
	rm -rf backend/node_modules backend/dist
	rm -rf frontend/node_modules frontend/dist
	rm -rf node_modules
