# Advanced Marketing — Client Portal Stack

.PHONY: build up down logs api-logs frontend-logs shell

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

api-logs:
	docker compose logs -f portal-api

frontend-logs:
	docker compose logs -f portal

shell:
	docker compose exec portal-api sh
