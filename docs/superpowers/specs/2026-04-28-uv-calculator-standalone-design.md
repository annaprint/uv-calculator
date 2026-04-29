# UV-калькулятор как самостоятельный продукт — дизайн

**Дата:** 2026-04-28
**Контекст:** калькулятор УФ-печати в репозитории `/Users/annakorotkih/Desktop/Claude Code Lab/prices/` (Node.js + Express + SQLite). Базовая функциональность реализована и закоммичена (последний коммит `f95e9d7`, 9 апреля 2026). Этот документ описывает развитие калькулятора в самостоятельный продукт для 6 менеджеров типографии «Сити Принт».

## Цель

Превратить локальный prototype в продукт, которым менеджеры реально пользуются ежедневно: с авторизацией, разделением ролей, общим деплоем в облаке, привязкой КП к клиентам, брендированными PDF, бэкапами и фильтрами в истории КП.

## Не-цели (явно вне scope)

- Email-recovery пароля и SMTP — не нужен.
- История изменений цен (audit log) — не нужен в этой итерации.
- Десктоп-приложение Electron — отдельный проект «UV ERP», не пересекается с этой задачей.
- HTML-редактор шаблонов PDF в админке — слишком большой scope, в админке только реквизиты и подпись.

## Стек и подход

Расширение текущего стека без переписывания:

| Компонент | Технология |
|---|---|
| Веб-сервер | Node.js 20 + Express 4 (как сейчас) |
| БД | SQLite через `better-sqlite3` (как сейчас) |
| Авторизация | `express-session` + `connect-sqlite3` (хранение сессий в той же БД) + `bcryptjs` |
| Защита от brute-force | `express-rate-limit` на `/api/login` (5 попыток/мин с IP) + дублирование в nginx |
| PDF | `pdfkit` + TTF-шрифт DejaVu Sans (для кириллицы) |
| Тесты | Jest + Supertest (как сейчас) |
| Веб-сервер на VDS | nginx как reverse proxy + Let's Encrypt |
| Запуск | systemd unit `uv-calc.service` + таймер `uv-calc-backup.timer` |
| Деплой | Timeweb Cloud VDS, Ubuntu 24.04, домен `calc.citi-print.ru` |

Альтернативы (Puppeteer для PDF, PostgreSQL, Fastify) рассмотрены и отклонены: Puppeteer тяжёл для VDS на 2 ГБ, PostgreSQL/Fastify — overkill для 6 пользователей и нагрузки в десятки расчётов в день.

## Схема БД

К существующим 5 таблицам (`sheet_materials`, `sheet_tiers`, `souvenir_prices`, `catalog_items`, `quotes`) добавляются 4 новые и расширяется `quotes`.

