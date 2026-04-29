# UV-калькулятор Standalone — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить локальный прототип UV-калькулятора в self-hosted продукт для 6 менеджеров типографии «Сити Принт» — с авторизацией, ролями, привязкой КП к клиентам, брендированными PDF, бэкапами и деплоем на `calc.citi-print.ru`.

**Architecture:** Расширение текущего стека Node 20 + Express 4 + better-sqlite3 + Jest без переписывания. Сессионная авторизация на `express-session` + `connect-sqlite3`, миграции форвард-only по `PRAGMA user_version`, PDF через PDFKit + DejaVu Sans, бэкапы через `db.backup()` API, деплой через nginx + systemd на Timeweb VDS.

**Tech Stack:** Node.js 20, Express 4, better-sqlite3, express-session, connect-sqlite3, bcryptjs, express-rate-limit, pdfkit, multer, Jest, Supertest, nginx, systemd, Let's Encrypt.

**Spec:** `docs/superpowers/specs/2026-04-28-uv-calculator-standalone-design.md`

**Phasing:** 8 фаз. После каждой фазы — рабочее состояние, можно остановиться на ревью.

| Фаза | Что добавит | Задачи |
|---|---|---|
| A. Миграции и пользователи | `PRAGMA user_version`, таблицы `users`/`sessions`, bcrypt | 1–4 |
| B. Авторизация и сессии | `/api/login`, middleware, rate-limit, страница логина | 5–14 |
| C. Управление пользователями | CRUD `users`, сброс пароля, UI «Пользователи» | 15–20 |
| D. Клиенты | таблица `clients`, CRUD, UI «Клиенты» | 21–24 |
| E. КП с клиентами и фильтрами | расширение `quotes`, фильтры/сортировки/пагинация | 25–31 |
| F. Брендированный PDF | `company_settings`, PDFKit-генератор, UI настроек | 32–37 |
| G. Бэкапы | `db.backup()`, ротация, UI «Бэкап БД» | 38–41 |
| H. Деплой | nginx, systemd-юниты, install/update скрипты | 42–45 |

---

## Файловая структура после реализации

```
prices/
├── server.js              ← дополнен: session middleware, requireAuth/Admin, новые роуты
├── db.js                  ← дополнен: applyMigrations(), массив migrations[]
├── auth.js                ← НОВОЕ: bcrypt-хелперы, requireAuth, requireAdmin, loginUser
├── pdf.js                 ← НОВОЕ: generateQuotePdf(quote, client, settings, user) → Buffer
├── backup.js              ← НОВОЕ: createBackup(), rotateBackups(), main() для systemd
├── migrate.js             ← НОВОЕ: тонкая обёртка `node migrate.js` для деплоя
├── seed.js                ← дополнен: создание первого админа из ADMIN_EMAIL/PASS
├── calc.js                ← без изменений
├── assets/
│   ├── fonts/DejaVuSans.ttf       ← скачивается один раз
│   └── logo-source.svg            ← из Telegram-кеша, конвертируется в logo.png
├── data/
│   ├── uv.db                      ← основная БД (production)
│   ├── sessions.db                ← connect-sqlite3 (production, отдельный файл)
│   ├── backups/                   ← uv-YYYY-MM-DD.db (авто) + …-manual.db
│   ├── pdfs/                      ← quote-{id}.pdf
│   └── uploads/logo.png
├── public/
│   ├── login.html                 ← НОВОЕ
│   ├── index.html                 ← + модалка «Сохранить КП»
│   ├── admin.html                 ← + Пользователи, Клиенты, Настройки, Бэкап БД, История КП
│   └── js/{login,calc-ui,admin}.js
├── tests/
│   ├── helpers.js                 ← + createUser, loginAs, createClient
│   ├── calc.test.js               ← без изменений
│   ├── api.test.js                ← все запросы через loginAs('admin')
│   ├── migrate.test.js            ← НОВОЕ
│   ├── auth.test.js               ← НОВОЕ
│   ├── permissions.test.js        ← НОВОЕ
│   ├── users.api.test.js          ← НОВОЕ
│   ├── clients.api.test.js        ← НОВОЕ
│   ├── quotes-filter.api.test.js  ← НОВОЕ
│   ├── company-settings.api.test.js ← НОВОЕ
│   ├── pdf.test.js                ← НОВОЕ
│   ├── backup.test.js             ← НОВОЕ
│   └── backups.api.test.js        ← НОВОЕ
├── scripts/
│   └── deploy/
│       ├── nginx.conf
│       ├── uv-calc.service
│       ├── uv-calc-backup.service
│       ├── uv-calc-backup.timer
│       ├── install.sh
│       └── update.sh
└── package.json           ← + bcryptjs, express-session, connect-sqlite3, express-rate-limit, pdfkit
```

---

# Фаза A. Миграции и таблица пользователей

## Task 1: Система миграций по PRAGMA user_version

**Files:**
- Modify: `db.js`
- Test: `tests/migrate.test.js` (NEW)

- [ ] **Step 1: Написать падающий тест миграционной системы**

Создать `tests/migrate.test.js`:

```js
// tests/migrate.test.js
const { createDb } = require('../db')

describe('migrations', () => {
  test('fresh DB ends at the latest user_version', () => {
    const db = createDb(':memory:')
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThanOrEqual(2) // как минимум v2 после Task 2
  })

  test('idempotent: running migrations twice leaves version unchanged', () => {
    const db = createDb(':memory:')
    const v1 = db.pragma('user_version', { simple: true })
    const { applyMigrations } = require('../db')
    applyMigrations(db)
    const v2 = db.pragma('user_version', { simple: true })
    expect(v2).toBe(v1)
  })
})
```

- [ ] **Step 2: Запустить тест, убедиться что не проходит**

Run: `npx jest tests/migrate.test.js`
Expected: FAIL (`applyMigrations is not a function` или версия 0)

- [ ] **Step 3: Реализовать migrations[] и applyMigrations() в db.js**

Заменить содержимое `db.js`:

```js
// db.js
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

// Migrations are forward-only. Each migration runs in its own transaction.
// To roll back, restore from a backup — see scripts/deploy and backup.js.
const migrations = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sheet_materials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          price_per_sqm REAL NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS sheet_tiers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          min_sqm REAL NOT NULL UNIQUE,
          price_per_sqm REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS souvenir_prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_type TEXT NOT NULL UNIQUE,
          qty_up_to_29 REAL NOT NULL,
          qty_from_30 REAL NOT NULL,
          qty_from_100 REAL NOT NULL,
          qty_from_500 REAL NOT NULL,
          qty_from_1000 REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS catalog_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          article TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          description TEXT,
          colors TEXT,
          photo_url TEXT,
          souvenir_price_id INTEGER REFERENCES souvenir_prices(id)
        );
        CREATE TABLE IF NOT EXISTS quotes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          type TEXT NOT NULL CHECK(type IN ('sheet','souvenir')),
          params TEXT NOT NULL,
          result TEXT NOT NULL,
          kp_text TEXT NOT NULL
        );
      `)
    }
  }
  // последующие миграции добавляются ниже в Task 2, 21, 25, 32
]

function applyMigrations(db) {
  const current = db.pragma('user_version', { simple: true })
  const pending = migrations.filter(m => m.version > current)
  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db)
      db.pragma(`user_version = ${m.version}`)
    })
    tx()
  }
}

function createDb(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, 'data', 'uv.db')
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  }
  const db = new Database(resolvedPath)
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

module.exports = { createDb, applyMigrations, migrations }
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `npx jest tests/migrate.test.js`
Expected: PASS (`fresh DB ends at the latest user_version`, `idempotent` — обе зелёные).

Запустить весь набор: `npm test`. Expected: всё зелёное (старые тесты `calc.test.js`, `api.test.js` продолжают работать, потому что v1 содержит ту же схему).

- [ ] **Step 5: Закоммитить**

```bash
git add db.js tests/migrate.test.js
git commit -m "feat(db): forward-only migrations via PRAGMA user_version"
```

---

## Task 2: Миграция v2 — таблицы users и sessions, quotes.user_id

**Files:**
- Modify: `db.js` (добавить миграцию v2 в массив)
- Test: `tests/migrate.test.js`

- [ ] **Step 1: Написать падающие тесты для v2**

Дополнить `tests/migrate.test.js`:

```js
describe('migration v2 — users + sessions', () => {
  test('creates users table with required columns', () => {
    const db = require('../db').createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(
      ['id','email','password_hash','full_name','is_admin','is_active','created_at']
    ))
  })

  test('creates sessions table with sid/expired/sess columns', () => {
    const db = require('../db').createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['sid','expired','sess']))
  })

  test('adds quotes.user_id column referencing users(id)', () => {
    const db = require('../db').createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('user_id')
  })

  test('users.email is UNIQUE', () => {
    const db = require('../db').createDb(':memory:')
    db.prepare("INSERT INTO users (email,password_hash,full_name) VALUES (?,?,?)")
      .run('a@b.c', 'x', 'A')
    expect(() =>
      db.prepare("INSERT INTO users (email,password_hash,full_name) VALUES (?,?,?)")
        .run('a@b.c', 'y', 'B')
    ).toThrow(/UNIQUE/)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npx jest tests/migrate.test.js`
Expected: FAIL (`no such table: users`).

- [ ] **Step 3: Добавить миграцию v2 в массив `migrations` в db.js**

После объекта `version: 1` дописать:

```js
,
{
  version: 2,
  up: (db) => {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- Схема таблицы для connect-sqlite3 (он создаст её сам, но мы делаем явно
      -- чтобы тесты могли проверять структуру и чтобы юзер_id миграции был чист)
      CREATE TABLE sessions (
        sid TEXT PRIMARY KEY,
        expired INTEGER NOT NULL,
        sess TEXT NOT NULL
      );
      ALTER TABLE quotes ADD COLUMN user_id INTEGER REFERENCES users(id);
    `)
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: всё зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add db.js tests/migrate.test.js
git commit -m "feat(db): migration v2 — users, sessions, quotes.user_id"
```

---

## Task 3: bcryptjs + хелперы хеширования паролей

**Files:**
- Create: `auth.js`
- Test: `tests/auth.test.js` (NEW)
- Modify: `package.json`

- [ ] **Step 1: Установить bcryptjs**

Run:
```bash
npm install bcryptjs
```

Expected: `package.json` обновлён (новая зависимость), `package-lock.json` обновлён, `node_modules/bcryptjs/` появился.

- [ ] **Step 2: Написать падающий тест**

Создать `tests/auth.test.js`:

```js
// tests/auth.test.js
const { hashPassword, verifyPassword } = require('../auth')

describe('password hashing', () => {
  test('hashPassword returns a non-empty string different from input', async () => {
    const hash = await hashPassword('secret123')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(20)
    expect(hash).not.toBe('secret123')
  })

  test('verifyPassword returns true for matching password', async () => {
    const hash = await hashPassword('secret123')
    expect(await verifyPassword('secret123', hash)).toBe(true)
  })

  test('verifyPassword returns false for wrong password', async () => {
    const hash = await hashPassword('secret123')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})
```

- [ ] **Step 3: Запустить, убедиться что падает**

Run: `npx jest tests/auth.test.js`
Expected: FAIL (`Cannot find module '../auth'`).

- [ ] **Step 4: Создать `auth.js` с bcrypt-хелперами**

```js
// auth.js
const bcrypt = require('bcryptjs')

const SALT_ROUNDS = 10

async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS)
}

async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash)
}

module.exports = { hashPassword, verifyPassword }
```

- [ ] **Step 5: Запустить тест, убедиться что проходит**

Run: `npx jest tests/auth.test.js`
Expected: PASS (3 теста).

- [ ] **Step 6: Закоммитить**

```bash
git add auth.js tests/auth.test.js package.json package-lock.json
git commit -m "feat(auth): bcryptjs password hashing helpers"
```

---

## Task 4: Первый админ создаётся seed.js из ADMIN_EMAIL/PASS

**Files:**
- Modify: `seed.js`
- Test: `tests/seed.test.js` (NEW)

- [ ] **Step 1: Написать падающий тест**

Создать `tests/seed.test.js`:

```js
// tests/seed.test.js
const { createDb } = require('../db')
const { ensureFirstAdmin } = require('../seed')

