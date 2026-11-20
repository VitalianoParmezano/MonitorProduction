# Monitor Production

Внутрішня веб-система ВТК на виробничій лінії світильників. Фіксовані чотири робочі місця, партії з планом, карточка світильника за штрихкодом.

> **Цей файл є одночасно документацією і завданням для агента.** Реалізуй усе, що описано, у порядку з розділу «План реалізації». Чого в README немає, не вигадуй: зупинись і запиши питання в розділ «Відкриті питання» своєї відповіді.

## Зміст

1. [Стек і структура](#1-стек-і-структура)
2. [Концепція](#2-концепція)
3. [Прийняті рішення](#3-прийняті-рішення)
4. [База даних](#4-база-даних)
5. [Бізнес-логіка](#5-бізнес-логіка)
6. [Екрани](#6-екрани)
7. [API](#7-api)
8. [Файли (uploads)](#8-файли-uploads)
9. [Інфраструктура](#9-інфраструктура)
10. [Обмеження для агента](#10-обмеження-для-агента)
11. [План реалізації](#11-план-реалізації)
12. [Перевірки](#12-перевірки)
13. [Відкриті питання](#13-відкриті-питання)

---

## 1. Стек і структура

- **Nginx**: роздає статику `frontend/` і `uploads/` (том `ro`), проксує `/api/` на бекенд.
- **FastAPI** (Python 3.12, psycopg3, без ORM): SQL лише з параметрами.
- **PostgreSQL 16**: схема в `db/init/*.sql`
- **Docker Compose**: сервіси `db`, `backend`, `nginx`.
- **Фронтенд без збірки**: чистий HTML + JS (ES modules) + CSS.
- Мережа внутрішня. Порт 443 ( HTTPS )
- Мова інтерфейсу, коментарів у README і повідомлень користувачу: українська. Часовий пояс `Europe/Kyiv`.

```
factory-system/
├── docker-compose.yml
├── .env.example            # POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, ADMIN_USER, ADMIN_PASSWORD, APP_TIMEZONE
├── nginx/default.conf
├── db/init/01_schema.sql
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── db.py
│       └── routers/
│           ├── public.py   # те, що викликають робочі місця і сервісний режим
│           └── admin.py    # CRUD: типи, моделі, партії, місця
├── frontend/
│   ├── index.html          # вхід: номер місця / сервісний режим / адмінка
│   ├── station/            # екран робочого місця (один HTML, 4 режими)
│   ├── service/            # сервісний режим
│   ├── admin/
│   └── shared/             # api.js, ui.js, scanner.js, style.css
└── uploads/
    ├── photos/
    └── datasheets/
```

## 2. Концепція

Є чотири робочі місця з фіксованими задачами. Світильник проходить їх, на кожному записується результат.

| № | Задача (ключ) | Що вводить оператор | Що зберігається |
|---|---------------|---------------------|-----------------|
| 1 | `driver_programming`, програмування драйвера | Сканує штрихкод світильника і драйвера | Штрихкод світильника і драйвера |
| 2 | `insulation`, опір ізоляції | число, МОм | значення |
| 3 | `earth`, опір заземлення | число, Ом | значення |
| 4 | `function_test`, перевірка роботоздатності, вписування даних електричних параметрів автоматично через mosqutto (zigbee2mqtt), фотофіксація | Нічого, кнопка `фіксація` робить фотографію і зберігає значення електричних параметрів з Z2M | фотографія, електричні параметри |

Номер місця задає задачу (таблиця `workstations`), тому номер можна змінити без коду.

Цикл оператора на будь-якому місці: скан штрихкоду (сканер надсилає Enter) → ввід результату → «Відправити» → зелена або червона смуга, звук → поля очищаються, фокус повертається на штрихкод.

## 3. Прийняті рішення

1. **Партія.** Одночасно в роботі одна партія (`status = 'open'`). У сервісному вікні вказується яка поточна партія і усі вироби прив'язуються до поточної партії
2. **Одна партія це одна модель** світильника.
3. **Готовий** світильник: усі етапи пройдені і реальні значення в межах граничних
4. **Порядок.** Місця 2–4 вимагають, щоб світильник уже існував (його створює місце 1), інакше помилка «Штрихкод не знайдено». Порядок між 2, 3 і 4 не примусовий.
5. -пропуск-
6. **Фото** лежить у `units.photo_path`. Окремого місця для фото немає (див. «Відкриті питання»).
7. **Історія**: повторний запис перезаписує результат, `attempts` росте на 1, пояснення йдуть у `notes`. Окремої таблиці історії немає.
8. Штрихкод не є первинним ключем: це `UNIQUE NOT NULL` поле, ключ `id BIGINT`.
9. План нічого не блокує: партію можна зробити більшою або меншою за план. А потім навіть динамічно міняти
10. Лічильники «готово» не зберігаються, а рахуються запитом (через представлення `unit_status`).


## 4. База даних

Файл `db/init/01_schema.sql`. Нижче цільова схема, допускається косметика (назви обмежень), але не зміна змісту.

```sql
CREATE TABLE product_types (
    id    BIGSERIAL PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE                -- Світильник, Плата керування, ...
);

CREATE TABLE products (                       -- модель
    id              BIGSERIAL PRIMARY KEY,
    type_id         BIGINT NOT NULL REFERENCES product_types(id),
    name            TEXT NOT NULL,
    article         TEXT NOT NULL UNIQUE,
    description     TEXT,
    characteristics JSONB NOT NULL DEFAULT '{}',   -- довідкові дані, система їх не інтерпретує
    datasheet_path  TEXT,                          -- відносно uploads/datasheets/
    -- значення за замовчуванням, копіюються в партію при її створенні
    default_insulation_min_mohm NUMERIC,
    default_earth_max_ohm       NUMERIC,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE batches (
    id                    BIGSERIAL PRIMARY KEY,
    code                  TEXT NOT NULL UNIQUE,         -- 2026-11-A
    product_id            BIGINT NOT NULL REFERENCES products(id),
    planned_qty           INT NOT NULL CHECK (planned_qty >= 0),
    insulation_min_mohm   NUMERIC NOT NULL,             -- норма: value >= min
    earth_max_ohm         NUMERIC NOT NULL,             -- норма: value <= max
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE units (                                    -- світильник
    id          BIGSERIAL PRIMARY KEY,
    barcode     TEXT NOT NULL UNIQUE,
    batch_id    BIGINT NOT NULL REFERENCES batches(id),
    notes       TEXT,
    photo_path  TEXT,                                   -- відносно uploads/photos/
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX units_batch_idx ON units(batch_id);

-- по одному рядку на світильник на тест; unit_id одночасно PK і FK
CREATE TABLE driver_programming (
    unit_id           BIGINT PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE,
    ok                BOOLEAN NOT NULL,
    firmware_version  TEXT,
    attempts          INT NOT NULL DEFAULT 1,
    tested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    workstation       SMALLINT NOT NULL
);

CREATE TABLE insulation_tests (
    unit_id     BIGINT PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE,
    value_mohm  NUMERIC NOT NULL,
    ok          BOOLEAN NOT NULL,
    attempts    INT NOT NULL DEFAULT 1,
    tested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    workstation SMALLINT NOT NULL
);

CREATE TABLE earth_tests (
    unit_id     BIGINT PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE,
    value_ohm   NUMERIC NOT NULL,
    ok          BOOLEAN NOT NULL,
    attempts    INT NOT NULL DEFAULT 1,
    tested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    workstation SMALLINT NOT NULL
);

CREATE TABLE function_tests (
    unit_id     BIGINT PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE,
    ok          BOOLEAN NOT NULL,
    comment     TEXT,
    attempts    INT NOT NULL DEFAULT 1,
    tested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    workstation SMALLINT NOT NULL
);

CREATE TABLE workstations (                              -- номер місця -> задача
    number  SMALLINT PRIMARY KEY,
    task    TEXT NOT NULL UNIQUE
            CHECK (task IN ('driver_programming','insulation','earth','function_test')),
    title   TEXT NOT NULL
);
INSERT INTO workstations VALUES
 (1,'driver_programming','Програмування драйвера'),
 (2,'insulation','Опір ізоляції'),
 (3,'earth','Опір заземлення'),
 (4,'function_test','Перевірка роботоздатності');

CREATE VIEW unit_status AS
SELECT u.id AS unit_id, u.barcode, u.batch_id,
       COALESCE(d.ok,false) AS driver_ok,
       COALESCE(i.ok,false) AS insulation_ok,
       COALESCE(e.ok,false) AS earth_ok,
       COALESCE(f.ok,false) AS function_ok,
       (COALESCE(d.ok,false) AND COALESCE(i.ok,false)
        AND COALESCE(e.ok,false) AND COALESCE(f.ok,false)) AS is_ready
FROM units u
LEFT JOIN driver_programming d ON d.unit_id = u.id
LEFT JOIN insulation_tests  i ON i.unit_id = u.id
LEFT JOIN earth_tests       e ON e.unit_id = u.id
LEFT JOIN function_tests    f ON f.unit_id = u.id;
```

Демо-дані роби в окремому `db/init/02_seed_demo.sql` і познач, що його треба прибрати до продакшну.

## 5. Бізнес-логіка

### Запис результату

Один ендпоінт на всі місця: `POST /api/stations/{number}/submit`. Задачу бекенд бере з `workstations`, а не з клієнта.

Для всіх місць:

1. Знайти місце за номером, інакше 404.
2. Валідувати тіло залежно від задачі (див. нижче), інакше 422.
3. **Місце 1:** якщо штрихкоду немає в `units`, створити світильник у партії (відкрита партія, або `batch_id` з тіла, якщо відкритих кілька; якщо жодної відкритої, помилка «Немає відкритої партії»). Якщо світильник є, це повторне програмування: оновити результат.
4. **Місця 2–4:** якщо штрихкоду немає, 404 «Штрихкод не знайдено». Нічого не створювати.
5. Записати результат через `INSERT ... ON CONFLICT (unit_id) DO UPDATE SET ..., attempts = <table>.attempts + 1, tested_at = now()`. Час ставить **сервер**, не браузер.
6. Створення світильника і запис результату на місці 1 в одній транзакції.
7. Повернути `{ok, attempts, unit: {...}}` для показу смуги «в нормі / поза нормою».

### Обчислення `ok`

- **Місце 2:** `ok = value_mohm >= batch.insulation_min_mohm`.
- **Місце 3:** `ok = value_ohm <= batch.earth_max_ohm`.
- **Місця 1 і 4:** `ok` надходить від оператора (кнопки).
- Для місць 2 і 3 `ok` від клієнта ігнорується.

### Відсікання очепяток

Окремо від норми діє межа правдоподібності, що не залежить від партії. Значення за межами повертає 422 і **нічого не записує**. Константи в `config.py`, щоб міняти без коду схеми:

- ізоляція: `0 < value <= 10000` МОм;
- заземлення: `0 <= value <= 10` Ом.

(Числа стартові, див. «Відкриті питання».)

### Партії

- Створення партії копіює `default_insulation_min_mohm` та `default_earth_max_ohm` моделі в партію. Адмін може їх змінити в формі.
- Закрита партія не приймає нових світильників на місці 1. Результати на місцях 2–4 для світильників закритої партії приймаються.
- Видаляти партію з світильниками не можна (409).

### Готовність і прогрес

Лічильники лише через запити:

```sql
SELECT b.id, b.code, b.planned_qty,
       count(s.unit_id)                         AS started,
       count(*) FILTER (WHERE s.is_ready)       AS ready,
       count(*) FILTER (WHERE s.driver_ok)      AS driver_done,
       count(*) FILTER (WHERE s.insulation_ok)  AS insulation_done,
       count(*) FILTER (WHERE s.earth_ok)       AS earth_done,
       count(*) FILTER (WHERE s.function_ok)    AS function_done
FROM batches b
LEFT JOIN unit_status s ON s.batch_id = b.id
WHERE b.id = %s
GROUP BY b.id;
```

(`count(*) FILTER` по `LEFT JOIN` порахує порожню партію як 1 рядок із `NULL`. Агент має це врахувати, наприклад через `count(s.unit_id) FILTER (...)`.)

## 6. Екрани

### Вхід (`/`)

Три шляхи: поле «Номер робочого місця» (1–4), кнопка «Сервісний режим», посилання «Адмінування».

### Робоче місце (`/station/?n=1..4`)

- Шапка: годинник, номер і назва місця, активна партія (код, «готово / план»).
- Поле штрихкоду (`data-scan`), Enter від сканера переводить фокус на поле значення (місця 2, 3) або на першу кнопку (місця 1, 4).
- Місце 1: вибір партії (лише якщо відкритих кілька), поле версії прошивки (необов'язкове), кнопки «Успішно» / «Брак».
- Місця 2, 3: числове поле з одиницями (МОм / Ом), показана норма партії, кнопка «Відправити».
- Місце 4: кнопки «Придатний» / «Непридатний», поле коментаря.
- Після відповіді: зелена або червона смуга, звук, очищення, фокус на штрихкод. Помилка: червона смуга з текстом, штрихкод виділений, значення не очищається.
- Кнопки блокуються на час запиту (подвійний клік).
- Порожній штрихкод або число: повідомлення без запиту.
- Режим `?preview=1`: відправка вимкнена.

### Сервісний режим (`/service/`)

- Вибір партії (за замовчуванням відкрита).
- Прогрес «готово / план» зі смугою і розбивкою по чотирьох етапах.
- Поле штрихкоду. Після скану: **картка світильника**: партія, модель, ліміти партії, результат кожного з чотирьох етапів (значення, ok, час, місце, `attempts`), примітки, фото, посилання на datasheet.
- Редагування `notes` і завантаження фото з картки.
- Оновлення прогресу: polling раз на 5–10 секунд (без WebSocket).

### Адмінка (`/admin/`, HTTP Basic)

Вкладки: «Типи продукції», «Моделі», «Партії», «Робочі місця» (лише зміна `title` і `task`-відповідності). Усе стандартний CRUD, у моделях ще завантаження datasheet. Помилки зав'язків (видалити тип, що використовується) 409 з читабельним текстом.

### Загальні правила фронтенду

- Текст у DOM лише через `textContent`, не `innerHTML` для даних з сервера.
- Спільна логіка (скан, відправка, смуга, звук) у `shared/`, а не копіюється в екрани.
- Без бібліотек і збірки.

## 7. API

Публічні (без автентифікації, внутрішня мережа):

| Метод і шлях | Призначення |
|--------------|-------------|
| `GET /api/stations/{n}` | конфіг місця: задача, назва, відкриті партії |
| `POST /api/stations/{n}/submit` | запис результату (розділ 5) |
| `GET /api/units/{barcode}` | картка світильника (JOIN усіх таблиць) |
| `PATCH /api/units/{barcode}` | зміна `notes` |
| `POST /api/units/{barcode}/photo` | фото (multipart) |
| `GET /api/batches` | список партій з прогресом |
| `GET /api/batches/{id}/progress` | прогрес і розбивка по етапах |

Адмін (HTTP Basic), префікс `/api/admin/`: CRUD для `product-types`, `products` (+ `POST .../datasheet`), `batches`.

Тіло `submit` залежно від задачі:

```json
{"barcode": "SN001", "ok": true, "firmware_version": "1.2.0", "batch_id": 1}   // driver_programming
{"barcode": "SN001", "value": 250.5}                                            // insulation, earth
{"barcode": "SN001", "ok": true, "comment": "..."}                              // function_test
```

Коди відповідей: 200 успіх, 404 невідоме місце або штрихкод, 409 конфлікт (закрита партія, дублікати в адмінці), 413 завеликий файл, 422 валідація (у тому числі вихід за межу правдоподібності).

## 8. Файли (uploads)

- `uploads/photos/` і `uploads/datasheets/`: окремі директорії.
- Ім'я файлу на диску лише UUID + дозволене розширення; оригінальне ім'я не зберігається.
- Фото: тільки jpeg/png/webp, перевіряти тип за вмістом, не лише за розширенням. Datasheet: pdf.
- Ліміт розміру: `client_max_body_size` у Nginx (наприклад 10m) і така ж перевірка на бекенді.
- Backend пише, Nginx читає: у Nginx том змонтований `:ro`.
- У БД зберігається шлях відносно відповідної директорії.

## 9. Інфраструктура

- `docker-compose.yml`: `db` (з healthcheck `pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"`), `backend`, `nginx`. Змінні з `.env`.
- Дані БД в іменованому томі `pgdata` (щоб не мати проблем з правами на Windows).
- `db/init/*.sql` виконується лише на порожньому томі, подальші зміни схеми через Alembic.
- Nginx: порт 80, `/api/` на бекенд, статика, `/uploads/` з `ro`, `client_max_body_size`.
- Бекапи: `pg_dump` і копія `uploads/` одночасно.
- Камера в браузері (якщо знадобиться фото з вебкамери) працює лише на HTTPS або `localhost`. Це **поза цим завданням**, див. «Відкриті питання».

## 10. Обмеження для агента

- Не додавай залежності, окрім необхідних (`fastapi`, `uvicorn`, `psycopg[binary,pool]`, `python-multipart`, `alembic`).
- Не підставляй дані в SQL-рядки, лише параметри.
- Не вигадуй поведінку, якої немає в README.
- Не роби загального механізму «будь-який ключ у JSON» і «шаблони з параметрами»: у цій концепції їх немає, чотири екрани фіксовані.
- Старий код (якщо є в репозиторії) з `q_tests_data`, `result_key`, `stage_times`, `templates.json` прибери або перенеси в `legacy/` і не використовуй.
- Стиль коду як у сусідніх файлах, коментарі українською.

## 11. План реалізації

1. Каркас: `docker-compose.yml`, `.env.example`, Nginx, `db/init/01_schema.sql`.
2. Бекенд: конфіг, підключення, `public.py` (місце, submit, картка, прогрес), потім `admin.py`.
3. Фронтенд: `shared/`, екран місця, сервісний режим, адмінка.
4. Файли: фото і datasheet.
5. Демо-дані й перевірки (розділ 12).
6. Оновити README, якщо в процесі щось довелося уточнити.

## 12. Перевірки

Підніми стек (`docker compose up -d --build`) і перевір:

1. Створи тип, модель і партію (план 3, ліміти за замовчуванням з моделі скопіювалися).
2. Місце 1: скан `SN001` створює світильник у відкритій партії, `attempts = 1`. Повторний скан того ж коду оновлює результат, `attempts = 2`, нового рядка в `units` немає.
3. Місця 2–4 з невідомим штрихкодом: 404 «Штрихкод не знайдено», нічого не створено.
4. Місце 2: значення нижче `insulation_min_mohm` дає `ok = false`; вище дає `true`. Клієнтський `ok` ігнорується.
5. Місце 3: значення вище `earth_max_ohm` дає `ok = false`.
6. Значення поза межею правдоподібності (наприклад 100000 МОм): 422, рядка не створено і не змінено.
7. Зміна лімітів партії не змінює вже збережений `ok`.
8. Світильник із чотирма `ok = true` в `unit_status.is_ready`; прогрес партії показує правильні «готово / розпочато / план».
9. Партія з нулем світильників у прогресі дає `started = 0`, а не 1.
10. 20 паралельних однакових відправок на місці 1 дають один рядок у `units`.
11. Закрита партія: нові світильники на місці 1 відхиляються (409), місця 2–4 для вже існуючих працюють.
12. Фото: нормальний jpeg приймається, файл з розширенням `.jpg` але іншим вмістом ні, завеликий файл дає 413, ім'я на диску UUID.
13. Адмінка без логіну: 401. Видалення типу, що використовується: 409.
14. Preview-режим екрана місця нічого не записує.

У відповіді коротко опиши, що змінено по файлах, і **окремо напиши, що з перевірок виконано, а що ні**.

## 13. Відкриті питання

Те, що вирішено за замовчуванням, але варто підтвердити:

- Межі правдоподібності (10 000 МОм, 10 Ом) стартові, потрібні реальні діапазони приладів.
- Напрям норм: ізоляція «не менше», заземлення «не більше».
- Чи потрібне фото на конкретному місці (наприклад, на 4-му), чи достатньо завантаження з картки в сервісному режимі.
- Чи потрібне на місці 1 щось, крім ok і версії прошивки (серійний номер драйвера, ревізія плати).
- Чи можуть паралельно бути відкриті кілька партій.
- Фото з вебкамери: потребує HTTPS (mkcert) або браузерного прапорця, окреме рішення.