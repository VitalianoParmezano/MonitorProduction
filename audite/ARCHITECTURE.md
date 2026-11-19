# ARCHITECTURE — Monitor Production

## Загальна схема

Три Docker-сервіси, одна внутрішня мережа, єдина точка входу — Nginx на порту 80.

```
[ Клієнт: браузер оператора / адміна / моніторингу ]
        │  HTTP :80
        ▼
[ nginx ] ── статика (frontend/) ─────────────► браузеру
    │  /api/*   → proxy → [ backend:8000 ]
    │  /uploads/* → alias → [ ./uploads ] (ro)
    │
[ backend:8000 ] ── SQL ──► [ db (PostgreSQL 16) :5432 ]
    │
    └── пише файли в ./uploads (rw)
```

- `db` — PostgreSQL 16, том `./pgdata`, init-скрипти з `./db/init`.
- `backend` — FastAPI (Uvicorn) на порту 8000, том `./uploads` на запис.
- `nginx` — статика `./frontend` і конфіг `./nginx/default.conf` монтуються read-only,
  `./uploads` — read-only.

Всі три сервіси в мережі Docker Compose за замовчуванням; ззовні відкрито лише порт 80.

## Сервіси та волюми (docker-compose.yml)

| Сервіс | Образ | Змінні оточення | Волюми |
| :--- | :--- | :--- | :--- |
| `db` | postgres:16 | `POSTGRES_DB/USER/PASSWORD` | `./pgdata`, `./db/init` (ro) |
| `backend` | збірка `./backend` (python:3.12-slim) | `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`, `APP_TIMEZONE`, `UPLOADS_DIR=/uploads` | `./uploads` (rw) |
| `nginx` | nginx:1.27-alpine | — | `./nginx/default.conf` (ro), `./frontend` (ro), `./uploads` (ro) |

`backend.depends_on: db` з `condition: service_healthy` (healthcheck `pg_isready`). Схема БД
створюється лише на порожньому томі `pgdata` скриптами з `db/init/`.

## Проходження запиту

1. **Статика**: `location /` → `try_files $uri $uri/ =404`. `/admin/` і `/monitor/` резолвляться
   в `admin/index.html` і `monitor/index.html` через директорний `index`.
2. **API**: `location ^~ /api/` → `proxy_pass http://backend:8000` (Host + X-Real-IP +
   X-Forwarded-For, read_timeout 60s).
3. **Файли**: `location ^~ /uploads/` → `alias /uploads/` (без `autoindex`, з `nosniff`).
4. Кешування статики вимкнено для `html|js|json|css` (`expires -1`), щоб зміни підхоплювались одразу.
5. `X-Frame-Options SAMEORIGIN` дозволяє превʼю в iframe з того самого origin.
6. `client_max_body_size 32m` — верхня межа для аплоадів на рівні nginx.

## Модель даних (db/init/01_schema.sql)

```
product_types 1 ── N products 1 ── N measurements

workstations   (налаштування місць, не звʼязані з вимірами напряму)
settings       (ключ-значення: daily_plan)
```

| Таблиця | Ключове | Призначення |
| :--- | :--- | :--- |
| `product_types` | `id`, `name UNIQUE` | Довідник типів продукції |
| `products` | `id`, `article UNIQUE`, `type_id → product_types` | Моделі: `name`, `description`, `characteristics` (JSONB, допуски), `datasheet_path` |
| `workstations` | `id`, `number UNIQUE >0` | `name`, `template`, `template_params` (JSONB), `result_key` |
| `measurements` | `id`, `barcode UNIQUE`, `product_id → products` | Один рядок на екземпляр: `q_tests_data`, `stage_times`, `notes`, `photo_path`, `release_date`, `created_at` |
| `settings` | `key PK`, `value JSONB` | `daily_plan` |

Звʼязки: `products.type_id` і `measurements.product_id` — `ON DELETE RESTRICT` (не можна видалити
модель/тип, якщо є виміри). Індекс `measurements(product_id)`; GIN-індекси на JSONB не створюються.

### Формат JSONB-полів