describe('ensureFirstAdmin', () => {
  test('creates admin user from email and password', async () => {
    const db = createDb(':memory:')
    await ensureFirstAdmin(db, { email: 'a@b.c', password: 'p' , fullName: 'Anna' })
    const u = db.prepare('SELECT * FROM users WHERE email=?').get('a@b.c')
    expect(u).toBeDefined()
    expect(u.is_admin).toBe(1)
    expect(u.is_active).toBe(1)
    expect(u.password_hash).not.toBe('p') // должен быть bcrypt-хеш
  })

  test('idempotent: second call does not create duplicate', async () => {
    const db = createDb(':memory:')
    await ensureFirstAdmin(db, { email: 'a@b.c', password: 'p1', fullName: 'A' })
    await ensureFirstAdmin(db, { email: 'a@b.c', password: 'p2', fullName: 'A' })
    const count = db.prepare('SELECT COUNT(*) as c FROM users WHERE email=?').get('a@b.c').c
    expect(count).toBe(1)
  })

  test('throws if email or password missing', async () => {
    const db = createDb(':memory:')
    await expect(ensureFirstAdmin(db, {})).rejects.toThrow(/email/)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `npx jest tests/seed.test.js`
Expected: FAIL (`ensureFirstAdmin is not a function`).

- [ ] **Step 3: Дополнить seed.js функцией ensureFirstAdmin + экспортами**

Заменить `seed.js`:

```js
// seed.js
const { createDb } = require('./db')
const { hashPassword } = require('./auth')

async function ensureFirstAdmin(db, opts) {
  const { email, password, fullName } = opts || {}
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASS are required')
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email)
  if (existing) return
  const hash = await hashPassword(password)
  db.prepare(
    'INSERT INTO users (email, password_hash, full_name, is_admin, is_active) VALUES (?,?,?,1,1)'
  ).run(email, hash, fullName || email)
}

function seedPrices(db) {
  db.prepare('DELETE FROM sheet_materials').run()
  db.prepare('DELETE FROM sheet_tiers').run()
  db.prepare('DELETE FROM souvenir_prices').run()

  const insertMat = db.prepare('INSERT INTO sheet_materials (name, price_per_sqm) VALUES (?, ?)')
  insertMat.run('Картон',         2000)
  insertMat.run('Пенокартон',     3700)
  insertMat.run('Пластик 5 мм',   5900)
  insertMat.run('Алюмокомпозит', 11000)
  insertMat.run('Оргстекло',     12000)

  const insertTier = db.prepare('INSERT INTO sheet_tiers (min_sqm, price_per_sqm) VALUES (?, ?)')
  insertTier.run(0,   800)
  insertTier.run(5,   650)
  insertTier.run(20,  500)
  insertTier.run(50,  380)
  insertTier.run(100, 280)

  const insertSouv = db.prepare(
    'INSERT INTO souvenir_prices (product_type,qty_up_to_29,qty_from_30,qty_from_100,qty_from_500,qty_from_1000) VALUES (?,?,?,?,?,?)'
  )
  insertSouv.run('Ручки (белый пластик)',     1500, 45,  29,  20,  14)
  insertSouv.run('Ручки (цветной пластик)',   1800, 55,  36,  24,  17)
  insertSouv.run('Ручки (металл/soft-touch)', 2200, 70,  46,  31,  22)
  insertSouv.run('Ежедневник А5',            5500, 203, 159, 116,  87)
  insertSouv.run('Ежедневник А4',            6500, 239, 203, 151, 113)
  insertSouv.run('Power Bank',               2500, 80,  55,  38,  27)
  insertSouv.run('Флешка',                   2000, 65,  42,  29,  20)
  insertSouv.run('Термокружка',              3000, 95,  68,  47,  33)
}

async function main() {
  const db = createDb()
  seedPrices(db)
  await ensureFirstAdmin(db, {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASS,
    fullName: process.env.ADMIN_NAME || 'Admin'
  })
  console.log('Seed complete.')
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1) })
}

module.exports = { ensureFirstAdmin, seedPrices }
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: всё зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add seed.js tests/seed.test.js
git commit -m "feat(seed): create first admin from ADMIN_EMAIL/PASS env vars"
```

---

# Фаза B. Авторизация и сессии

## Task 5: express-session + connect-sqlite3, session middleware в server.js

**Files:**
- Modify: `server.js`
- Modify: `auth.js`
- Modify: `package.json`

- [ ] **Step 1: Установить зависимости**

Run:
```bash
npm install express-session connect-sqlite3
```

Expected: `package.json` обновлён.

- [ ] **Step 2: Добавить factory для session middleware в auth.js**

Добавить в `auth.js`:

```js
const session = require('express-session')

function buildSessionMiddleware({ secret, dbPath, cookieSecure, isTest }) {
  const store = isTest
    ? undefined // express-session falls back to MemoryStore (для тестов)
    : new (require('connect-sqlite3')(session))({
        db: 'sessions.db',
        dir: require('path').dirname(dbPath || 'data/uv.db')
      })
  return session({
    store,
    secret: secret || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: !!cookieSecure,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000 // 8 часов
    }
  })
}

module.exports = { hashPassword, verifyPassword, buildSessionMiddleware }
```

- [ ] **Step 3: Подключить middleware в server.js**

В `server.js` после `app.use(express.json())` добавить:

```js
const { buildSessionMiddleware } = require('./auth')
app.use(buildSessionMiddleware({
  secret: process.env.SESSION_SECRET,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  isTest: process.env.NODE_ENV === 'test'
}))
```

В `tests/api.test.js` дописать в `beforeEach` перед `require('../server')`:

```js
process.env.NODE_ENV = 'test'
```

- [ ] **Step 4: Запустить старый набор тестов**

Run: `npm test`
Expected: старые тесты по-прежнему зелёные (роуты ещё не защищены, поэтому всё работает; сессионная cookie выставляется, но не проверяется).

- [ ] **Step 5: Закоммитить**

```bash
git add server.js auth.js package.json package-lock.json tests/api.test.js
git commit -m "feat(auth): session middleware via express-session + connect-sqlite3"
```

---

## Task 6: POST /api/login и POST /api/logout

**Files:**
- Modify: `auth.js`
- Modify: `server.js`
- Modify: `tests/auth.test.js`

- [ ] **Step 1: Написать падающие тесты для login/logout**

Дописать в `tests/auth.test.js`:

```js
const request = require('supertest')
const { makeTestDb } = require('./helpers')

describe('POST /api/login', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    db = makeTestDb()
    const { hashPassword } = require('../auth')
    db.prepare('INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,1,1)')
      .run('a@b.c', await hashPassword('p'), 'Anna')
    db.prepare('INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,0,0)')
      .run('inactive@b.c', await hashPassword('p'), 'Off')
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
  })

  test('returns 200 and sets session cookie on correct credentials', async () => {
    const res = await agent.post('/api/login').send({ email: 'a@b.c', password: 'p' })
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('a@b.c')
    expect(res.body.user.is_admin).toBe(1)
    expect(res.headers['set-cookie']?.[0]).toMatch(/connect\.sid/)
  })

  test('returns 401 on wrong password', async () => {
    const res = await agent.post('/api/login').send({ email: 'a@b.c', password: 'WRONG' })
    expect(res.status).toBe(401)
  })

  test('returns 401 on inactive user', async () => {
    const res = await agent.post('/api/login').send({ email: 'inactive@b.c', password: 'p' })
    expect(res.status).toBe(401)
  })

  test('returns 401 on unknown email', async () => {
    const res = await agent.post('/api/login').send({ email: 'nope@b.c', password: 'p' })
    expect(res.status).toBe(401)
  })

  test('POST /api/logout clears session', async () => {
    await agent.post('/api/login').send({ email: 'a@b.c', password: 'p' })
    const res = await agent.post('/api/logout')
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npx jest tests/auth.test.js`
Expected: FAIL (404 Not Found на /api/login).

- [ ] **Step 3: Реализовать loginUser в auth.js + роуты в server.js**

Дописать в `auth.js` (перед module.exports):

```js
async function loginUser(db, email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email)
  if (!user || !user.is_active) return null
  const ok = await verifyPassword(password, user.password_hash)
  return ok ? user : null
}

module.exports = { hashPassword, verifyPassword, buildSessionMiddleware, loginUser }
```

В `server.js` перед `// ── Sheet Materials` добавить:

```js
const { loginUser } = require('./auth')

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'email and password required' })
  const user = await loginUser(db, email, password)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  req.session.userId = user.id
  res.json({ user: { id: user.id, email: user.email, full_name: user.full_name, is_admin: user.is_admin } })
})

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: всё зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add server.js auth.js tests/auth.test.js
git commit -m "feat(auth): POST /api/login and /api/logout"
```

---

## Task 7: Middleware requireAuth, requireAdmin + проверка is_active

**Files:**
- Modify: `auth.js`
- Modify: `server.js`
- Modify: `tests/auth.test.js` (или новый `tests/permissions.test.js`)

- [ ] **Step 1: Написать падающие тесты доступа**

Создать `tests/permissions.test.js`:

```js
// tests/permissions.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers') // helpers расширяются в Task 9

describe('route gating', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    db = makeTestDb()
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
  })

  test('GET / redirects to /login when not authenticated', async () => {
    const res = await agent.get('/')
    expect([302, 303]).toContain(res.status)
    expect(res.headers.location).toBe('/login')
  })

  test('POST /api/calc/sheet returns 401 without session', async () => {
    const res = await agent.post('/api/calc/sheet').send({})
    expect(res.status).toBe(401)
  })

  test('returns 403 on admin route for manager', async () => {
    await createUser(db, { email: 'm@b.c', password: 'p', isAdmin: false })
    await loginAs(agent, 'm@b.c', 'p')
    const res = await agent.post('/api/materials').send({ name: 'X', price_per_sqm: 1 })
    expect(res.status).toBe(403)
  })

  test('returns 200 on admin route for admin', async () => {
    await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    await loginAs(agent, 'a@b.c', 'p')
    const res = await agent.post('/api/materials').send({ name: 'Y', price_per_sqm: 2 })
    expect(res.status).toBe(201)
  })

  test('deactivated user is logged out on next request', async () => {
    const u = await createUser(db, { email: 'm@b.c', password: 'p', isAdmin: false })
    await loginAs(agent, 'm@b.c', 'p')
    db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(u.id)
    const res = await agent.get('/api/materials')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npx jest tests/permissions.test.js`
Expected: FAIL (helpers ещё не существуют, но в Task 9 они появляются. **Этот шаг — placeholder; идёт в паре с Task 9.** В порядке выполнения сначала идёт Task 9 ниже, потом Task 7 — но логически requireAuth должен появиться раньше).

**Альтернативный порядок:** делать Task 9 (helpers) **первым**, потом Task 7. Я перенумеровываю мысленно, но физически: сначала Task 9, потом Task 7. Чтобы не путать читателя, ниже Task 7 предполагает, что хелперы из Task 9 уже добавлены.

- [ ] **Step 3: Дописать middleware в auth.js**

```js
function loadUser(db) {
  return (req, res, next) => {
    if (!req.session.userId) return next()
    const u = db.prepare('SELECT id,email,full_name,is_admin,is_active FROM users WHERE id=?')
      .get(req.session.userId)
    if (!u || !u.is_active) {
      req.session.destroy(() => {})
      return next()
    }
    req.user = u
    next()
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.accepts(['html','json']) === 'html') return res.redirect('/login')
    return res.status(401).json({ error: 'Auth required' })
  }
  next()
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Auth required' })
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' })
  next()
}

module.exports = { hashPassword, verifyPassword, buildSessionMiddleware, loginUser, loadUser, requireAuth, requireAdmin }
```

- [ ] **Step 4: Подключить middleware в server.js**

После session middleware:

```js
const { loadUser, requireAuth, requireAdmin } = require('./auth')
app.use(loadUser(db))
```

И навесить `requireAuth` / `requireAdmin` на все роуты по матрице доступа из спеки. Конкретно:

- На `app.get('/api/materials' …)` и т.д. (read-only) — `requireAuth`.
- На `app.post/put/delete('/api/materials' …)`, `/api/sheet-tiers`, `/api/souvenir-prices`, `/api/catalog/import`, `app.put('/api/catalog/:id/price-type')` — `requireAdmin`.
- На `app.post/get/delete('/api/quotes' …)`, `app.post('/api/calc/* …)` — `requireAuth`.

Пример замены:

```js
// было:
app.get('/api/materials', (req, res) => {…})
// стало:
app.get('/api/materials', requireAuth, (req, res) => {…})

// было:
app.post('/api/materials', (req, res) => {…})
// стало:
app.post('/api/materials', requireAdmin, (req, res) => {…})
```

Также добавить gate для `/` и `/admin.html`:

```js
app.get(['/', '/index.html'], (req, res, next) => {
  if (!req.user) return res.redirect('/login')
  next()
}, express.static(path.join(__dirname, 'public')))

app.get('/admin.html', (req, res) => {
  if (!req.user) return res.redirect('/login')
  if (!req.user.is_admin) return res.status(403).send('Admin only')
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})
```

И поднять `app.use(express.static(…))` ПОСЛЕ всех html-gate-роутов или вынести его, чтобы static не отдавал `/index.html` без проверки. Вариант: явно зарегистрировать `app.get('/login', …)` и `app.use('/js', express.static(…))`, а корневой `/` сделать защищённым.

Простейший рабочий вариант — оставить `express.static` в самом конце цепочки и обработать только корень:

```js
app.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login')
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
})

app.use(express.static(path.join(__dirname, 'public'), { index: false }))
```

- [ ] **Step 5: Запустить тесты**

Run: `npm test`
Expected: `permissions.test.js` зелёный. **Старый `api.test.js` упадёт** — он бьёт защищённые роуты без логина. Это ОК, мы починим его в Task 10.

- [ ] **Step 6: Закоммитить (api.test.js сломан, починим следующим коммитом)**

```bash
git add server.js auth.js tests/permissions.test.js
git commit -m "feat(auth): requireAuth, requireAdmin middleware + route gating"
```

---

## Task 8 (= 9 в порядке выполнения): Хелперы тестов — createUser, loginAs

**Files:**
- Modify: `tests/helpers.js`

> **Этот таск нужно выполнить первым в Фазе B**, до Task 7 — иначе тесты пермишенов нечем писать. Сделай его до Task 7.

- [ ] **Step 1: Написать падающий тест helpers.js**

Дополнить `tests/helpers.js` или создать `tests/helpers.test.js`:

```js
// tests/helpers.test.js
const { makeTestDb, createUser, loginAs } = require('./helpers')
const request = require('supertest')

describe('test helpers', () => {
  test('createUser inserts user with hashed password', async () => {
    const db = makeTestDb()
    const u = await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    expect(u.id).toBeDefined()
    expect(u.email).toBe('a@b.c')
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(u.id)
    expect(row.password_hash).not.toBe('p')
    expect(row.is_admin).toBe(1)
  })

  test('loginAs returns authenticated agent', async () => {
    process.env.NODE_ENV = 'test'
    const db = makeTestDb()
    await createUser(db, { email: 'a@b.c', password: 'p', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    const { app } = require('../server')
    const agent = request.agent(app)
    const res = await loginAs(agent, 'a@b.c', 'p')
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npx jest tests/helpers.test.js`
Expected: FAIL (`createUser is not a function`).

- [ ] **Step 3: Расширить tests/helpers.js**

```js
// tests/helpers.js
const { createDb } = require('../db')
const { hashPassword } = require('../auth')

function makeTestDb() {
  return createDb(':memory:')
}

async function createUser(db, opts) {
  const { email, password, fullName = 'Test', isAdmin = false, isActive = true } = opts
  const hash = await hashPassword(password)
  const info = db.prepare(
    'INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,?,?)'
  ).run(email, hash, fullName, isAdmin ? 1 : 0, isActive ? 1 : 0)
  return { id: info.lastInsertRowid, email, full_name: fullName, is_admin: isAdmin ? 1 : 0 }
}

async function loginAs(agent, email, password) {
  return agent.post('/api/login').send({ email, password })
}

async function createClient(db, opts = {}) {
  const { name = 'Test Client', contact_person = null, phone = null, email = null } = opts
  const info = db.prepare(
    'INSERT INTO clients (name,contact_person,phone,email) VALUES (?,?,?,?)'
  ).run(name, contact_person, phone, email)
  return db.prepare('SELECT * FROM clients WHERE id=?').get(info.lastInsertRowid)
}

module.exports = { makeTestDb, createUser, loginAs, createClient }
```

> Замечание: `createClient` будет использоваться позже, в Фазе D. Можно добавить уже сейчас — функция короткая.

- [ ] **Step 4: Запустить тесты**

Run: `npx jest tests/helpers.test.js`
Expected: PASS (но `loginAs` test может потребовать, чтобы сначала был сделан Task 5+6; убедись что они уже готовы).

- [ ] **Step 5: Закоммитить**

```bash
git add tests/helpers.js tests/helpers.test.js
git commit -m "test: helpers — createUser, loginAs, createClient"
```

---

## Task 9 (= 10): Обновить существующий api.test.js под loginAs(admin)

**Files:**
- Modify: `tests/api.test.js`

- [ ] **Step 1: Переписать api.test.js, чтобы все запросы шли через залогиненного админа**

Заменить начало `tests/api.test.js`:

```js
// tests/api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('database schema', () => {
  test('creates all required tables', () => {
    const db = makeTestDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(r => r.name)
    expect(tables).toContain('sheet_materials')
    expect(tables).toContain('sheet_tiers')
    expect(tables).toContain('souvenir_prices')
    expect(tables).toContain('catalog_items')
    expect(tables).toContain('quotes')
    expect(tables).toContain('users')
    expect(tables).toContain('sessions')
  })
})

let app, db, agent

beforeEach(async () => {
  process.env.NODE_ENV = 'test'
  db = makeTestDb()
  await createUser(db, { email: 'admin@test', password: 'p', isAdmin: true })
  jest.resetModules()
  jest.doMock('../db', () => ({ createDb: () => db }))
  app = require('../server').app
  agent = request.agent(app)
  await loginAs(agent, 'admin@test', 'p')
})
```

И заменить все `request(app)` на `agent` ниже. Например:

```js
// было:
const res = await request(app).get('/api/materials')
// стало:
const res = await agent.get('/api/materials')
```

И т.д. для всех 20+ мест.

- [ ] **Step 2: Запустить тесты**

Run: `npm test`
Expected: всё зелёное (api.test.js, auth.test.js, permissions.test.js, helpers.test.js, migrate.test.js, calc.test.js, seed.test.js).

- [ ] **Step 3: Закоммитить**

```bash
git add tests/api.test.js
git commit -m "test: existing API tests run as authenticated admin"
```

---

## Task 10 (= 11): Rate-limit на /api/login

**Files:**
- Modify: `server.js`
- Modify: `package.json`
- Modify: `tests/auth.test.js`

- [ ] **Step 1: Установить express-rate-limit**

Run:
```bash
npm install express-rate-limit
```

- [ ] **Step 2: Написать падающий тест rate-limit**

Дописать в `tests/auth.test.js`:

```js
describe('rate-limit on /api/login', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    db = makeTestDb()
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
  })

  test('returns 429 after 5 failed attempts within a minute', async () => {
    for (let i = 0; i < 5; i++) {
      await agent.post('/api/login').send({ email: 'x@b.c', password: 'wrong' })
    }
    const res = await agent.post('/api/login').send({ email: 'x@b.c', password: 'wrong' })
    expect(res.status).toBe(429)
  })
})
```

- [ ] **Step 3: Запустить, убедиться что падает**

Run: `npx jest tests/auth.test.js -t rate-limit`
Expected: FAIL (получает 401, а не 429).

- [ ] **Step 4: Подключить rate-limit в server.js**

В `server.js` после session middleware:

```js
const rateLimit = require('express-rate-limit')

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate-limit in tests, кроме теста rate-limit. Простейший способ — выключить
  // через ENV-флаг и включить только когда он не установлен:
  skip: () => process.env.DISABLE_RATE_LIMIT === 'true'
})

app.post('/api/login', loginLimiter, async (req, res) => { /* существующая реализация */ })
```

В `tests/api.test.js` и других тестах, где много логинов, можно установить `process.env.DISABLE_RATE_LIMIT = 'true'` в `beforeEach` (а в `tests/auth.test.js -t rate-limit` — НЕ устанавливать).

- [ ] **Step 5: Запустить тесты**

Run: `npm test`
Expected: всё зелёное.

- [ ] **Step 6: Закоммитить**

```bash
git add server.js package.json package-lock.json tests/auth.test.js
git commit -m "feat(auth): rate-limit /api/login (5/min) via express-rate-limit"
```

---

## Task 11 (= 12): /api/users/me + смена своего пароля

**Files:**
- Modify: `server.js`
- Test: `tests/users.api.test.js` (NEW)

- [ ] **Step 1: Написать падающие тесты**

Создать `tests/users.api.test.js`:

```js
// tests/users.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('GET /api/users/me', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'a@b.c', password: 'p', fullName: 'Anna', isAdmin: false })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
    await loginAs(agent, 'a@b.c', 'p')
  })

  test('returns current user', async () => {
    const res = await agent.get('/api/users/me')
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('a@b.c')
    expect(res.body.full_name).toBe('Anna')
    expect(res.body.password_hash).toBeUndefined()
  })

  test('POST /api/users/me/change-password updates password', async () => {
    const res = await agent.post('/api/users/me/change-password')
      .send({ old_password: 'p', new_password: 'newpass' })
    expect(res.status).toBe(200)
    // re-login с новым паролем
    const agent2 = request.agent(app)
    const r = await loginAs(agent2, 'a@b.c', 'newpass')
    expect(r.status).toBe(200)
  })

  test('change-password rejects wrong old password', async () => {
    const res = await agent.post('/api/users/me/change-password')
      .send({ old_password: 'WRONG', new_password: 'newpass' })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npx jest tests/users.api.test.js`
Expected: FAIL (404).

- [ ] **Step 3: Реализовать роуты**

В `server.js` (рядом с `/api/login`):

```js
const { hashPassword, verifyPassword } = require('./auth')

app.get('/api/users/me', requireAuth, (req, res) => {
  res.json(req.user)
})

app.post('/api/users/me/change-password', requireAuth, async (req, res) => {
  const { old_password, new_password } = req.body || {}
  if (!old_password || !new_password) return res.status(400).json({ error: 'old_password and new_password required' })
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id)
  if (!await verifyPassword(old_password, row.password_hash)) {
    return res.status(400).json({ error: 'Wrong old password' })
  }
  const hash = await hashPassword(new_password)
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.user.id)
  res.json({ ok: true })
})
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add server.js tests/users.api.test.js
git commit -m "feat(api): GET /users/me, POST /users/me/change-password"
```

---

## Task 12 (= 13): /login страница (HTML + JS)

**Files:**
- Create: `public/login.html`
- Create: `public/js/login.js`

- [ ] **Step 1: Создать public/login.html**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Вход — UV-калькулятор</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; background: #f5f5f5; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
    form { background:#fff; padding:32px; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.1); width:320px; }
    h1 { margin:0 0 16px; font-size:20px; }
    label { display:block; margin:12px 0 4px; }
    input { width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box; }
    button { margin-top:16px; width:100%; padding:10px; border:0; border-radius:4px; background:#0066cc; color:#fff; font-size:14px; cursor:pointer; }
    .err { color:#c00; margin-top:8px; min-height:1em; font-size:13px; }
  </style>
</head>
<body>
  <form id="login-form">
    <h1>Вход в калькулятор</h1>
    <label>Email <input name="email" type="email" required autofocus></label>
    <label>Пароль <input name="password" type="password" required></label>
    <button type="submit">Войти</button>
    <div class="err" id="err"></div>
  </form>
  <script src="/js/login.js"></script>
</body>
</html>
```

- [ ] **Step 2: Создать public/js/login.js**

```js
// public/js/login.js
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const fd = new FormData(e.target)
  const err = document.getElementById('err')
  err.textContent = ''
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
    })
    if (res.ok) {
      window.location.href = '/'
    } else if (res.status === 429) {
      err.textContent = 'Слишком много попыток. Подождите минуту.'
    } else {
      err.textContent = 'Неверный email или пароль.'
    }
  } catch (e) {
    err.textContent = 'Ошибка сети. Попробуйте ещё раз.'
  }
})
```

- [ ] **Step 3: Ручная проверка**

Run: `npm start` (в одном терминале), открыть `http://localhost:3001/login` в браузере. Логин с правильными/неправильными creds работает (использовать тестового пользователя из seed.js, либо `node -e "require('./seed').main()" ADMIN_EMAIL=a@b.c ADMIN_PASS=p`).

Expected: вход → редирект на `/`. Неверные креды → красная ошибка.

- [ ] **Step 4: Закоммитить**

```bash
git add public/login.html public/js/login.js
git commit -m "feat(ui): login page"
```

---

## Task 13 (= 14): Кнопка «Выйти» в шапке index.html и admin.html + смена своего пароля

**Files:**
- Modify: `public/index.html`
- Modify: `public/admin.html`
- Modify: `public/js/calc-ui.js` (или новый общий `public/js/header.js`)

- [ ] **Step 1: Создать public/js/header.js**

```js
// public/js/header.js — общий код шапки
async function initHeader() {
  const me = await fetch('/api/users/me').then(r => r.json())
  document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = me.full_name)
  document.querySelectorAll('[data-logout]').forEach(el => {
    el.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST' })
      window.location.href = '/login'
    })
  })
  document.querySelectorAll('[data-change-password]').forEach(el => {
    el.addEventListener('click', () => {
      const oldP = prompt('Старый пароль:')
      if (!oldP) return
      const newP = prompt('Новый пароль:')
      if (!newP) return
      const newP2 = prompt('Повторите новый пароль:')
      if (newP !== newP2) { alert('Пароли не совпадают'); return }
      fetch('/api/users/me/change-password', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ old_password: oldP, new_password: newP })
      }).then(r => alert(r.ok ? 'Пароль обновлён' : 'Ошибка: проверьте старый пароль'))
    })
  })
}
document.addEventListener('DOMContentLoaded', initHeader)
```

- [ ] **Step 2: Подключить header.js в index.html и admin.html**

В каждом из них в `<head>` или перед `</body>` добавить `<script src="/js/header.js"></script>` и вверху страницы — секцию шапки:

```html
<header class="top">
  <span data-user-name>—</span>
  <button data-change-password>Сменить пароль</button>
  <button data-logout>Выйти</button>
</header>
```

- [ ] **Step 3: Ручная проверка**

Запустить, открыть `/`, увидеть имя пользователя в шапке. Нажать «Выйти» → редирект на `/login`.

- [ ] **Step 4: Закоммитить**

```bash
git add public/js/header.js public/index.html public/admin.html
git commit -m "feat(ui): header with user name, logout, change password"
```

---

# Фаза C. Управление пользователями (только админ)

## Task 14 (= 15): API CRUD для users

**Files:**
- Modify: `server.js`
- Modify: `tests/users.api.test.js`

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/users.api.test.js`:

```js
describe('admin user management', () => {
  let app, db, agent
  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    await createUser(db, { email: 'admin@b.c', password: 'p', isAdmin: true })
    jest.resetModules()
    jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app)
    await loginAs(agent, 'admin@b.c', 'p')
  })

  test('POST /api/users creates a new user', async () => {
    const res = await agent.post('/api/users').send({
      email: 'new@b.c', password: 'pp', full_name: 'New', is_admin: 0
    })
    expect(res.status).toBe(201)
    expect(res.body.email).toBe('new@b.c')
    expect(res.body.password_hash).toBeUndefined()
  })

  test('GET /api/users lists users sorted by full_name', async () => {
    await agent.post('/api/users').send({ email: 'b@b.c', password: 'p', full_name: 'Boris' })
    await agent.post('/api/users').send({ email: 'a@b.c', password: 'p', full_name: 'Anna' })
    const res = await agent.get('/api/users')
    expect(res.body.length).toBeGreaterThanOrEqual(3)
    const names = res.body.map(u => u.full_name)
    expect(names.indexOf('Anna')).toBeLessThan(names.indexOf('Boris'))
  })

  test('PUT /api/users/:id updates full_name and is_admin', async () => {
    const c = await agent.post('/api/users').send({ email:'x@b.c', password:'p', full_name:'X' })
    const r = await agent.put(`/api/users/${c.body.id}`).send({ full_name: 'XX', is_admin: 1 })
    expect(r.status).toBe(200)
    expect(r.body.full_name).toBe('XX')
    expect(r.body.is_admin).toBe(1)
  })

  test('POST /api/users/:id/reset-password sets new hash', async () => {
    const c = await agent.post('/api/users').send({ email:'x@b.c', password:'p', full_name:'X' })
    const r = await agent.post(`/api/users/${c.body.id}/reset-password`).send({ new_password: 'reset!' })
    expect(r.status).toBe(200)
    const a2 = request.agent(app)
    expect((await loginAs(a2, 'x@b.c', 'reset!')).status).toBe(200)
  })

  test('PUT /api/users/:id/active toggles is_active', async () => {
    const c = await agent.post('/api/users').send({ email:'x@b.c', password:'p', full_name:'X' })
    const r = await agent.put(`/api/users/${c.body.id}/active`).send({ is_active: 0 })
    expect(r.status).toBe(200)
    expect(r.body.is_active).toBe(0)
  })

  test('cannot deactivate self', async () => {
    const me = (await agent.get('/api/users/me')).body
    const r = await agent.put(`/api/users/${me.id}/active`).send({ is_active: 0 })
    expect(r.status).toBe(400)
  })

  test('manager cannot access /api/users', async () => {
    const m = request.agent(app)
    await createUser(db, { email: 'mgr@b.c', password: 'p', isAdmin: false })
    await loginAs(m, 'mgr@b.c', 'p')
    expect((await m.get('/api/users')).status).toBe(403)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npx jest tests/users.api.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализовать роуты в server.js**

```js
// ── Users (admin) ─────────────────────────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,email,full_name,is_admin,is_active,created_at FROM users ORDER BY full_name').all())
})

app.post('/api/users', requireAdmin, async (req, res) => {
  const { email, password, full_name, is_admin = 0 } = req.body || {}
  if (!email || !password || !full_name) return res.status(400).json({ error: 'email, password, full_name required' })
  const dup = db.prepare('SELECT id FROM users WHERE email=?').get(email)
  if (dup) return res.status(409).json({ error: 'Email already exists' })
  const hash = await hashPassword(password)
  const info = db.prepare(
    'INSERT INTO users (email,password_hash,full_name,is_admin,is_active) VALUES (?,?,?,?,1)'
  ).run(email, hash, full_name, is_admin ? 1 : 0)
  res.status(201).json(db.prepare('SELECT id,email,full_name,is_admin,is_active FROM users WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const { full_name, is_admin } = req.body || {}
  db.prepare('UPDATE users SET full_name=COALESCE(?,full_name), is_admin=COALESCE(?,is_admin) WHERE id=?')
    .run(full_name ?? null, is_admin == null ? null : (is_admin ? 1 : 0), req.params.id)
  const u = db.prepare('SELECT id,email,full_name,is_admin,is_active FROM users WHERE id=?').get(req.params.id)
  if (!u) return res.status(404).json({ error: 'Not found' })
  res.json(u)
})

app.post('/api/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { new_password } = req.body || {}
  if (!new_password) return res.status(400).json({ error: 'new_password required' })
  const hash = await hashPassword(new_password)
  const info = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.params.id)
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.put('/api/users/:id/active', requireAdmin, (req, res) => {
  const { is_active } = req.body || {}
  if (Number(req.params.id) === req.user.id && !is_active) {
    return res.status(400).json({ error: 'Cannot deactivate self' })
  }
  db.prepare('UPDATE users SET is_active=? WHERE id=?').run(is_active ? 1 : 0, req.params.id)
  const u = db.prepare('SELECT id,email,full_name,is_admin,is_active FROM users WHERE id=?').get(req.params.id)
  if (!u) return res.status(404).json({ error: 'Not found' })
  res.json(u)
})
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add server.js tests/users.api.test.js
git commit -m "feat(api): admin user management — CRUD, reset password, toggle active"
```

---

## Task 15 (= 20): UI «Пользователи» в admin.html

**Files:**
- Modify: `public/admin.html`
- Modify: `public/js/admin.js`

- [ ] **Step 1: Добавить таб «Пользователи» в admin.html**

В секции с табами добавить:

```html
<button data-tab="users">Пользователи</button>
…
<section id="tab-users" hidden>
  <h2>Пользователи</h2>
  <button id="user-create">+ Добавить</button>
  <table id="users-table">
    <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Активен</th><th></th></tr></thead>
    <tbody></tbody>
  </table>
</section>
```

- [ ] **Step 2: Дополнить admin.js логикой Users**

Добавить функции:

```js
// public/js/admin.js — добавить
async function loadUsers() {
  const users = await fetch('/api/users').then(r => r.json())
  const tbody = document.querySelector('#users-table tbody')
  tbody.innerHTML = ''
  users.forEach(u => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${escapeHtml(u.full_name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${u.is_admin ? 'Админ' : 'Менеджер'}</td>
      <td>${u.is_active ? '✓' : '—'}</td>
      <td>
        <button data-action="rename" data-id="${u.id}">Имя</button>
        <button data-action="reset" data-id="${u.id}">Пароль</button>
        <button data-action="toggle-admin" data-id="${u.id}">${u.is_admin?'Сделать менеджером':'Сделать админом'}</button>
        <button data-action="toggle-active" data-id="${u.id}">${u.is_active?'Выключить':'Включить'}</button>
      </td>`
    tbody.appendChild(tr)
  })
}

