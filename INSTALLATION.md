# Встановлення та запуск

Коротка інструкція з розгортання системи Monitor Production.

## Вимоги

- Docker і Docker Compose v2.
- Власний центр сертифікації (або `mkcert`/`openssl`) для HTTPS — камера на місці 4 працює лише по HTTPS.

## Розгортання

1. **Створити `.env`** з прикладу та задати реальні паролі:

   ```bash
   cp .env.example .env
   ```

2. **Створити сертифікати** у `certs/` (людина, не в репозиторії):

   ```bash
   mkdir certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem monitor.lan
   ```

   Серверний сертифікат має містити в SAN адресу, за якою заходять
   (краще ім'я `monitor.lan`, а не IP). Корінь ЦСК додається в довірені на
   комп'ютерах лінії (у Firefox ще `security.enterprise_roots.enabled = true`).

3. **Підняти стек**:

   ```bash
   docker compose up -d --build
   ```

4. Відкрити `https://monitor.lan/`.

## Доступ

| Шлях | Призначення | Автентифікація |
|------|-------------|----------------|
| `/` | вхід (номер місця / сервіс / адмінка) | — |
| `/station/?n=1..4` | екран робочого місця | — |
| `/service/` | сервісний режим | — |
| `/admin/` | адмінка (моделі, datasheet) | HTTP Basic (з `.env`) |

## Конфігурація

- **`.env`** — змінні середовища:
  - `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` — база даних;
  - `ADMIN_USER`, `ADMIN_PASSWORD` — логін/пароль адмінки (HTTP Basic);
  - `APP_TIMEZONE` — часовий пояс (за замовчуванням `Europe/Kyiv`).
- **`docker-compose.yml`** — сервіси `db`, `backend`, `nginx`; порти `80` (редирект) і `443`; том `pgdata` для даних БД.
- **`nginx/default.conf`** — `client_max_body_size 10m` (ліміт фото/datasheet), `uploads/` змонтовано лише на читання.
- **`backend/app/config.py`** — словник робочих місць, шляхи до `uploads/`, `MAX_FILE_SIZE`.

## База даних

- `db/init/*.sql` виконується **лише на порожньому томі** (перший запуск).
- Зміни схеми на вже працюючій БД — окремими скриптами в `db/migrations/`
  (`001_....sql`, …), застосовуються вручну.
- Демо-дані в `db/init/02_seed_demo.sql` — **прибрати до продакшну**.

## Бекапи

Робити одночасно:

```bash
docker compose exec db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
tar -czf uploads.tgz uploads/
```
