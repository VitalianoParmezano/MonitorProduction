# MODULES — Monitor Production

## Бекенд (`backend/app/`)

| Файл | Призначення |
| :--- | :--- |
| `main.py` | Створення `FastAPI` (title, docs `/api/docs`), lifespan (створення підкаталогів uploads, відкриття/закриття пулу), глобальні обробники `UniqueViolation`→409 і `ForeignKeyViolation`→409, підключення роутерів |
| `config.py` | Читання змінних оточення: `DATABASE_URL`, `TIMEZONE`, `ADMIN_USER`, `ADMIN_PASSWORD`, `UPLOADS_DIR`; ліміти `MAX_PHOTO_BYTES` (10 МБ), `MAX_DATASHEET_BYTES` (30 МБ) |
| `db.py` | Асинхронний пул `psycopg_pool.AsyncConnectionPool` (min 1 / max 10, `open=False`), `row_factory=dict_row`, опція `-c timezone=...`; хелпери `fetch_all`, `fetch_one`, `execute` |
| `auth.py` | HTTP Basic (`HTTPBasic`), залежність `require_admin`, порівняння через `secrets.compare_digest` |
| `files.py` | `read_limited` (ліміт розміру → 413), `sniff_image` (JPEG/PNG/WebP за магічними байтами), `sniff_pdf` (`%PDF-`), `save` (UUID-імʼя, повертає `/uploads/<subdir>/<name>`) |

### Роутери

**`routers/public.py`** — публічні ендпоінти (без авторизації):
- `GET /api/workstations/{number}/config` — шаблон, параметри, `result_key`.
- `POST /api/measurements/submit` — запис результату (валідація `SubmitIn`, `_evaluate` допусків,
  атомарний `UPDATE` `q_tests_data`/`stage_times`/`notes`).
- `POST /api/measurements/photo` — фотофіксація (multipart).
- `GET /api/units/{barcode}` — поточний стан виробу (для фінального тесту).
- Допоміжні: `_workstation`, `_ensure_unit`, `_evaluate`.

**`routers/admin.py`** — адмін-ендпоінти (HTTP Basic через `dependencies=[Depends(require_admin)]`):
- Типи: `GET/POST /api/admin/product-types`, `PUT/DELETE /api/admin/product-types/{id}`.
- Моделі: `GET/POST /api/admin/products`, `PUT/DELETE /api/admin/products/{id}`,
  `POST /api/admin/products/{id}/datasheet`.
- Робочі місця: `GET/POST /api/admin/workstations`, `PUT/DELETE /api/admin/workstations/{id}`.
- Налаштування: `GET/PUT /api/admin/settings` (добовий план `daily_plan`).

**`routers/monitor.py`** — `GET /api/monitor/summary` (план + факт по місцях).

## Фронтенд

### Оболонка оператора

- `index.html` — шапка (годинник, назва місця, кнопка «Змінити місце»), блок логіна, контейнер `#content`.
- `shared/shell.js` — вхід за номером місця, `loadTemplate(name, cfg)` (fetch `.html` + `import .js` +
  `init(root, cfg)` + повернення фокусу), режим превʼю через `postMessage`, запуск годинника.
- `shared/api.js` — fetch-обгортка: JSON у JSON, FormData як є, помилки як `Error` з українським текстом.
- `shared/ui.js` — `showResult`, `beep` (WebAudio), `focusScan` (фокус на `[data-scan]`), `startClock`.
- `shared/style.css` — CSS-змінні (палітра), стилі оболонки, логіна, шаблонів, результату.

### Шаблони робочих місць (`templates/`)

Кожен шаблон — пара `.html` (фрагмент розмітки) + `.js` (експортує `init(root, cfg)`).

| Шаблон | `.html` | `.js` | Поведінка |
| :--- | :--- | :--- | :--- |
| `measurement` | штрихкод + число + кнопка | `measurement.js` | валідація числа, Enter переходить до поля значення, `POST /measurements/submit`, `focusScan` після успіху |
| `photo` | штрихкод + вибір файлу | `photo.js` | Enter відкриває вибір файлу, `POST /measurements/photo` |
| `final-test` | штрихкод + історія + вердикт | `final-test.js` | `GET /api/units/{barcode}`, таблиця `q_tests_data`, вердикт «Придатний/Непридатний» з `ok` і `note` |

`templates.json` — маніфест шаблонів: `title` і `params` (типи полів, що їх малює адмінка).
Параметр `product_id` (у `measurement`/`photo`) вмикає автостворення виробу при першому скануванні.

### Адмінка (`admin/`)

- `index.html` — вкладки «Робочі місця / Типи / Моделі / План», форма робочого місця, превʼю-iframe.
- `admin.js` — рендер таблиць, CRUD через `/api/admin/*`, динамічна форма параметрів за `templates.json`,
  превʼю через `postMessage` + масштабування iframe (`fitPreview`, 1280×720 → `transform: scale()`).
- `admin.css` — стилі таблиць, форм, превʼю.

### Моніторинг (`monitor/`)

- `index.html` — шапка з планом/годинником, картки, «качечка».
- `monitor.js` — `refresh()` кожні 10 с (`GET /api/monitor/summary`), рендер карток з відсотком,
  звук «кря» і анімація качечки (раз на 30 хв або клавіша `D`).
- `monitor.css` — стилі карток, прогрес-барів, анімації.

## База даних (`db/init/`)

- `01_schema.sql` — створення таблиць `product_types`, `products`, `workstations`, `measurements`,
  `settings` та індексу `measurements(product_id)`. Виконується лише на порожньому `pgdata`.
- `02_seed_demo.sql` — демо-дані: 2 типи, 1 модель (`LED-40`), 3 робочі місця, план 100.
  Рекомендовано видалити перед промисловим запуском.

## Nginx (`nginx/default.conf`)

Один `server` на порту 80: статика, `/api/` → проксі на backend, `/uploads/` → alias,
`X-Frame-Options SAMEORIGIN`, `client_max_body_size 32m`, `expires -1` для html/js/json/css.

## Припущення / не перевірено

- Немає `package.json` і будь-яких JS-залежностей — фронтенд працює на нативних ES-модулях у браузері.
- Звʼязок між `templates.json` і реальними файлами шаблонів підтримується вручну (бекенд не валідує,
  що `workstations.template` існує в маніфесті).