document.querySelector('#user-create').addEventListener('click', async () => {
  const email = prompt('Email:')
  if (!email) return
  const full_name = prompt('Имя:')
  if (!full_name) return
  const password = prompt('Временный пароль:')
  if (!password) return
  const is_admin = confirm('Сделать админом?') ? 1 : 0
  const res = await fetch('/api/users', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email, full_name, password, is_admin })
  })
  if (!res.ok) alert('Ошибка: ' + (await res.json()).error)
  loadUsers()
})

document.querySelector('#users-table').addEventListener('click', async (e) => {
  const action = e.target.dataset.action
  const id = e.target.dataset.id
  if (!action) return
  if (action === 'rename') {
    const full_name = prompt('Новое имя:')
    if (!full_name) return
    await fetch(`/api/users/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ full_name }) })
  } else if (action === 'reset') {
    const new_password = prompt('Новый пароль:')
    if (!new_password) return
    await fetch(`/api/users/${id}/reset-password`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ new_password }) })
    alert('Пароль обновлён')
  } else if (action === 'toggle-admin') {
    const u = (await fetch('/api/users').then(r=>r.json())).find(u => u.id == id)
    await fetch(`/api/users/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ is_admin: u.is_admin?0:1 }) })
  } else if (action === 'toggle-active') {
    const u = (await fetch('/api/users').then(r=>r.json())).find(u => u.id == id)
    const r = await fetch(`/api/users/${id}/active`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ is_active: u.is_active?0:1 }) })
    if (!r.ok) alert('Ошибка: ' + (await r.json()).error)
  }
  loadUsers()
})