### Новые таблицы

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,    -- 0/1
  is_active INTEGER NOT NULL DEFAULT 1,   -- 0/1
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
-- управляется connect-sqlite3, expires_at = создание + 8ч

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE company_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- ключи: name, inn, kpp, address, phone, email, site, bank_details,
--        logo_path, signature, kp_validity_days
```

### Расширение `quotes`

```sql
ALTER TABLE quotes ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE quotes ADD COLUMN client_id INTEGER REFERENCES clients(id);
ALTER TABLE quotes ADD COLUMN comment TEXT;        -- внутренняя заметка менеджера, не в PDF
ALTER TABLE quotes ADD COLUMN total REAL;          -- для сортировки/фильтров
ALTER TABLE quotes ADD COLUMN pdf_path TEXT;       -- путь к сгенерированному PDF
```

Поле `quotes.result` уже хранит JSON c числовой разбивкой расчёта — это «заморозка цен» (требование B). Колонка `total` дублирует итог, чтобы не парсить JSON в каждой выборке. При миграции v4 значение `total` бэкфилится из `result`.

### Миграции

Форвард-only, по `PRAGMA user_version`. Файл `db.js` хранит массив `migrations = [{ version, up }, …]`. На старте `node migrate.js` или при первом обращении читает `user_version`, применяет все более поздние миграции в одной транзакции и обновляет версию. Откат не делается — для отката используется бэкап БД.

| Версия | Содержание |
|---|---|
| v1 | Существующая схема (5 таблиц) |
| v2 | `users`, `sessions`, `quotes.user_id` |
| v3 | `clients`, `quotes.client_id`, `quotes.comment` |
| v4 | `quotes.total` + бэкфилл из `result` |
| v5 | `company_settings`, `quotes.pdf_path` |

## Авторизация и права

### Поток входа

1. Менеджер открывает `calc.citi-print.ru` без cookie → middleware редиректит на `/login`.
2. POST `/api/login` с email+паролем → сервер достаёт пользователя, проверяет `bcrypt.compare(password, password_hash)`, проверяет `is_active=1`. Если ок — создаёт сессию через `express-session`, выставляет cookie `connect.sid` (httpOnly, secure, SameSite=Lax, maxAge=8ч).
3. На каждый запрос middleware читает `req.session.userId`, подгружает `req.user`. Если пользователь стал `is_active=0` — сессия инвалидируется.

### Матрица доступов

| Маршрут | Гость | Менеджер | Админ |
|---|---|---|---|
| `/login`, `POST /api/login`, `POST /api/logout` | ✓ | ✓ | ✓ |
| `/` (калькулятор), `public/js/*` | redirect | ✓ | ✓ |
| `POST /api/calc/sheet`, `POST /api/calc/souvenir` | 401 | ✓ | ✓ |
| `GET /api/quotes`, `POST /api/quotes`, `GET /api/quotes/:id` | 401 | ✓ | ✓ |
| `GET /api/quotes/:id/pdf` | 401 | ✓ | ✓ |
| `DELETE /api/quotes/:id` | 401 | только свои | ✓ |
| `GET /api/catalog`, `GET /api/materials`, `GET /api/sheet-tiers`, `GET /api/souvenir-prices` | 401 | ✓ | ✓ |
| `GET /api/clients`, `POST /api/clients`, `PUT /api/clients/:id` | 401 | ✓ | ✓ |
| `DELETE /api/clients/:id` | 401 | ✗ (403) | ✓ |
| `/admin.html` | redirect | 403 | ✓ |
| `POST/PUT/DELETE /api/materials`, `…/sheet-tiers`, `…/souvenir-prices`, `/api/catalog/import`, `PUT /api/catalog/:id/price-type` | 401 | ✗ (403) | ✓ |
| `POST/PUT /api/users`, `POST /api/users/:id/reset-password`, `PUT /api/users/:id/active` | 401 | ✗ | ✓ |
| `GET /api/users/me`, `POST /api/users/me/change-password` | 401 | ✓ | ✓ |
| `GET/PUT /api/company-settings`, `POST /api/company-settings/logo` | 401 | ✗ | ✓ |
| `GET /api/backups`, `POST /api/backups`, `GET /api/backups/:filename` | 401 | ✗ | ✓ |

### Управление пользователями

- **Создание:** только админ, через раздел «Пользователи». Форма: email, имя, временный пароль, флаг admin. Пароль передаётся менеджеру голосом/в личке.
- **Сброс чужого пароля:** только админ. Кнопка «Сбросить пароль» открывает модалку, в которой админ задаёт новый временный пароль.
- **Смена своего пароля:** в шапке любой страницы — модалка «старый/новый/повтор».
- **«Выключить»:** ставит `is_active=0`, сессия пользователя инвалидируется при ближайшем запросе. Удаление не делаем — иначе ломаются связи в `quotes.user_id`.
- **Первый админ:** создаётся скриптом `seed.js` при первой установке из переменных окружения `ADMIN_EMAIL` и `ADMIN_PASS`. Дальше админы создаются через админку.
- **Защита от brute-force:** `express-rate-limit` на `POST /api/login` (5 попыток/мин с IP), дополнительно `limit_req` в nginx (10 r/min).

## Клиенты и привязка к КП

### Справочник клиентов

Раздел «Клиенты» в админке. Менеджер может видеть, создавать и редактировать карточки клиентов (например, обновить телефон). Удаление — только админ (чтобы избежать случайных потерь связи с КП). Колонки списка: название, контактное лицо, телефон, email, число привязанных КП, действия. Кнопка «Открыть» ведёт на карточку клиента: реквизиты + список всех его КП.

### Привязка при сохранении КП

Когда менеджер нажимает «Сформировать КП» в калькуляторе:

1. Открывается модалка «Сохранить коммерческое предложение».
2. Выпадающий список клиентов с поиском по подстроке имени.
3. Опция «+ Создать нового клиента» открывает мини-форму (название обязательно, остальные поля — опционально).
4. Опционально: поле «Комментарий к КП» — записывается в отдельную колонку `quotes.comment`, видна только менеджерам в истории, в PDF клиенту не попадает.
5. Кнопка «Сохранить и сформировать PDF» — создаёт `quotes`-запись, генерирует PDF в `data/pdfs/quote-{id}.pdf`, открывает PDF на скачивание.

`client_id` может быть `NULL` — если менеджер не выбрал клиента.

## История КП с фильтрами

Раздел «Сохранённые КП» в админке (доступен менеджерам и админам). Все запросы идут на `GET /api/quotes` с query-параметрами.

### Фильтры

| Поле | Параметр | Поведение |
|---|---|---|
| Поиск по тексту | `q` | `WHERE kp_text LIKE ? OR params LIKE ? OR (артикул в catalog_items)` |
| Дата от | `date_from` | По умолчанию = первое число текущего месяца |
| Дата до | `date_to` | По умолчанию = сегодня |
| Тип | `type` | `sheet` / `souvenir` |
| Автор | `user_id` | dropdown с активными и неактивными пользователями |
| Клиент | `client_id` | dropdown по справочнику клиентов |
| Сумма от/до | `total_from`, `total_to` | По колонке `quotes.total` |

### Сортировки

Колонки «Дата» и «Сумма» — серверная сортировка через `ORDER BY created_at DESC` или `ORDER BY total DESC` (параметры `sort` и `dir`).

### Пагинация

Страницами по 50 записей, кнопка «Ещё» догружает следующую страницу. Параметры `limit` и `offset`. Без пагинации длинная история начнёт тормозить UI (не БД).

### Действия в строке

- **PDF** — `GET /api/quotes/:id/pdf` отдаёт уже сгенерированный файл из `pdf_path`. Если файл отсутствует — генерирует на лету.
- **Открыть** — модалка с полным расчётом (заморожен на момент создания) и текстом КП. Кнопка «Перегенерировать PDF» — на случай, если шаблон изменился.
- **×** (Удалить) — менеджер удаляет только свои КП, админ — любые. Подтверждение через модалку.

## Брендированный PDF

### Генерация

`pdf.js` — отдельный модуль с функцией `generateQuotePdf(quote, client, settings, user) → Buffer`. Использует PDFKit:

1. Регистрирует шрифт DejaVu Sans (TTF, поддерживает кириллицу) из `assets/fonts/DejaVuSans.ttf`.
2. Загружает логотип из `data/uploads/logo.png`.
3. Рендерит секции в фиксированном шаблоне (см. ниже).
4. Возвращает Buffer для записи в файл и/или отдачи в HTTP-ответе.

При первом запуске SVG-логотип из `assets/logo-source.svg` конвертируется в `data/uploads/logo.png` (≈600 px шириной, прозрачный фон) — для конвертации используется `sharp` или вручную перед коммитом, конкретный способ выбираем в плане реализации.

### Структура PDF

Одностраничный документ (А4):

1. **Шапка:** логотип слева, реквизиты компании справа (название, ИНН/КПП, адрес, телефон, email).
2. **Заголовок:** «Коммерческое предложение № {quote.id}», дата «от …», «действительно до …» (срок берётся из `company_settings.kp_validity_days`).
3. **Заказчик:** название клиента, контактное лицо, телефон. Если клиент не выбран — секция пропускается.
4. **Параметры заказа:** одна строка-описание (тип печати, материал, размеры, тираж, опции, срок).
5. **Расчёт:** таблица — статья, формула, сумма (на основании `quote.result`).
6. **Итог:** выделенный блок «Итого: {total} ₽».
7. **Срок изготовления и реквизиты для оплаты:** мелким шрифтом снизу.
8. **Подпись:** имя и должность из `company_settings.signature` + email менеджера-автора.

Шаблон в коде, без HTML-редактора в админке. Реквизиты, банк-реквизиты, логотип, подпись и срок действия редактируются через раздел «Настройки компании».

### Хранение

PDF пишется в `data/pdfs/quote-{id}.pdf`, путь сохраняется в `quotes.pdf_path`. При перегенерации старый файл перезаписывается.

### Настройки компании

Раздел «Настройки компании» в админке. Одна форма со всеми ключами `company_settings`:

- Реквизиты: название, ИНН, КПП, адрес, телефон, email, сайт.
- Банк-реквизиты (свободный текст, многострочный).
- Логотип: загрузка через `multer` в `data/uploads/logo.png` (PNG/JPG, до 1 МБ).
- Подпись по умолчанию.
- Срок действия КП в днях (по умолчанию 7).

## Резервное копирование БД

### Автоматический бэкап

Systemd-таймер `uv-calc-backup.timer`:

```ini
[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
```

Запускает oneshot-сервис `uv-calc-backup.service`, который вызывает `node backup.js`. Скрипт:

1. Генерирует имя `data/backups/uv-YYYY-MM-DD.db`.
2. Атомарно копирует БД через `db.backup(path)` из `better-sqlite3` (использует SQLite Online Backup API, не блокирует записи).
3. Удаляет файлы старше 30 дней (по mtime).
4. Дописывает строку в `data/backups/backup.log` (дата, размер, OK/FAIL).

`Persistent=true` гарантирует, что если сервер был выключен в 03:00, таймер сработает после старта.

### Ручной бэкап и скачивание

Раздел «Бэкап БД» в админке (доступ только админу):

- Статус-плашка: «Последний автобэкап: 28.04.2026, 03:00 — 2.3 МБ. Хранится: 28 файлов / 30».
- Список файлов: дата, тип («авто» / «ручной»), размер, кнопка «Скачать».
- Кнопка «Скачать бэкап сейчас (создать и сохранить)» — `POST /api/backups`. Создаёт файл с именем `uv-YYYY-MM-DD-HHMMSS-manual.db`, отдаёт пользователю как `Content-Disposition: attachment` и оставляет копию в папке (поэтому ничего не теряется).

Скачивание архивного файла: `GET /api/backups/:filename`.

### Восстановление

Делается вручную (операция редкая):

1. `systemctl stop uv-calc`.
2. Заменить `data/uv.db` на нужный `uv-YYYY-MM-DD.db` из бэкапа.
3. `systemctl start uv-calc`.

Снапшоты Timeweb (опция «Бэкапы 180 ₽/мес») — отдельная страховка от падения VDS целиком, дополняет (не заменяет) наш бэкап БД.

## Деплой

### Архитектура

```
[браузер] ──HTTPS──> [nginx :443] ──proxy──> [Node :3001] ──> [SQLite data/uv.db]
                          │                       │
                          │                       └──> data/pdfs/, data/uploads/, data/backups/
                          │
                          └── Let's Encrypt: calc.citi-print.ru
```

### Файлы в репозитории

- `scripts/deploy/nginx.conf` — шаблон конфига для `/etc/nginx/sites-available/calc.citi-print.ru`. `server_name`, `proxy_pass http://127.0.0.1:3001`, редирект http→https, `limit_req` на `/api/login`.
- `scripts/deploy/uv-calc.service` — systemd unit. `ExecStart=/usr/bin/node /opt/uv-calc/server.js`, `Restart=on-failure`, `EnvironmentFile=/opt/uv-calc/.env`, `User=uvcalc`, `WorkingDirectory=/opt/uv-calc`.
- `scripts/deploy/uv-calc-backup.service` — oneshot для `node backup.js`.
- `scripts/deploy/uv-calc-backup.timer` — `OnCalendar=*-*-* 03:00:00`, `Persistent=true`.
- `scripts/deploy/install.sh` — идемпотентный скрипт первой установки (создаёт пользователя `uvcalc`, ставит зависимости, копирует юниты, делает `chown`).
- `scripts/deploy/update.sh` — обновление: `git pull` + `npm ci --omit=dev` + `node migrate.js` + `systemctl restart uv-calc`.

### Переменные окружения

`/opt/uv-calc/.env` (на сервере, в git не попадает):

```
PORT=3001
NODE_ENV=production
SESSION_SECRET=<64 случайных байта, генерируется при установке>
COOKIE_SECURE=true
ADMIN_EMAIL=annaprint@mail.ru
ADMIN_PASS=<временный пароль, меняется через админку после первого логина>
```

### Первая установка (~30 минут)

1. В Timeweb DNS: A-запись `calc.citi-print.ru` → IP VDS.
2. На VDS: `apt install nginx nodejs npm certbot python3-certbot-nginx` (Node 20+).
3. `git clone` репо в `/opt/uv-calc`, создать `.env`.
4. `bash scripts/deploy/install.sh`.
5. `node seed.js` — заполняет начальные цены и создаёт первого админа.
6. `certbot --nginx -d calc.citi-print.ru` — выпускает Let's Encrypt и правит nginx.
7. `systemctl enable --now uv-calc uv-calc-backup.timer`.
8. Открыть `https://calc.citi-print.ru`, войти, сменить пароль админа.

### Регулярные обновления (~30 секунд)

```
cd /opt/uv-calc
sudo -u uvcalc bash scripts/deploy/update.sh
# git pull · npm ci · node migrate.js · systemctl restart uv-calc
```

Откат: `git checkout <previous-commit>` + `systemctl restart uv-calc`. БД не трогаем — миграции форвард-only и backward-compatible (только добавление колонок).

## Тесты

### Существующие (остаются как есть)

- `tests/calc.test.js` — расчёт листовой и сувенирной продукции.
- `tests/api.test.js` — REST для материалов, ступеней, КП.
- `tests/helpers.js` — фабрики тестовых данных.

### Изменения существующих

- `tests/api.test.js` — все запросы выполняются через залогиненную сессию (хелпер `loginAs(role)`). Тесты, которые проверяют админ-маршруты, логинятся как админ.
- `tests/helpers.js` — добавлены `createUser({ admin })`, `loginAs(client, user)`, `createClient`.

### Новые тесты

| Файл | Что покрывает |
|---|---|
| `tests/auth.test.js` | bcrypt-хеш, login/logout, expiry сессии (8ч), rate-limit (5/мин) |
| `tests/permissions.test.js` | менеджер vs админ на каждом маршруте из матрицы |
| `tests/migrate.test.js` | миграции применяются на чистой БД и поверх v1 |
| `tests/backup.test.js` | `db.backup()` создаёт валидный SQLite-файл, ротация удаляет старое |
| `tests/pdf.test.js` | `generateQuotePdf` возвращает Buffer с magic bytes `%PDF-` и размером > 5 КБ |
| `tests/users.api.test.js` | CRUD пользователей, сброс пароля, нельзя выключить себя |
| `tests/clients.api.test.js` | CRUD клиентов, поиск, привязка к КП |
| `tests/quotes-filter.api.test.js` | все фильтры, сортировки, пагинация |
| `tests/company-settings.api.test.js` | GET/PUT настроек, загрузка логотипа |
| `tests/backups.api.test.js` | список, скачать сейчас, скачать архивный |

### Что не покрываем тестами

- Конфиг nginx и systemd-юниты — проверяются вручную при первой установке.
- UI (browser-tests) — нет Puppeteer/Playwright, ручной чек-лист как раньше. Можно добавить позже.
- End-to-end через HTTPS — Supertest бьёт прямо в Express, в обход nginx/TLS. Этого достаточно для логики.

Критерий «можно деплоить»: `npm test` зелёный.

## Структура файлов после реализации

```
prices/
├── server.js              ← дополнен auth-middleware и новыми роутами
├── db.js                  ← + миграции, регистрация новых таблиц
├── calc.js                ← без изменений
├── auth.js                ← НОВОЕ: bcrypt + сессии + middleware
├── pdf.js                 ← НОВОЕ: PDFKit, генерация брендированного КП
├── backup.js              ← НОВОЕ: db.backup() + ротация
├── migrate.js             ← НОВОЕ: запускает миграции из db.js
├── seed.js                ← дополнен: первый админ из ADMIN_EMAIL/PASS
├── assets/
│   ├── fonts/DejaVuSans.ttf
│   └── logo-source.svg
├── data/
│   ├── uv.db
│   ├── backups/           ← автобэкапы и ручные
│   ├── pdfs/              ← сгенерированные КП
│   └── uploads/           ← логотип компании
├── public/
│   ├── login.html         ← НОВОЕ
│   ├── index.html         ← + модалка сохранения КП с клиентом
│   ├── admin.html         ← + разделы Пользователи, Клиенты, Настройки, Бэкап БД
│   └── js/...
├── tests/
│   ├── calc.test.js
│   ├── api.test.js
│   ├── helpers.js
│   ├── auth.test.js
│   ├── permissions.test.js
│   ├── migrate.test.js
│   ├── backup.test.js
│   ├── pdf.test.js
│   ├── users.api.test.js
│   ├── clients.api.test.js
│   ├── quotes-filter.api.test.js
│   ├── company-settings.api.test.js
│   └── backups.api.test.js
├── scripts/
│   └── deploy/
│       ├── nginx.conf
│       ├── uv-calc.service
│       ├── uv-calc-backup.service
│       ├── uv-calc-backup.timer
│       ├── install.sh
│       └── update.sh
├── package.json           ← + bcryptjs, express-session, connect-sqlite3, express-rate-limit, pdfkit, multer (уже есть)
└── docs/superpowers/specs/2026-04-28-uv-calculator-standalone-design.md
```

## Критерии готовности

1. Все юнит-/API-тесты зелёные (`npm test`).
2. Калькулятор открывается по `https://calc.citi-print.ru`, действует Let's Encrypt.
3. Авторизация работает: 6 менеджеров заведены, у одного флаг `is_admin=1`.
4. Менеджер сохраняет КП с привязкой к клиенту, скачивает брендированный PDF.
5. История КП фильтруется по всем 8 параметрам, сортируется по дате/сумме, пагинация по 50.
6. Раздел «Бэкап БД» показывает последние файлы; ручной бэкап скачивается и сохраняется.
7. Systemd-таймер сделал автобэкап в 03:00, файл появился в `data/backups/`.
8. `node migrate.js` идемпотентен (повторный запуск ничего не делает).
9. Откат через `git checkout <previous>` + `systemctl restart uv-calc` не ломает БД.