`q_tests_data` — один ключ на робоче місце (`workstations.result_key`):

```json
{ "dielectric": { "value": 2500.0, "ok": true, "ws": 1 } }
```

`stage_times` — час запису на етапі, ключ `ws<номер>`, час ставить БД (`now()`):

```json
{ "ws1": "2026-11-05T09:58:12.116680+02:00" }
```

Допуски в `products.characteristics.limits` (за ключем результату):

```json
{ "limits": { "dielectric": { "min": 100, "max": 5000, "range_min": 0, "range_max": 10000 } } }
```

## Ключові потоки

### Сканування та запис вимірювання

1. Оператор вводить номер місця → `GET /api/workstations/{number}/config`
   → `{ number, name, template, params, result_key }`.
2. Оболонка завантажує `templates/<template>.html` і викликає `init(root, cfg)` з `templates/<template>.js`.
3. Оператор сканує штрихкод (підставляється у `data-scan`), вводить значення, «Відправити».
4. `POST /api/measurements/submit { workstation, barcode, value, ok?, note? }`:
   - `_workstation()` знаходить місце і його `result_key`;
   - `_ensure_unit()` знаходить виріб (або створює, якщо в `template_params.product_id` задано модель);
   - `_evaluate()` перевіряє `range_min/range_max` (422 при виході) і `min/max` (→ `ok`);
   - один атомарний `UPDATE` додає запис у `q_tests_data`, час у `stage_times`, нотатку в `notes`.
5. Повторне вимірювання перезаписує значення ключа; історія переробок — у `notes`.

### Фотофіксація

`POST /api/measurements/photo` (multipart: `workstation`, `barcode`, `file`). Тип визначається за
магічними байтами (JPEG/PNG/WebP), файл зберігається під UUID у `uploads/photos/`, шлях — у
`measurements.photo_path`.

### Datasheet

`POST /api/admin/products/{id}/datasheet` (PDF). Магічні байти `%PDF-`, збереження в `uploads/datasheets/`,
шлях у `products.datasheet_path`. В адмінці в таблиці моделей показується посилання «PDF».

### Превʼю робочої станції

- Адмінка відкриває `<iframe src="/index.html?preview=1">`.
- Оболонка в режимі `?preview=1` не питає номер місця, а чекає `postMessage` з типом `config`
  (`{ type, template, number, config }`), перевіряючи `e.origin === location.origin`.
- При кожній зміні форми адмінка шле `postMessage` → оболонка перезавантажує шаблон.
- Відправка в превʼю вимкнена (`cfg.preview` → шаблони показують «Режим превʼю»), а сам iframe
  оголошений `inert` + `pointer-events:none`, щоб не перехоплював фокус (виправлений баг).

### Моніторинг план/факт

`GET /api/monitor/summary` → `{ plan, workstations: [{ number, name, fact }] }`.
`fact` рахується `COUNT(measurements)` за наявністю ключа `ws<номер>` у `stage_times` з часом ≥
початку доби (`date_trunc('day', now())`, пояс `APP_TIMEZONE`). Фронтенд опитує кожні 10 с.

## Конфігурація (змінні оточення)

| Змінна | Де використовується | Примітка |
| :--- | :--- | :--- |
| `POSTGRES_DB/USER/PASSWORD` | `db`, `backend` (`DATABASE_URL`) | пароль БД без `@ : / # %` |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `backend` (HTTP Basic) | `ADMIN_PASSWORD` без значення за замовчуванням |
| `APP_TIMEZONE` | `backend` (підключення до БД, «сьогодні») | за замовчуванням `Europe/Kyiv` |
| `UPLOADS_DIR` | `backend` | `/uploads` |

Обмеження розмірів задані в `backend/app/config.py`: `MAX_PHOTO_BYTES` = 10 МБ, `MAX_DATASHEET_BYTES` = 30 МБ.

## Припущення / не перевірено

- Мережа вважається внутрішньою та довіреною, тому публічні API без авторизації і без HTTPS.
  Це свідоме спрощення, а не вразливість «випадково».