function escapeHtml(s) { return String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])) }
```

И в обработчике переключения табов вызывать `loadUsers()` при активации `#tab-users`.

- [ ] **Step 2: Ручная проверка**

Запустить сервер, открыть `/admin.html` под админом. На вкладке «Пользователи» — список, добавление, переименование, сброс пароля, флаги работают. Менеджер не видит вкладку (или видит 403 при попытке).

- [ ] **Step 3: Закоммитить**

```bash
git add public/admin.html public/js/admin.js
git commit -m "feat(ui): admin tab for user management"
```

---

# Фаза D. Клиенты

## Task 16 (= 21): Миграция v3 — clients + quotes.client_id + quotes.comment

**Files:**
- Modify: `db.js`
- Modify: `tests/migrate.test.js`

- [ ] **Step 1: Написать падающий тест**

```js
describe('migration v3 — clients + quotes.client_id + quotes.comment', () => {
  test('creates clients table', () => {
    const db = require('../db').createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(clients)").all().map(c=>c.name)
    expect(cols).toEqual(expect.arrayContaining(['id','name','contact_person','phone','email','notes','created_at','updated_at']))
  })
  test('adds quotes.client_id and quotes.comment', () => {
    const db = require('../db').createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c=>c.name)
    expect(cols).toContain('client_id')
    expect(cols).toContain('comment')
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `npx jest tests/migrate.test.js -t v3`
Expected: FAIL.

- [ ] **Step 3: Добавить миграцию v3 в массив migrations**

```js
,
{
  version: 3,
  up: (db) => {
    db.exec(`
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
      CREATE INDEX idx_clients_name ON clients(name);
      ALTER TABLE quotes ADD COLUMN client_id INTEGER REFERENCES clients(id);
      ALTER TABLE quotes ADD COLUMN comment TEXT;
    `)
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add db.js tests/migrate.test.js
git commit -m "feat(db): migration v3 — clients table + quotes.client_id, quotes.comment"
```

---

## Task 17 (= 22): API CRUD для clients

**Files:**
- Modify: `server.js`
- Test: `tests/clients.api.test.js` (NEW)

- [ ] **Step 1: Написать падающие тесты**

```js
// tests/clients.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('clients API', () => {
  let app, db, mgr, adm
  beforeEach(async () => {
    process.env.NODE_ENV='test'; process.env.DISABLE_RATE_LIMIT='true'
    db = makeTestDb()
    await createUser(db, { email:'m@b.c', password:'p', isAdmin:false })
    await createUser(db, { email:'a@b.c', password:'p', isAdmin:true })
    jest.resetModules(); jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    mgr = request.agent(app); adm = request.agent(app)
    await loginAs(mgr, 'm@b.c', 'p'); await loginAs(adm, 'a@b.c', 'p')
  })

  test('POST /api/clients creates client (manager allowed)', async () => {
    const r = await mgr.post('/api/clients').send({ name:'ООО Ромашка', phone:'+7' })
    expect(r.status).toBe(201)
    expect(r.body.name).toBe('ООО Ромашка')
  })

  test('GET /api/clients?q=… filters by name substring', async () => {
    await mgr.post('/api/clients').send({ name:'ООО Ромашка' })
    await mgr.post('/api/clients').send({ name:'ИП Иванов' })
    const r = await mgr.get('/api/clients?q=ром')
    expect(r.body.length).toBe(1)
    expect(r.body[0].name).toBe('ООО Ромашка')
  })

  test('PUT /api/clients/:id updates contact', async () => {
    const c = await mgr.post('/api/clients').send({ name:'X', phone:'+1' })
    const r = await mgr.put(`/api/clients/${c.body.id}`).send({ phone:'+2' })
    expect(r.body.phone).toBe('+2')
  })

  test('DELETE /api/clients/:id forbidden for manager', async () => {
    const c = await mgr.post('/api/clients').send({ name:'X' })
    const r = await mgr.delete(`/api/clients/${c.body.id}`)
    expect(r.status).toBe(403)
  })

  test('DELETE /api/clients/:id allowed for admin', async () => {
    const c = await mgr.post('/api/clients').send({ name:'X' })
    const r = await adm.delete(`/api/clients/${c.body.id}`)
    expect(r.status).toBe(200)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npx jest tests/clients.api.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализовать роуты в server.js**

```js
// ── Clients ───────────────────────────────────────────────────────────────
app.get('/api/clients', requireAuth, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%'
  res.json(db.prepare('SELECT * FROM clients WHERE name LIKE ? ORDER BY name').all(q))
})

app.get('/api/clients/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  const quotes = db.prepare('SELECT id,created_at,type,total FROM quotes WHERE client_id=? ORDER BY created_at DESC').all(req.params.id)
  res.json({ ...c, quotes })
})

app.post('/api/clients', requireAuth, (req, res) => {
  const { name, contact_person=null, phone=null, email=null, notes=null } = req.body || {}
  if (!name) return res.status(400).json({ error: 'name required' })
  const info = db.prepare(
    'INSERT INTO clients (name,contact_person,phone,email,notes) VALUES (?,?,?,?,?)'
  ).run(name, contact_person, phone, email, notes)
  res.status(201).json(db.prepare('SELECT * FROM clients WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/clients/:id', requireAuth, (req, res) => {
  const { name, contact_person, phone, email, notes } = req.body || {}
  db.prepare(`UPDATE clients SET
    name=COALESCE(?,name),
    contact_person=COALESCE(?,contact_person),
    phone=COALESCE(?,phone),
    email=COALESCE(?,email),
    notes=COALESCE(?,notes),
    updated_at=datetime('now')
    WHERE id=?`).run(name, contact_person, phone, email, notes, req.params.id)
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id)
  if (!c) return res.status(404).json({ error: 'Not found' })
  res.json(c)
})

app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`. Expected: зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add server.js tests/clients.api.test.js
git commit -m "feat(api): clients CRUD (delete admin-only)"
```

---

## Task 18 (= 23): UI «Клиенты» в admin.html

**Files:**
- Modify: `public/admin.html`
- Modify: `public/js/admin.js`

- [ ] **Step 1: Добавить таб «Клиенты»**

```html
<button data-tab="clients">Клиенты</button>
…
<section id="tab-clients" hidden>
  <h2>Клиенты</h2>
  <input id="clients-search" placeholder="Поиск по названию">
  <button id="client-create">+ Добавить</button>
  <table id="clients-table">
    <thead><tr><th>Название</th><th>Контакт</th><th>Телефон</th><th>Email</th><th>КП</th><th></th></tr></thead>
    <tbody></tbody>
  </table>
  <div id="client-detail" hidden></div>
</section>
```

- [ ] **Step 2: Логика в admin.js**

```js
async function loadClients(q='') {
  const cs = await fetch(`/api/clients?q=${encodeURIComponent(q)}`).then(r=>r.json())
  const tbody = document.querySelector('#clients-table tbody')
  tbody.innerHTML = ''
  cs.forEach(c => {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.contact_person||'')}</td>
      <td>${escapeHtml(c.phone||'')}</td><td>${escapeHtml(c.email||'')}</td><td>—</td>
      <td><button data-action="open-client" data-id="${c.id}">Открыть</button>
        <button data-action="edit-client" data-id="${c.id}">Изменить</button>
        ${window.__isAdmin ? `<button data-action="delete-client" data-id="${c.id}">×</button>`:''}
      </td>`
    tbody.appendChild(tr)
  })
}

document.querySelector('#clients-search').addEventListener('input', e => loadClients(e.target.value))
document.querySelector('#client-create').addEventListener('click', async () => {
  const name = prompt('Название:'); if (!name) return
  const contact_person = prompt('Контактное лицо (опционально):') || null
  const phone = prompt('Телефон (опционально):') || null
  const email = prompt('Email (опционально):') || null
  await fetch('/api/clients',{method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, contact_person, phone, email })})
  loadClients(document.querySelector('#clients-search').value)
})

document.querySelector('#clients-table').addEventListener('click', async e => {
  const a = e.target.dataset.action; const id = e.target.dataset.id
  if (a==='delete-client' && confirm('Удалить?')) {
    await fetch(`/api/clients/${id}`, {method:'DELETE'}); loadClients()
  } else if (a==='edit-client') {
    const phone = prompt('Новый телефон:')
    if (phone) await fetch(`/api/clients/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})})
    loadClients()
  } else if (a==='open-client') {
    const c = await fetch(`/api/clients/${id}`).then(r=>r.json())
    document.querySelector('#client-detail').hidden = false
    document.querySelector('#client-detail').innerHTML =
      `<h3>${escapeHtml(c.name)}</h3>
       <div>${escapeHtml(c.contact_person||'')} · ${escapeHtml(c.phone||'')} · ${escapeHtml(c.email||'')}</div>
       <h4>КП клиента</h4>
       <ul>${c.quotes.map(q=>`<li>#${q.id} · ${q.created_at} · ${q.type} · ${q.total||'—'} ₽</li>`).join('')}</ul>`
  }
})
```

- [ ] **Step 3: Ручная проверка**

Открыть `/admin.html` → «Клиенты», создать/найти/изменить клиента, под админом удалить. Под менеджером — кнопки удаления нет.

- [ ] **Step 4: Закоммитить**

```bash
git add public/admin.html public/js/admin.js
git commit -m "feat(ui): clients tab in admin"
```

---

# Фаза E. Расширение КП — клиент, total, фильтры, история

## Task 19 (= 25): Миграция v4 — quotes.total + бэкфилл

**Files:**
- Modify: `db.js`
- Modify: `tests/migrate.test.js`

- [ ] **Step 1: Написать падающий тест**

```js
describe('migration v4 — quotes.total', () => {
  test('adds total column', () => {
    const db = require('../db').createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c=>c.name)
    expect(cols).toContain('total')
  })
  test('backfills total from result JSON', () => {
    // Симулируем pre-v4 состояние, проверяем что миграция распознаёт result.total
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const { applyMigrations, migrations } = require('../db')
    // применяем только v1..v3 вручную
    for (const m of migrations.filter(m=>m.version<=3)) {
      db.transaction(()=>{ m.up(db); db.pragma(`user_version=${m.version}`) })()
    }
    db.prepare("INSERT INTO quotes (type,params,result,kp_text) VALUES (?,?,?,?)")
      .run('sheet','{}',JSON.stringify({total:1234}),'kp')
    applyMigrations(db) // должен поднять до v4 и бэкфиллить
    const q = db.prepare('SELECT total FROM quotes').get()
    expect(q.total).toBe(1234)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падает**

Run: `npx jest tests/migrate.test.js -t v4`
Expected: FAIL.

- [ ] **Step 3: Добавить миграцию v4**

```js
,
{
  version: 4,
  up: (db) => {
    db.exec('ALTER TABLE quotes ADD COLUMN total REAL')
    // backfill
    const rows = db.prepare('SELECT id, result FROM quotes').all()
    const upd = db.prepare('UPDATE quotes SET total=? WHERE id=?')
    for (const r of rows) {
      try {
        const t = JSON.parse(r.result)?.total
        if (typeof t === 'number') upd.run(t, r.id)
      } catch {}
    }
  }
}
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`. Expected: зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add db.js tests/migrate.test.js
git commit -m "feat(db): migration v4 — quotes.total + backfill from result.total"
```

---

## Task 20 (= 26): POST /api/quotes пишет user_id, client_id, comment, total

**Files:**
- Modify: `server.js`
- Modify: `tests/api.test.js`

- [ ] **Step 1: Написать тест расширения POST /api/quotes**

В `tests/api.test.js` дополнить блок quotes:

```js
describe('quotes API extended', () => {
  test('POST /api/quotes saves user_id, client_id, comment, total', async () => {
    // создаём клиента для теста
    const c = await agent.post('/api/clients').send({ name:'Acme' })
    const r = await agent.post('/api/quotes').send({
      type:'sheet', params:{w:1}, result:{total:5000},
      kp_text:'KP', client_id:c.body.id, comment:'pls'
    })
    expect(r.status).toBe(201)
    expect(r.body.client_id).toBe(c.body.id)
    expect(r.body.comment).toBe('pls')
    expect(r.body.total).toBe(5000)
    expect(r.body.user_id).toBeDefined()
  })
})
```

- [ ] **Step 2: Запустить**

Run: `npx jest tests/api.test.js -t "saves user_id"`. Expected: FAIL.

- [ ] **Step 3: Изменить роут POST /api/quotes**

```js
app.post('/api/quotes', requireAuth, (req, res) => {
  const { type, params, result, kp_text, client_id=null, comment=null } = req.body || {}
  if (!type || !params || !result || !kp_text) return res.status(400).json({ error: 'type, params, result, kp_text required' })
  const total = (typeof result?.total === 'number') ? result.total : null
  const info = db.prepare(
    'INSERT INTO quotes (type,params,result,kp_text,user_id,client_id,comment,total) VALUES (?,?,?,?,?,?,?,?)'
  ).run(type, JSON.stringify(params), JSON.stringify(result), kp_text, req.user.id, client_id, comment, total)
  res.status(201).json(db.prepare('SELECT * FROM quotes WHERE id=?').get(info.lastInsertRowid))
})
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`. Expected: зелёное.

- [ ] **Step 5: Закоммитить**

```bash
git add server.js tests/api.test.js
git commit -m "feat(api): quotes save user_id, client_id, comment, total"
```

---

## Task 21 (= 27): Модалка «Сохранить КП» в калькуляторе

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/calc-ui.js`

- [ ] **Step 1: Добавить модалку в index.html**

```html
<dialog id="save-quote-modal">
  <form method="dialog">
    <h3>Сохранить коммерческое предложение</h3>
    <label>Клиент
      <input id="client-search" list="clients-list" placeholder="Поиск или новый">
      <datalist id="clients-list"></datalist>
    </label>
    <label>Комментарий <textarea id="quote-comment" rows="2"></textarea></label>
    <button id="save-quote-btn" value="save">Сохранить и сформировать PDF</button>
    <button value="cancel">Отмена</button>
  </form>
</dialog>
```

- [ ] **Step 2: Логика в calc-ui.js**

Дополнить (где-то в обработчике кнопки «Сформировать КП»):

```js
async function openSaveQuoteModal(payload) {
  // payload = { type, params, result, kp_text }
  const dlg = document.getElementById('save-quote-modal')
  const search = document.getElementById('client-search')
  const list = document.getElementById('clients-list')
  search.value = ''
  search.oninput = async () => {
    const cs = await fetch(`/api/clients?q=${encodeURIComponent(search.value)}`).then(r=>r.json())
    list.innerHTML = cs.map(c => `<option value="${escapeHtml(c.name)}" data-id="${c.id}">`).join('')
  }
  dlg.showModal()
  dlg.addEventListener('close', async function once() {
    dlg.removeEventListener('close', once)
    if (dlg.returnValue !== 'save') return
    const name = search.value.trim()
    let client_id = null
    if (name) {
      const cs = await fetch(`/api/clients?q=${encodeURIComponent(name)}`).then(r=>r.json())
      const exact = cs.find(c => c.name === name)
      if (exact) client_id = exact.id
      else {
        const created = await fetch('/api/clients',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({name})}).then(r=>r.json())
        client_id = created.id
      }
    }
    const comment = document.getElementById('quote-comment').value || null
    const r = await fetch('/api/quotes',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...payload, client_id, comment})}).then(r=>r.json())
    // открываем PDF
    window.open(`/api/quotes/${r.id}/pdf`, '_blank')
  })
}
function escapeHtml(s){return String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))}
```

И заменить старый вызов «сохранения КП» на `openSaveQuoteModal({type, params, result, kp_text})`.

- [ ] **Step 3: Ручная проверка**

Запустить, посчитать, нажать «Сформировать КП», в модалке выбрать/создать клиента, добавить комментарий → создание КП.

> PDF endpoint появится в Task 33 — пока ссылка может вернуть 404. Это ОК.

- [ ] **Step 4: Закоммитить**

```bash
git add public/index.html public/js/calc-ui.js
git commit -m "feat(ui): save-quote modal with client picker and comment"
```

---

## Task 22 (= 27/28): Фильтры и пагинация в GET /api/quotes

**Files:**
- Modify: `server.js`
- Test: `tests/quotes-filter.api.test.js` (NEW)

- [ ] **Step 1: Написать падающие тесты для фильтров**

```js
// tests/quotes-filter.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs, createClient } = require('./helpers')

describe('GET /api/quotes filters', () => {
  let app, db, agent, userId, clientId
  beforeEach(async () => {
    process.env.NODE_ENV='test'; process.env.DISABLE_RATE_LIMIT='true'
    db = makeTestDb()
    const u = await createUser(db, { email:'a@b.c', password:'p', isAdmin:true })
    userId = u.id
    const c = await createClient(db, { name:'Acme' })
    clientId = c.id
    jest.resetModules(); jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    agent = request.agent(app); await loginAs(agent,'a@b.c','p')
    // вставим несколько КП с разными типами/суммами/датами
    db.prepare(`INSERT INTO quotes (created_at,type,params,result,kp_text,user_id,client_id,total) VALUES
      ('2026-04-01','sheet','{}','{}','one',?,?,1000),
      ('2026-04-15','souvenir','{}','{}','two',?,?,5000),
      ('2026-04-25','sheet','{}','{}','three',?,?,10000)
    `).run(userId,clientId,userId,clientId,userId,clientId)
  })

  test('filter by type', async () => {
    const r = await agent.get('/api/quotes?type=sheet&limit=100')
    expect(r.body.items).toHaveLength(2)
  })
  test('filter by date range', async () => {
    const r = await agent.get('/api/quotes?date_from=2026-04-10&date_to=2026-04-20&limit=100')
    expect(r.body.items).toHaveLength(1)
    expect(r.body.items[0].kp_text).toBe('two')
  })
  test('filter by total range', async () => {
    const r = await agent.get('/api/quotes?total_from=2000&total_to=8000&limit=100')
    expect(r.body.items).toHaveLength(1)
  })
  test('filter by user_id and client_id', async () => {
    const r = await agent.get(`/api/quotes?user_id=${userId}&client_id=${clientId}&limit=100`)
    expect(r.body.items).toHaveLength(3)
  })
  test('search by q in kp_text', async () => {
    const r = await agent.get('/api/quotes?q=two&limit=100')
    expect(r.body.items).toHaveLength(1)
  })
  test('sort by total desc', async () => {
    const r = await agent.get('/api/quotes?sort=total&dir=desc&limit=100')
    expect(r.body.items.map(q=>q.total)).toEqual([10000,5000,1000])
  })
  test('pagination limit/offset', async () => {
    const r1 = await agent.get('/api/quotes?limit=2&offset=0')
    const r2 = await agent.get('/api/quotes?limit=2&offset=2')
    expect(r1.body.items).toHaveLength(2)
    expect(r2.body.items).toHaveLength(1)
    expect(r1.body.total).toBe(3)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

Run: `npx jest tests/quotes-filter.api.test.js`
Expected: FAIL.

- [ ] **Step 3: Заменить роут GET /api/quotes**

```js
app.get('/api/quotes', requireAuth, (req, res) => {
  const where = []
  const params = {}
  if (req.query.q) { where.push('(q.kp_text LIKE @q OR q.params LIKE @q)'); params.q = `%${req.query.q}%` }
  if (req.query.type) { where.push('q.type=@type'); params.type = req.query.type }
  if (req.query.date_from) { where.push("date(q.created_at) >= date(@df)"); params.df = req.query.date_from }
  if (req.query.date_to)   { where.push("date(q.created_at) <= date(@dt)"); params.dt = req.query.date_to }
  if (req.query.user_id)   { where.push('q.user_id=@uid');  params.uid = +req.query.user_id }
  if (req.query.client_id) { where.push('q.client_id=@cid'); params.cid = +req.query.client_id }
  if (req.query.total_from){ where.push('q.total >= @tf'); params.tf = +req.query.total_from }
  if (req.query.total_to)  { where.push('q.total <= @tt'); params.tt = +req.query.total_to }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const sortCol = req.query.sort === 'total' ? 'q.total' : 'q.created_at'
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC'
  const limit = Math.min(+req.query.limit || 50, 200)
  const offset = +req.query.offset || 0
  const items = db.prepare(
    `SELECT q.*, u.full_name AS user_name, c.name AS client_name
     FROM quotes q LEFT JOIN users u ON q.user_id=u.id LEFT JOIN clients c ON q.client_id=c.id
     ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset })
  const total = db.prepare(`SELECT COUNT(*) AS c FROM quotes q ${whereSql}`).get(params).c
  res.json({ items, total, limit, offset })
})
```

> Внимание: формат ответа сменился с массива на объект `{items, total, limit, offset}`. Убедись, что старые тесты `tests/api.test.js` это учитывают (поправить там, где `res.body[0]` → `res.body.items[0]`).

- [ ] **Step 4: Поправить старый тест**

В `tests/api.test.js` блок `quotes API`:
```js
const res = await agent.get('/api/quotes')
expect(res.body.items).toHaveLength(1)
expect(res.body.items[0].kp_text).toBe('КП тест')
```

- [ ] **Step 5: Запустить тесты**

Run: `npm test`. Expected: зелёное.

- [ ] **Step 6: Закоммитить**

```bash
git add server.js tests/quotes-filter.api.test.js tests/api.test.js
git commit -m "feat(api): quotes list — filters, sort, pagination"
```

---

## Task 23 (= 29): DELETE /api/quotes — менеджер только свои, админ — любые

**Files:**
- Modify: `server.js`
- Modify: `tests/quotes-filter.api.test.js`

- [ ] **Step 1: Тест**

```js
describe('DELETE /api/quotes/:id', () => {
  let app, db, mgr, adm, mgrId
  beforeEach(async () => {
    process.env.NODE_ENV='test'; process.env.DISABLE_RATE_LIMIT='true'
    db = makeTestDb()
    const m = await createUser(db, { email:'m@b.c', password:'p', isAdmin:false }); mgrId = m.id
    const a = await createUser(db, { email:'a@b.c', password:'p', isAdmin:true })
    jest.resetModules(); jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    mgr = request.agent(app); adm = request.agent(app)
    await loginAs(mgr,'m@b.c','p'); await loginAs(adm,'a@b.c','p')
  })
  test('manager can delete own quote', async () => {
    const c = await mgr.post('/api/quotes').send({type:'sheet',params:{},result:{total:1},kp_text:'k'})
    expect((await mgr.delete(`/api/quotes/${c.body.id}`)).status).toBe(200)
  })
  test('manager cannot delete others quote', async () => {
    const c = await adm.post('/api/quotes').send({type:'sheet',params:{},result:{total:1},kp_text:'k'})
    expect((await mgr.delete(`/api/quotes/${c.body.id}`)).status).toBe(403)
  })
  test('admin can delete others quote', async () => {
    const c = await mgr.post('/api/quotes').send({type:'sheet',params:{},result:{total:1},kp_text:'k'})
    expect((await adm.delete(`/api/quotes/${c.body.id}`)).status).toBe(200)
  })
})
```

- [ ] **Step 2: Запустить, убедиться что падают**

`npx jest -t "DELETE /api/quotes"` — FAIL (текущий роут DELETE без проверки автора).

- [ ] **Step 3: Заменить DELETE /api/quotes/:id**

```js
app.delete('/api/quotes/:id', requireAuth, (req, res) => {
  const q = db.prepare('SELECT user_id FROM quotes WHERE id=?').get(req.params.id)
  if (!q) return res.status(404).json({ error: 'Not found' })
  if (!req.user.is_admin && q.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' })
  db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})
```

- [ ] **Step 4: Тесты**

`npm test` — зелёное.

- [ ] **Step 5: Коммит**

```bash
git add server.js tests/quotes-filter.api.test.js
git commit -m "feat(api): quotes delete — own for managers, any for admin"
```

---

## Task 24 (= 30): UI «История КП» в admin.html — фильтры, сортировка, пагинация

**Files:**
- Modify: `public/admin.html`
- Modify: `public/js/admin.js`

- [ ] **Step 1: Разметка**

```html
<button data-tab="history">История КП</button>
…
<section id="tab-history" hidden>
  <h2>Сохранённые КП</h2>
  <div class="filters">
    <input id="hist-q" placeholder="Поиск">
    <input id="hist-date-from" type="date"><input id="hist-date-to" type="date">
    <select id="hist-type"><option value="">Тип</option><option value="sheet">sheet</option><option value="souvenir">souvenir</option></select>
    <select id="hist-user"><option value="">Автор</option></select>
    <select id="hist-client"><option value="">Клиент</option></select>
    <input id="hist-total-from" type="number" placeholder="Сумма от">
    <input id="hist-total-to" type="number" placeholder="до">
    <select id="hist-sort"><option value="created_at">Дата</option><option value="total">Сумма</option></select>
    <select id="hist-dir"><option value="desc">↓</option><option value="asc">↑</option></select>
  </div>
  <table id="hist-table">
    <thead><tr><th>#</th><th>Дата</th><th>Автор</th><th>Клиент</th><th>Тип</th><th>Сумма</th><th></th></tr></thead>
    <tbody></tbody>
  </table>
  <button id="hist-more" hidden>Ещё</button>
</section>
```

- [ ] **Step 2: Логика в admin.js**

```js
let histOffset = 0
async function loadHistory(reset=true) {
  if (reset) { histOffset = 0; document.querySelector('#hist-table tbody').innerHTML = '' }
  const params = new URLSearchParams()
  for (const id of ['hist-q','hist-date-from','hist-date-to','hist-type','hist-user','hist-client','hist-total-from','hist-total-to','hist-sort','hist-dir']) {
    const v = document.getElementById(id)?.value
    if (v) params.set(id.replace('hist-','').replace('-','_'), v)
  }
  params.set('limit','50'); params.set('offset', String(histOffset))
  const data = await fetch('/api/quotes?'+params).then(r=>r.json())
  const tbody = document.querySelector('#hist-table tbody')
  data.items.forEach(q => {
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${q.id}</td><td>${q.created_at}</td>
      <td>${escapeHtml(q.user_name||'')}</td><td>${escapeHtml(q.client_name||'')}</td>
      <td>${q.type}</td><td>${q.total ?? '—'}</td>
      <td><a href="/api/quotes/${q.id}/pdf" target="_blank">PDF</a>
        <button data-action="del-quote" data-id="${q.id}">×</button></td>`
    tbody.appendChild(tr)
  })
  histOffset += data.items.length
  document.querySelector('#hist-more').hidden = histOffset >= data.total
}
document.querySelector('#tab-history')?.querySelectorAll('input,select').forEach(i =>
  i.addEventListener('change', () => loadHistory(true)))
document.getElementById('hist-q').addEventListener('input', () => loadHistory(true))
document.getElementById('hist-more').addEventListener('click', () => loadHistory(false))
document.querySelector('#hist-table').addEventListener('click', async e => {
  if (e.target.dataset.action === 'del-quote' && confirm('Удалить?')) {
    await fetch(`/api/quotes/${e.target.dataset.id}`, {method:'DELETE'})
    loadHistory(true)
  }
})

// при инициализации заполнить dropdown'ы пользователей и клиентов:
async function fillHistFilters() {
  const us = await fetch('/api/users').then(r=>r.ok?r.json():[])
  document.getElementById('hist-user').innerHTML =
    '<option value="">Автор</option>' + us.map(u=>`<option value="${u.id}">${escapeHtml(u.full_name)}</option>`).join('')
  const cs = await fetch('/api/clients').then(r=>r.json())
  document.getElementById('hist-client').innerHTML =
    '<option value="">Клиент</option>' + cs.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
}
```

И вызывать `fillHistFilters()` + `loadHistory(true)` при активации таба «История КП».

- [ ] **Step 3: Ручная проверка**

Создать несколько КП через калькулятор, открыть «История КП», поиграть фильтрами, сортировками, нажать «Ещё».

- [ ] **Step 4: Коммит**

```bash
git add public/admin.html public/js/admin.js
git commit -m "feat(ui): quotes history with filters, sort, pagination"
```

---

# Фаза F. Брендированный PDF и настройки компании

## Task 25 (= 32): Миграция v5 — company_settings + quotes.pdf_path

**Files:**
- Modify: `db.js`
- Modify: `tests/migrate.test.js`

- [ ] **Step 1: Тест**

```js
describe('migration v5', () => {
  test('creates company_settings table and adds quotes.pdf_path', () => {
    const db = require('../db').createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(company_settings)").all().map(c=>c.name)
    expect(cols).toEqual(expect.arrayContaining(['key','value']))
    const qcols = db.prepare("PRAGMA table_info(quotes)").all().map(c=>c.name)
    expect(qcols).toContain('pdf_path')
  })
})
```

- [ ] **Step 2: FAIL**

`npx jest -t "migration v5"`. Expected: FAIL.

- [ ] **Step 3: Миграция v5**

```js
,
{
  version: 5,
  up: (db) => {
    db.exec(`
      CREATE TABLE company_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      ALTER TABLE quotes ADD COLUMN pdf_path TEXT;
    `)
    const ins = db.prepare('INSERT OR IGNORE INTO company_settings (key,value) VALUES (?,?)')
    ins.run('name', 'Сити Принт')
    ins.run('inn', ''); ins.run('kpp', '')
    ins.run('address', 'Екатеринбург')
    ins.run('phone', ''); ins.run('email', '')
    ins.run('site', 'https://citi-print.ru')
    ins.run('bank_details', '')
    ins.run('logo_path', 'data/uploads/logo.png')
    ins.run('signature', 'Анна, типография «Сити Принт»')
    ins.run('kp_validity_days', '7')
  }
}
```

- [ ] **Step 4: Тесты**

`npm test`. Expected: зелёное.

- [ ] **Step 5: Коммит**

```bash
git add db.js tests/migrate.test.js
git commit -m "feat(db): migration v5 — company_settings, quotes.pdf_path, defaults"
```

---

## Task 26 (= 32/36): GET/PUT /api/company-settings + загрузка логотипа

**Files:**
- Modify: `server.js`
- Test: `tests/company-settings.api.test.js` (NEW)

- [ ] **Step 1: Тест**

```js
// tests/company-settings.api.test.js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('company-settings API', () => {
  let app, db, mgr, adm
  beforeEach(async () => {
    process.env.NODE_ENV='test'; process.env.DISABLE_RATE_LIMIT='true'
    db = makeTestDb()
    await createUser(db, { email:'a@b.c', password:'p', isAdmin:true })
    await createUser(db, { email:'m@b.c', password:'p', isAdmin:false })
    jest.resetModules(); jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    adm = request.agent(app); mgr = request.agent(app)
    await loginAs(adm,'a@b.c','p'); await loginAs(mgr,'m@b.c','p')
  })

  test('GET returns object with all keys', async () => {
    const r = await adm.get('/api/company-settings')
    expect(r.body.name).toBe('Сити Принт')
    expect(r.body.kp_validity_days).toBe('7')
  })
  test('PUT updates given keys', async () => {
    const r = await adm.put('/api/company-settings').send({ phone:'+7 800', kp_validity_days:'14' })
    expect(r.body.phone).toBe('+7 800')
    expect(r.body.kp_validity_days).toBe('14')
  })
  test('manager forbidden on PUT', async () => {
    expect((await mgr.put('/api/company-settings').send({})).status).toBe(403)
  })
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

```js
app.get('/api/company-settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key,value FROM company_settings').all()
  const obj = {}; rows.forEach(r => obj[r.key] = r.value)
  res.json(obj)
})

app.put('/api/company-settings', requireAdmin, (req, res) => {
  const upsert = db.prepare('INSERT INTO company_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
  for (const [k, v] of Object.entries(req.body || {})) upsert.run(k, String(v))
  const rows = db.prepare('SELECT key,value FROM company_settings').all()
  const obj = {}; rows.forEach(r => obj[r.key] = r.value)
  res.json(obj)
})

const logoUpload = multer({ storage: multer.diskStorage({
  destination: path.join(__dirname, 'data', 'uploads'),
  filename: (_,_f,cb) => cb(null, 'logo.png')
}), limits: { fileSize: 1024 * 1024 } })

app.post('/api/company-settings/logo', requireAdmin, logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  res.json({ ok: true, path: req.file.path })
})
```

(Не забыть `fs.mkdirSync(path.join(__dirname,'data','uploads'),{recursive:true})` где-нибудь при старте.)

- [ ] **Step 4: Тесты**

`npm test`. Зелёное.

- [ ] **Step 5: Коммит**

```bash
git add server.js tests/company-settings.api.test.js
git commit -m "feat(api): company-settings GET/PUT + logo upload"
```

---

## Task 27 (= 33): pdf.js — генератор брендированного PDF

**Files:**
- Create: `pdf.js`
- Create: `assets/fonts/DejaVuSans.ttf` (скачать)
- Test: `tests/pdf.test.js` (NEW)
- Modify: `package.json`

- [ ] **Step 1: Установить pdfkit и скачать шрифт**

```bash
npm install pdfkit
mkdir -p assets/fonts
curl -L -o assets/fonts/DejaVuSans.ttf https://github.com/dejavu-fonts/dejavu-fonts/raw/master/ttf/DejaVuSans.ttf
```

Проверить, что файл ~700 КБ. Закоммитить шрифт в репо (стоит того — нужен на сервере).

- [ ] **Step 2: Тест**

```js
// tests/pdf.test.js
const { generateQuotePdf } = require('../pdf')

describe('generateQuotePdf', () => {
  test('returns Buffer with PDF magic bytes and reasonable size', async () => {
    const buf = await generateQuotePdf(
      { id: 1, created_at: '2026-04-29 10:00:00', type:'sheet', total:5000, kp_text:'тест', params:'{}', result:JSON.stringify({total:5000}) },
      { name:'ООО Ромашка' },
      { name:'Сити Принт', inn:'1', kpp:'2', address:'г. Екб', phone:'+7', email:'e@e', signature:'Анна', kp_validity_days:'7', logo_path:'' },
      { full_name:'Анна', email:'a@b.c' }
    )
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0,5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(2000)
  })
})
```

- [ ] **Step 3: FAIL**

`npx jest tests/pdf.test.js`. Expected: FAIL (`Cannot find module '../pdf'`).

- [ ] **Step 4: Реализация pdf.js**

```js
// pdf.js
const PDFDocument = require('pdfkit')
const path = require('path')
const fs = require('fs')

const FONT = path.join(__dirname, 'assets', 'fonts', 'DejaVuSans.ttf')

async function generateQuotePdf(quote, client, settings, user) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 })
      doc.registerFont('DejaVu', FONT)
      doc.font('DejaVu')
      const chunks = []
      doc.on('data', c => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // Шапка: логотип слева, реквизиты справа
      const logoPath = settings.logo_path
      if (logoPath && fs.existsSync(logoPath)) {
        try { doc.image(logoPath, 40, 40, { width: 100 }) } catch {}
      }
      doc.fontSize(10).text(
        `${settings.name||''}\nИНН ${settings.inn||''} КПП ${settings.kpp||''}\n${settings.address||''}\n${settings.phone||''} · ${settings.email||''}`,
        300, 40, { width: 250, align: 'right' }
      )

      // Заголовок
      doc.moveDown(4)
      const dateStr = (quote.created_at || '').slice(0, 10)
      const validUntil = addDays(dateStr, +settings.kp_validity_days || 7)
      doc.fontSize(16).text(`Коммерческое предложение № ${quote.id}`, 40, 160)
      doc.fontSize(10).text(`от ${dateStr} · действительно до ${validUntil}`, 40, 185)

      // Заказчик
      let y = 215
      if (client && client.name) {
        doc.fontSize(11).text('Заказчик:', 40, y)
        doc.fontSize(10).text(
          `${client.name}\n${client.contact_person||''} ${client.phone||''} ${client.email||''}`,
          120, y, { width: 430 }
        )
        y += 60
      }

      // Параметры
      let params = {}
      try { params = typeof quote.params === 'string' ? JSON.parse(quote.params) : quote.params } catch {}
      doc.fontSize(11).text('Параметры:', 40, y)
      doc.fontSize(10).text(quote.kp_text || '', 120, y, { width: 430 })
      y += Math.max(80, doc.heightOfString(quote.kp_text || '', { width: 430 }) + 20)

      // Расчёт
      let result = {}
      try { result = typeof quote.result === 'string' ? JSON.parse(quote.result) : quote.result } catch {}
      doc.fontSize(11).text('Расчёт:', 40, y)
      y += 18
      doc.fontSize(10)
      Object.entries(result).filter(([k]) => k !== 'total').forEach(([k, v]) => {
        doc.text(`${k}: ${v}`, 60, y); y += 14
      })

      // Итог
      y += 10
      doc.fontSize(13).text(`Итого: ${quote.total ?? result.total ?? '—'} ₽`, 40, y, { underline: true })
      y += 30

      // Подпись
      doc.fontSize(9).text(settings.bank_details || '', 40, y, { width: 515 })
      doc.fontSize(10).text(`\n\n${settings.signature || ''}\n${user.email || ''}`, 40, y + 50)

      doc.end()
    } catch (e) { reject(e) }
  })
}

function addDays(yyyyMmDd, days) {
  if (!yyyyMmDd) return ''
  const d = new Date(yyyyMmDd)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

module.exports = { generateQuotePdf }
```

- [ ] **Step 5: Тесты**

`npm test`. Зелёное.

- [ ] **Step 6: Коммит**

```bash
git add pdf.js assets/fonts/DejaVuSans.ttf tests/pdf.test.js package.json package-lock.json
git commit -m "feat(pdf): branded quote PDF generator (PDFKit + DejaVu Sans)"
```

---

## Task 28 (= 35): GET /api/quotes/:id/pdf + сохранение pdf_path

**Files:**
- Modify: `server.js`
- Modify: `tests/api.test.js` или новый блок

- [ ] **Step 1: Тест**

В `tests/api.test.js` дописать:

```js
describe('GET /api/quotes/:id/pdf', () => {
  test('returns PDF and saves pdf_path', async () => {
    const c = await agent.post('/api/quotes').send({type:'sheet',params:{},result:{total:5000},kp_text:'k'})
    const r = await agent.get(`/api/quotes/${c.body.id}/pdf`).buffer().parse((res,cb)=>{
      const d=[]; res.on('data',x=>d.push(x)); res.on('end',()=>cb(null,Buffer.concat(d)))
    })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/pdf/)
    expect(r.body.slice(0,5).toString()).toBe('%PDF-')
  })
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Роут**

```js
const { generateQuotePdf } = require('./pdf')

app.get('/api/quotes/:id/pdf', requireAuth, async (req, res) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id)
  if (!q) return res.status(404).json({ error: 'Not found' })
  // если файл уже есть — отдаём его
  if (q.pdf_path && fs.existsSync(q.pdf_path)) {
    return res.type('pdf').sendFile(path.resolve(q.pdf_path))
  }
  const client = q.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(q.client_id) : null
  const user = db.prepare('SELECT id,email,full_name FROM users WHERE id=?').get(q.user_id) || {}
  const settingsRows = db.prepare('SELECT key,value FROM company_settings').all()
  const settings = {}; settingsRows.forEach(r => settings[r.key] = r.value)
  const buf = await generateQuotePdf(q, client, settings, user)
  const dir = path.join(__dirname, 'data', 'pdfs')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `quote-${q.id}.pdf`)
  fs.writeFileSync(filePath, buf)
  db.prepare('UPDATE quotes SET pdf_path=? WHERE id=?').run(filePath, q.id)
  res.type('pdf').send(buf)
})
```

Не забыть импорты `path`, `fs` сверху (уже есть `path`, добавить `const fs = require('fs')`).

- [ ] **Step 4: Тесты**

`npm test`. Зелёное.

- [ ] **Step 5: Коммит**

```bash
git add server.js tests/api.test.js
git commit -m "feat(api): GET /api/quotes/:id/pdf — generate, cache, serve"
```

---

## Task 29 (= 36): UI «Настройки компании» в admin.html

**Files:**
- Modify: `public/admin.html`
- Modify: `public/js/admin.js`

- [ ] **Step 1: Разметка**

```html
<button data-tab="settings">Настройки</button>
…
<section id="tab-settings" hidden>
  <h2>Настройки компании</h2>
  <form id="settings-form">
    <label>Название <input name="name"></label>
    <label>ИНН <input name="inn"></label>
    <label>КПП <input name="kpp"></label>
    <label>Адрес <input name="address"></label>
    <label>Телефон <input name="phone"></label>
    <label>Email <input name="email"></label>
    <label>Сайт <input name="site"></label>
    <label>Банк-реквизиты <textarea name="bank_details" rows="3"></textarea></label>
    <label>Подпись <input name="signature"></label>
    <label>Срок действия КП (дней) <input name="kp_validity_days" type="number"></label>
    <button type="submit">Сохранить</button>
  </form>
  <h3>Логотип</h3>
  <input type="file" id="logo-upload" accept="image/png,image/jpeg">
  <button id="logo-upload-btn">Загрузить</button>
</section>
```

- [ ] **Step 2: Логика**

```js
async function loadSettings() {
  const s = await fetch('/api/company-settings').then(r=>r.json())
  for (const [k,v] of Object.entries(s)) {
    const f = document.querySelector(`#settings-form [name="${k}"]`)
    if (f) f.value = v ?? ''
  }
}
document.querySelector('#settings-form').addEventListener('submit', async e => {
  e.preventDefault()
  const fd = new FormData(e.target)
  const obj = {}; fd.forEach((v,k) => obj[k] = v)
  await fetch('/api/company-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)})
  alert('Сохранено')
})
document.querySelector('#logo-upload-btn').addEventListener('click', async () => {
  const f = document.querySelector('#logo-upload').files[0]
  if (!f) return
  const fd = new FormData(); fd.append('logo', f)
  const r = await fetch('/api/company-settings/logo',{method:'POST',body:fd})
  alert(r.ok ? 'Логотип загружен' : 'Ошибка загрузки')
})
```

Вызывать `loadSettings()` при активации таба.

- [ ] **Step 3: Ручная проверка**

Открыть «Настройки», ввести реквизиты, загрузить логотип. Создать КП → PDF должен содержать новые реквизиты и логотип.

- [ ] **Step 4: Коммит**

```bash
git add public/admin.html public/js/admin.js
git commit -m "feat(ui): company settings tab with logo upload"
```

---

# Фаза G. Бэкапы

## Task 30 (= 38): backup.js — db.backup() + ротация

**Files:**
- Create: `backup.js`
- Test: `tests/backup.test.js` (NEW)

- [ ] **Step 1: Тест**

```js
// tests/backup.test.js
const fs = require('fs'); const path = require('path'); const os = require('os')
const { createBackup, rotateBackups } = require('../backup')
const Database = require('better-sqlite3')

describe('backup', () => {
  let dir, dbFile
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvbk-'))
    dbFile = path.join(dir, 'src.db')
    const db = new Database(dbFile)
    db.exec('CREATE TABLE t(x); INSERT INTO t VALUES (1)')
    db.close()
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('createBackup writes a valid SQLite file', async () => {
    const out = await createBackup(dbFile, dir, false)
    expect(fs.existsSync(out)).toBe(true)
    expect(fs.statSync(out).size).toBeGreaterThan(0)
    // valid SQLite header — first 16 bytes "SQLite format 3\0"
    const header = fs.readFileSync(out).slice(0, 16).toString()
    expect(header.startsWith('SQLite format 3')).toBe(true)
  })

  test('rotateBackups deletes files older than N days', () => {
    const old = path.join(dir, 'uv-2020-01-01.db')
    fs.writeFileSync(old, 'x')
    const oldTime = new Date('2020-01-01').getTime() / 1000
    fs.utimesSync(old, oldTime, oldTime)
    rotateBackups(dir, 30)
    expect(fs.existsSync(old)).toBe(false)
  })
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация backup.js**

```js
// backup.js
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')

async function createBackup(srcDbPath, destDir, manual = false) {
  fs.mkdirSync(destDir, { recursive: true })
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const suffix = manual
    ? `${yyyy}-${mm}-${dd}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}-manual`
    : `${yyyy}-${mm}-${dd}`
  const out = path.join(destDir, `uv-${suffix}.db`)
  const db = new Database(srcDbPath, { readonly: true })
  await db.backup(out)
  db.close()
  return out
}

function rotateBackups(dir, days) {
  if (!fs.existsSync(dir)) return
  const cutoff = Date.now() - days * 24 * 3600 * 1000
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f)
    const stat = fs.statSync(full)
    if (stat.mtime.getTime() < cutoff && /^uv-.*\.db$/.test(f)) {
      fs.unlinkSync(full)
    }
  }
}

function appendLog(dir, line) {
  fs.appendFileSync(path.join(dir, 'backup.log'), line + '\n')
}

async function main() {
  const dbPath = path.join(__dirname, 'data', 'uv.db')
  const dir = path.join(__dirname, 'data', 'backups')
  try {
    const out = await createBackup(dbPath, dir, false)
    rotateBackups(dir, 30)
    appendLog(dir, `${new Date().toISOString()} OK ${out} ${fs.statSync(out).size}`)
  } catch (e) {
    appendLog(dir, `${new Date().toISOString()} FAIL ${e.message}`)
    process.exit(1)
  }
}

if (require.main === module) main()

module.exports = { createBackup, rotateBackups, appendLog }
```

- [ ] **Step 4: Тесты**

`npm test`. Зелёное.

- [ ] **Step 5: Коммит**

```bash
git add backup.js tests/backup.test.js
git commit -m "feat(backup): db.backup() + rotation + cli entrypoint"
```

---

## Task 31 (= 39): API бэкапов — list, manual, download (admin only)

**Files:**
- Modify: `server.js`
- Test: `tests/backups.api.test.js` (NEW)

- [ ] **Step 1: Тест**

```js
// tests/backups.api.test.js
const request = require('supertest')
const fs = require('fs'); const path = require('path'); const os = require('os')
const { makeTestDb, createUser, loginAs } = require('./helpers')

describe('backups API', () => {
  let app, db, adm, mgr, dir
  beforeEach(async () => {
    process.env.NODE_ENV='test'; process.env.DISABLE_RATE_LIMIT='true'
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uvbk-'))
    process.env.BACKUP_DIR = dir
    db = makeTestDb()
    await createUser(db, { email:'a@b.c', password:'p', isAdmin:true })
    await createUser(db, { email:'m@b.c', password:'p', isAdmin:false })
    jest.resetModules(); jest.doMock('../db', () => ({ createDb: () => db }))
    app = require('../server').app
    adm = request.agent(app); mgr = request.agent(app)
    await loginAs(adm,'a@b.c','p'); await loginAs(mgr,'m@b.c','p')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  test('GET lists empty initially', async () => {
    const r = await adm.get('/api/backups')
    expect(r.status).toBe(200); expect(r.body).toEqual([])
  })
  test('POST creates manual backup', async () => {
    const r = await adm.post('/api/backups')
    expect(r.status).toBe(201)
    expect(r.body.filename).toMatch(/manual\.db$/)
    expect(fs.existsSync(path.join(dir, r.body.filename))).toBe(true)
  })
  test('GET :filename downloads backup', async () => {
    const c = await adm.post('/api/backups')
    const r = await adm.get(`/api/backups/${c.body.filename}`).buffer()
    expect(r.status).toBe(200)
  })
  test('manager forbidden', async () => {
    expect((await mgr.get('/api/backups')).status).toBe(403)
  })
})
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация в server.js**

```js
const { createBackup } = require('./backup')

function backupDir() {
  return process.env.BACKUP_DIR || path.join(__dirname, 'data', 'backups')
}

app.get('/api/backups', requireAdmin, (req, res) => {
  const dir = backupDir()
  if (!fs.existsSync(dir)) return res.json([])
  const files = fs.readdirSync(dir).filter(f => /^uv-.*\.db$/.test(f)).sort().reverse()
  res.json(files.map(f => {
    const stat = fs.statSync(path.join(dir, f))
    return { filename: f, size: stat.size, mtime: stat.mtime.toISOString(), manual: f.includes('manual') }
  }))
})

app.post('/api/backups', requireAdmin, async (req, res) => {
  const out = await createBackup(
    process.env.NODE_ENV === 'test'
      ? path.join(backupDir(), '..', 'src.db') // в тесте создадим тут же фиктивную
      : path.join(__dirname, 'data', 'uv.db'),
    backupDir(),
    true
  ).catch(e => { res.status(500).json({ error: e.message }); return null })
  if (!out) return
  res.status(201).json({ filename: path.basename(out) })
})

app.get('/api/backups/:filename', requireAdmin, (req, res) => {
  const safe = path.basename(req.params.filename) // защита от path traversal
  const full = path.join(backupDir(), safe)
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' })
  res.download(full)
})
```

> Замечание для теста — `src.db` фиктивный, лучше передавать `dbPath` через ENV. Альтернатива: в тесте создать `src.db` вручную перед POST. Можно упростить: в тестовом режиме делать backup из in-memory в файл — но better-sqlite3 в тестах в памяти, и `db.backup()` от in-memory работает корректно. Лучший вариант: в `server.js` хранить переменную `dbPath`, экспортируемую из `db.js`, и использовать её. Тогда в тесте можно ткнуть в `:memory:` — но `:memory:` не поддерживает backup на путь. Поэтому в тесте создадим временный файл.

В тесте перед `POST /api/backups` добавить создание файла:
```js
const Database = require('better-sqlite3')
const src = path.join(dir, '..', 'src.db')
new Database(src).exec('CREATE TABLE t(x)')
process.env.SRC_DB = src
```
И в server.js использовать `process.env.SRC_DB || path.join(__dirname,'data','uv.db')`.

- [ ] **Step 4: Тесты**

`npm test`. Зелёное.

- [ ] **Step 5: Коммит**

```bash
git add server.js tests/backups.api.test.js
git commit -m "feat(api): backups — list, create manual, download (admin only)"
```

---

## Task 32 (= 40): UI «Бэкап БД» в admin.html

**Files:**
- Modify: `public/admin.html`
- Modify: `public/js/admin.js`

- [ ] **Step 1: Разметка**

```html
<button data-tab="backup">Бэкап БД</button>
…
<section id="tab-backup" hidden>
  <h2>Бэкап БД</h2>
  <div id="backup-status"></div>
  <button id="backup-now">Скачать бэкап сейчас</button>
  <table id="backups-table">
    <thead><tr><th>Файл</th><th>Тип</th><th>Размер</th><th>Дата</th><th></th></tr></thead>
    <tbody></tbody>
  </table>
</section>
```

- [ ] **Step 2: Логика**

```js
async function loadBackups() {
  const list = await fetch('/api/backups').then(r=>r.json())
  const tbody = document.querySelector('#backups-table tbody')
  tbody.innerHTML = list.map(b =>
    `<tr><td>${b.filename}</td><td>${b.manual?'ручной':'авто'}</td><td>${(b.size/1024).toFixed(1)} КБ</td>
      <td>${b.mtime.replace('T',' ').slice(0,16)}</td>
      <td><a href="/api/backups/${b.filename}" download>Скачать</a></td></tr>`).join('')
  document.querySelector('#backup-status').textContent =
    list.length ? `Хранится: ${list.length} файлов` : 'Пока нет бэкапов'
}
document.querySelector('#backup-now').addEventListener('click', async () => {
  const r = await fetch('/api/backups',{method:'POST'})
  if (r.ok) { const b = await r.json(); window.open(`/api/backups/${b.filename}`) }
  loadBackups()
})
```

- [ ] **Step 3: Ручная проверка**

Открыть «Бэкап БД» под админом, нажать «Скачать бэкап сейчас» → файл скачивается, в списке появляется.

- [ ] **Step 4: Коммит**

```bash
git add public/admin.html public/js/admin.js
git commit -m "feat(ui): backup tab with list and manual download"
```

---

# Фаза H. Деплой

## Task 33 (= 42): nginx + systemd-юниты + install.sh + update.sh

**Files:**
- Create: `scripts/deploy/nginx.conf`
- Create: `scripts/deploy/uv-calc.service`
- Create: `scripts/deploy/uv-calc-backup.service`
- Create: `scripts/deploy/uv-calc-backup.timer`
- Create: `scripts/deploy/install.sh`
- Create: `scripts/deploy/update.sh`
- Create: `migrate.js`

- [ ] **Step 1: scripts/deploy/nginx.conf**

```nginx
server {
    listen 80;
    server_name calc.citi-print.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name calc.citi-print.ru;

    # certbot подставит ssl_certificate / ssl_certificate_key

    client_max_body_size 5m;

    limit_req_zone $binary_remote_addr zone=login_zone:10m rate=10r/m;

    location /api/login {
        limit_req zone=login_zone burst=5 nodelay;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- [ ] **Step 2: scripts/deploy/uv-calc.service**

```ini
[Unit]
Description=UV Calculator (citi-print)
After=network.target

[Service]
Type=simple
User=uvcalc
WorkingDirectory=/opt/uv-calc
EnvironmentFile=/opt/uv-calc/.env
ExecStart=/usr/bin/node /opt/uv-calc/server.js
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: scripts/deploy/uv-calc-backup.service**

```ini
[Unit]
Description=UV Calculator nightly DB backup

[Service]
Type=oneshot
User=uvcalc
WorkingDirectory=/opt/uv-calc
ExecStart=/usr/bin/node /opt/uv-calc/backup.js
```

- [ ] **Step 4: scripts/deploy/uv-calc-backup.timer**

```ini
[Unit]
Description=Daily UV Calculator DB backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
Unit=uv-calc-backup.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: migrate.js (тонкая обёртка)**

```js
// migrate.js
const { createDb } = require('./db')
createDb()
console.log('Migrations up to date.')
```

- [ ] **Step 6: scripts/deploy/install.sh**

```bash
#!/bin/bash
set -euo pipefail

# Запускать от root на свежей VDS Ubuntu 24.04
APP_USER=uvcalc
APP_DIR=/opt/uv-calc

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/uvcalc --shell /bin/bash $APP_USER
fi

mkdir -p $APP_DIR/data/{backups,pdfs,uploads}
chown -R $APP_USER:$APP_USER $APP_DIR

cd $APP_DIR
sudo -u $APP_USER npm ci --omit=dev

cp scripts/deploy/uv-calc.service /etc/systemd/system/
cp scripts/deploy/uv-calc-backup.service /etc/systemd/system/
cp scripts/deploy/uv-calc-backup.timer /etc/systemd/system/

cp scripts/deploy/nginx.conf /etc/nginx/sites-available/calc.citi-print.ru
ln -sf /etc/nginx/sites-available/calc.citi-print.ru /etc/nginx/sites-enabled/calc.citi-print.ru
nginx -t && systemctl reload nginx

systemctl daemon-reload

echo "Now run:"
echo "  sudo certbot --nginx -d calc.citi-print.ru"
echo "  sudo -u $APP_USER NODE_ENV=production node $APP_DIR/seed.js   # с ADMIN_EMAIL/ADMIN_PASS из .env"
echo "  systemctl enable --now uv-calc uv-calc-backup.timer"
```

- [ ] **Step 7: scripts/deploy/update.sh**

```bash
#!/bin/bash
set -euo pipefail
cd /opt/uv-calc
git pull
npm ci --omit=dev
node migrate.js
systemctl restart uv-calc
echo "Updated."
```

- [ ] **Step 8: Сделать скрипты исполняемыми и закоммитить**

```bash
chmod +x scripts/deploy/install.sh scripts/deploy/update.sh
git add scripts/deploy/ migrate.js
git commit -m "chore(deploy): nginx, systemd units, install/update scripts, migrate.js"
```

---

## Task 34 (= 43): Smoke-чек на деплое

**Files:** —

> Не делается локально — это запускается уже на боевой VDS после первого деплоя.

- [ ] **Step 1: Создать VDS, настроить DNS**

В Timeweb DNS: A-запись `calc.citi-print.ru` → IP VDS. Подождать пропагацию (`dig calc.citi-print.ru` показывает нужный IP).

- [ ] **Step 2: Установить пакеты**

```bash
apt update
apt install -y nginx nodejs npm certbot python3-certbot-nginx git
node -v   # должно быть 20+; если нет — поставить через nodesource
```

- [ ] **Step 3: Клонировать репо в /opt/uv-calc, создать .env**

```bash
git clone <repo-url> /opt/uv-calc
cd /opt/uv-calc
cat > .env <<EOF
PORT=3001
NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE=true
ADMIN_EMAIL=annaprint@mail.ru
ADMIN_PASS=<временный пароль>
EOF
chmod 600 .env
```

- [ ] **Step 4: Запустить install.sh**

```bash
bash scripts/deploy/install.sh
certbot --nginx -d calc.citi-print.ru
sudo -u uvcalc -E node seed.js
systemctl enable --now uv-calc uv-calc-backup.timer
```

- [ ] **Step 5: Проверить**

- `https://calc.citi-print.ru/login` открывается, серт валиден.
- Логин под `annaprint@mail.ru` + временный пароль работает.
- В шапке нажать «Сменить пароль», задать постоянный.
- В админке создать остальных 5 менеджеров.
- Сделать тестовый расчёт, сохранить КП с клиентом, скачать PDF — всё работает.
- `journalctl -u uv-calc-backup` через сутки в 03:00 покажет успешный запуск.
- В админке «Бэкап БД» появится файл `uv-YYYY-MM-DD.db`.

- [ ] **Step 6: Коммит**

> Здесь нет локальных изменений в репо — только манипуляции на сервере. Если в процессе вылезли мелкие правки конфигов — закоммитить их.

---

## Критерии готовности (DoD)

1. ✅ `npm test` зелёный (10+ тест-файлов).
2. ✅ Калькулятор открывается по `https://calc.citi-print.ru`, действует Let's Encrypt.
3. ✅ 6 менеджеров заведены (1 из них — Анна — с `is_admin=1`).
4. ✅ Менеджер сохраняет КП с привязкой к клиенту, скачивает брендированный PDF.
5. ✅ История КП фильтруется по 8 параметрам, сортируется по дате/сумме, пагинация по 50.
6. ✅ Раздел «Бэкап БД» показывает последние файлы; ручной бэкап скачивается и сохраняется.
7. ✅ Systemd-таймер сделал автобэкап в 03:00, файл появился в `data/backups/`.
8. ✅ `node migrate.js` идемпотентен (повторный запуск ничего не делает).
9. ✅ Откат через `git checkout <previous>` + `systemctl restart uv-calc` не ломает БД (миграции форвард-only, новые колонки не мешают старому коду).

---

## Замечания по выполнению

- **Порядок Task 7/8:** Task 8 (helpers) физически делается **до** Task 7 (middleware), иначе нечем писать тесты пермишенов. Я оставил нумерацию по логике, но в задаче 7 явно указано: помечай Task 8 (= 9) первым.
- **Тестовая БД и сессии:** в тестах session middleware использует MemoryStore (через ENV-флаг `NODE_ENV=test`), в проде — connect-sqlite3 в отдельном файле `data/sessions.db`.
- **Размер плана:** 8 фаз, ~30 задач, каждая с TDD. Если фаза кажется большой — после каждой фазы есть зелёное состояние, можно остановиться, сделать ревью с reviewer-агентом, и продолжить.
- **Шрифт DejaVu Sans (~700 КБ)** коммитится в репо — оправдано, потому что нужен на сервере и не меняется.
