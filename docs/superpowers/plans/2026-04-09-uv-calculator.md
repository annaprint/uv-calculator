# UV Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js web app for Сити Принт managers to calculate UV printing costs for sheet materials and souvenir products, with an admin panel to manage price tables.

**Architecture:** Express + SQLite backend with pure-function calculation module; vanilla JS frontend with two pages (manager calculator, admin panel). Calculation logic lives in `calc.js` (no DB/Express dependency) so it can be unit-tested without HTTP overhead.

**Tech Stack:** Node.js 20, Express 4, better-sqlite3, xlsx, multer, Jest, supertest

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | Dependencies and npm scripts |
| `server.js` | Express app + all API routes (uses db + calc) |
| `db.js` | SQLite init, schema creation, returns `db` instance |
| `calc.js` | Pure calculation functions — no DB, no HTTP |
| `data/uv.db` | SQLite database (git-ignored) |
| `public/index.html` | Manager calculator UI |
| `public/admin.html` | Admin panel UI |
| `public/js/calc-ui.js` | Frontend: fetches data, calls API, renders results |
| `public/js/admin.js` | Frontend: CRUD for all admin tables |
| `tests/calc.test.js` | Unit tests for calc.js |
| `tests/api.test.js` | Integration tests for all API routes |
| `tests/helpers.js` | Test DB factory (in-memory SQLite) |

---

## Task 1: Project Setup

**Files:**
- Create: `prices/package.json`
- Create: `prices/server.js`
- Create: `prices/data/.gitkeep`

- [ ] **Step 1: Initialise package.json**

```bash
cd "/Users/annakorotkih/Desktop/Claude Code Lab/prices"
npm init -y
```

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install express better-sqlite3 xlsx multer
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install --save-dev jest supertest
```

- [ ] **Step 4: Update package.json scripts and jest config**

Open `package.json` and replace the `"scripts"` and add `"jest"` key so the file looks like:

```json
{
  "name": "uv-calculator",
  "version": "1.0.0",
  "description": "УФ-печать калькулятор для Сити Принт",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "jest --testPathPattern=tests/"
  },
  "jest": {
    "testEnvironment": "node"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^6.3.4"
  }
}
```

- [ ] **Step 5: Create minimal server.js**

```js
// server.js
const express = require('express')
const path = require('path')
const { createDb } = require('./db')

const app = express()
const db = createDb()

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/health', (req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3001
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
}

module.exports = { app, db }
```

- [ ] **Step 6: Create data directory**

```bash
mkdir -p data && touch data/.gitkeep
```

- [ ] **Step 7: Add .gitignore**

Create `prices/.gitignore`:

```
node_modules/
data/uv.db
.superpowers/
```

- [ ] **Step 8: Commit**

```bash
cd "/Users/annakorotkih/Desktop/Claude Code Lab/prices"
git init
git add package.json package-lock.json server.js data/.gitkeep .gitignore
git commit -m "chore: project setup — express + sqlite + jest"
```

---

## Task 2: Database Module

**Files:**
- Create: `prices/db.js`

- [ ] **Step 1: Write the failing test**

Create `prices/tests/helpers.js`:

```js
// tests/helpers.js
const { createDb } = require('../db')

function makeTestDb() {
  return createDb(':memory:')
}

module.exports = { makeTestDb }
```

Create `prices/tests/api.test.js` with just the DB schema test:

```js
// tests/api.test.js
const { makeTestDb } = require('./helpers')

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
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/annakorotkih/Desktop/Claude Code Lab/prices"
npx jest tests/api.test.js -t "creates all required tables" --no-coverage
```

Expected: FAIL — `Cannot find module '../db'`

- [ ] **Step 3: Create db.js**

```js
// db.js
const Database = require('better-sqlite3')
const path = require('path')

function createDb(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, 'data', 'uv.db')
  const db = new Database(resolvedPath)

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

  return db
}

module.exports = { createDb }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/api.test.js -t "creates all required tables" --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add db.js tests/helpers.js tests/api.test.js
git commit -m "feat: database schema — 5 tables in SQLite"
```

---

## Task 3: Calculation Module

**Files:**
- Create: `prices/calc.js`
- Create: `prices/tests/calc.test.js`

- [ ] **Step 1: Write failing unit tests**

Create `prices/tests/calc.test.js`:

```js
// tests/calc.test.js
const { calcSheet, calcSouvenir } = require('../calc')

const MATERIALS = [
  { id: 1, name: 'Пенокартон', price_per_sqm: 3700 }
]

const TIERS = [
  { id: 1, min_sqm: 0,   price_per_sqm: 800 },
  { id: 2, min_sqm: 5,   price_per_sqm: 650 },
  { id: 3, min_sqm: 20,  price_per_sqm: 500 },
  { id: 4, min_sqm: 50,  price_per_sqm: 380 },
  { id: 5, min_sqm: 100, price_per_sqm: 280 }
]

const SOUVENIR_PRICES = [
  {
    id: 1,
    product_type: 'Ручки (пластик)',
    qty_up_to_29: 1500,
    qty_from_30: 45,
    qty_from_100: 29,
    qty_from_500: 20,
    qty_from_1000: 14
  }
]

describe('calcSheet', () => {
  test('basic: material + print, no options', () => {
    // 600×900mm × 50 шт = 27 м²  → ступень от 20 м² (500 ₽/м²)
    // material: 3700 × 27 = 99 900
    // print:    500  × 27 = 13 500
    // total:               113 400
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 0, urgent: false },
      MATERIALS, TIERS
    )
    expect(r.totalSqm).toBeCloseTo(27)
    expect(r.tierApplied).toBe(20)
    expect(r.printCost).toBeCloseTo(13500)
    expect(r.materialCost).toBeCloseTo(99900)
    expect(r.total).toBeCloseTo(113400)
    expect(r.pricePerUnit).toBeCloseTo(2268)
  })

  test('client material: only print cost', () => {
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: null, clientMaterial: true, uvVarnish: false, reliefLayers: 0, urgent: false },
      MATERIALS, TIERS
    )
    expect(r.materialCost).toBe(0)
    expect(r.total).toBeCloseTo(13500)
  })

  test('uv varnish adds 30% to base print cost', () => {
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: 1, clientMaterial: false, uvVarnish: true, reliefLayers: 0, urgent: false },
      MATERIALS, TIERS
    )
    // base print 13500, varnish +30% = 4050, total print = 17550
    expect(r.printCost).toBeCloseTo(17550)
  })

  test('2 relief layers add 60% to base print cost', () => {
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 2, urgent: false },
      MATERIALS, TIERS
    )
    // base print 13500, 2 layers × 30% = 8100, total print = 21600
    expect(r.printCost).toBeCloseTo(21600)
  })

  test('urgent adds 30% to full subtotal', () => {
    const r = calcSheet(
      { widthMm: 600, heightMm: 900, qty: 50, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 0, urgent: true },
      MATERIALS, TIERS
    )
    // subtotal 113400 × 1.30 = 147420
    expect(r.total).toBeCloseTo(147420)
  })

  test('selects correct tier for small order', () => {
    // 200×300mm × 1 = 0.06 м²  → ступень от 0 м² (800 ₽/м²)
    const r = calcSheet(
      { widthMm: 200, heightMm: 300, qty: 1, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 0, urgent: false },
      MATERIALS, TIERS
    )
    expect(r.tierApplied).toBe(0)
    expect(r.printCost).toBeCloseTo(0.06 * 800)
  })

  test('throws if no tier found', () => {
    expect(() =>
      calcSheet(
        { widthMm: 100, heightMm: 100, qty: 1, materialId: 1, clientMaterial: false, uvVarnish: false, reliefLayers: 0, urgent: false },
        MATERIALS, []
      )
    ).toThrow('No applicable tier')
  })
})

describe('calcSouvenir', () => {
  test('qty < 30 uses fixed batch price', () => {
    const r = calcSouvenir(
      { productTypeId: 1, qty: 10, uvVarnish: false, reliefLayers: 0, urgent: false },
      SOUVENIR_PRICES
    )
    expect(r.base).toBe(1500)
    expect(r.total).toBe(1500)
  })

  test('qty >= 100 uses per-unit price', () => {
    const r = calcSouvenir(
      { productTypeId: 1, qty: 100, uvVarnish: false, reliefLayers: 0, urgent: false },
      SOUVENIR_PRICES
    )
    // 29 × 100 = 2900
    expect(r.base).toBeCloseTo(2900)
    expect(r.total).toBeCloseTo(2900)
  })

  test('uv varnish adds 30% to base', () => {
    const r = calcSouvenir(
      { productTypeId: 1, qty: 100, uvVarnish: true, reliefLayers: 0, urgent: false },
      SOUVENIR_PRICES
    )
    // base 2900, +30% = 3770
    expect(r.total).toBeCloseTo(3770)
  })

  test('urgent adds 30% to full total', () => {
    const r = calcSouvenir(
      { productTypeId: 1, qty: 100, uvVarnish: false, reliefLayers: 0, urgent: true },
      SOUVENIR_PRICES
    )
    // 2900 × 1.30 = 3770
    expect(r.total).toBeCloseTo(3770)
  })

  test('throws if product type not found', () => {
    expect(() =>
      calcSouvenir({ productTypeId: 99, qty: 100, uvVarnish: false, reliefLayers: 0, urgent: false }, SOUVENIR_PRICES)
    ).toThrow('Product type not found')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/calc.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../calc'`

- [ ] **Step 3: Implement calc.js**

```js
// calc.js

function calcSheet({ widthMm, heightMm, qty, materialId, clientMaterial, uvVarnish, reliefLayers, urgent }, materials, tiers) {
  const totalSqm = (widthMm / 1000) * (heightMm / 1000) * qty

  const applicableTiers = tiers.filter(t => t.min_sqm <= totalSqm)
  if (applicableTiers.length === 0) throw new Error('No applicable tier found')
  const tier = applicableTiers.sort((a, b) => b.min_sqm - a.min_sqm)[0]

  const basePrintCost = tier.price_per_sqm * totalSqm
  let printCost = basePrintCost
  if (uvVarnish) printCost += basePrintCost * 0.30
  for (let i = 0; i < reliefLayers; i++) printCost += basePrintCost * 0.30

  let materialCost = 0
  if (!clientMaterial) {
    const material = materials.find(m => m.id === materialId)
    if (!material) throw new Error('Material not found')
    materialCost = material.price_per_sqm * totalSqm
  }

  let subtotal = materialCost + printCost
  if (urgent) subtotal *= 1.30

  return {
    totalSqm: +totalSqm.toFixed(4),
    tierApplied: tier.min_sqm,
    basePrintCost: +basePrintCost.toFixed(2),
    printCost: +printCost.toFixed(2),
    materialCost: +materialCost.toFixed(2),
    total: +subtotal.toFixed(2),
    pricePerUnit: +(subtotal / qty).toFixed(2)
  }
}

function calcSouvenir({ productTypeId, qty, uvVarnish, reliefLayers, urgent }, prices) {
  const price = prices.find(p => p.id === productTypeId)
  if (!price) throw new Error('Product type not found')

  let base
  if (qty < 30)        base = price.qty_up_to_29
  else if (qty < 100)  base = price.qty_from_30  * qty
  else if (qty < 500)  base = price.qty_from_100 * qty
  else if (qty < 1000) base = price.qty_from_500 * qty
  else                 base = price.qty_from_1000 * qty

  const baseCost = base
  if (uvVarnish) base += baseCost * 0.30
  for (let i = 0; i < reliefLayers; i++) base += baseCost * 0.30
  if (urgent) base *= 1.30

  const tierApplied = qty < 30 ? 'up_to_29'
    : qty < 100  ? 'from_30'
    : qty < 500  ? 'from_100'
    : qty < 1000 ? 'from_500'
    : 'from_1000'

  return {
    base: +baseCost.toFixed(2),
    total: +base.toFixed(2),
    pricePerUnit: +(base / qty).toFixed(2),
    tierApplied
  }
}

module.exports = { calcSheet, calcSouvenir }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/calc.test.js --no-coverage
```

Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add calc.js tests/calc.test.js
git commit -m "feat: calculation module with unit tests (sheet + souvenir)"
```

---

## Task 4: Materials & Sheet Tiers API

**Files:**
- Modify: `prices/server.js`
- Modify: `prices/tests/api.test.js`

- [ ] **Step 1: Add API tests for materials and sheet tiers**

Append to `tests/api.test.js`:

```js
const request = require('supertest')
const { makeTestDb } = require('./helpers')

let app, db

beforeEach(() => {
  db = makeTestDb()
  // Re-require app with test db
  jest.resetModules()
  jest.doMock('../db', () => ({ createDb: () => db }))
  const mod = require('../server')
  app = mod.app
})

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('materials API', () => {
  test('GET /api/materials returns empty array initially', async () => {
    const res = await request(app).get('/api/materials')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  test('POST /api/materials creates a material', async () => {
    const res = await request(app)
      .post('/api/materials')
      .send({ name: 'Картон', price_per_sqm: 2000 })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Картон')
  })

  test('PUT /api/materials/:id updates price', async () => {
    const created = await request(app)
      .post('/api/materials')
      .send({ name: 'Картон', price_per_sqm: 2000 })
    const res = await request(app)
      .put(`/api/materials/${created.body.id}`)
      .send({ name: 'Картон', price_per_sqm: 2200 })
    expect(res.status).toBe(200)
    expect(res.body.price_per_sqm).toBe(2200)
  })

  test('DELETE /api/materials/:id removes material', async () => {
    const created = await request(app)
      .post('/api/materials')
      .send({ name: 'Картон', price_per_sqm: 2000 })
    const del = await request(app).delete(`/api/materials/${created.body.id}`)
    expect(del.status).toBe(200)
    const list = await request(app).get('/api/materials')
    expect(list.body).toHaveLength(0)
  })
})

describe('sheet tiers API', () => {
  test('POST /api/sheet-tiers creates a tier', async () => {
    const res = await request(app)
      .post('/api/sheet-tiers')
      .send({ min_sqm: 0, price_per_sqm: 800 })
    expect(res.status).toBe(201)
    expect(res.body.min_sqm).toBe(0)
  })

  test('GET /api/sheet-tiers returns sorted by min_sqm', async () => {
    await request(app).post('/api/sheet-tiers').send({ min_sqm: 20, price_per_sqm: 500 })
    await request(app).post('/api/sheet-tiers').send({ min_sqm: 0,  price_per_sqm: 800 })
    const res = await request(app).get('/api/sheet-tiers')
    expect(res.body[0].min_sqm).toBe(0)
    expect(res.body[1].min_sqm).toBe(20)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/api.test.js --no-coverage
```

Expected: FAIL — routes not found (404)

- [ ] **Step 3: Add materials and sheet-tiers routes to server.js**

Replace `server.js` with:

```js
// server.js
const express = require('express')
const path = require('path')
const multer = require('multer')
const XLSX = require('xlsx')
const { createDb } = require('./db')
const { calcSheet, calcSouvenir } = require('./calc')

const app = express()
const db = createDb()
const upload = multer({ storage: multer.memoryStorage() })

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }))

// ── Sheet Materials ───────────────────────────────────────────────────────
app.get('/api/materials', (req, res) => {
  res.json(db.prepare('SELECT * FROM sheet_materials WHERE active=1 ORDER BY name').all())
})

app.post('/api/materials', (req, res) => {
  const { name, price_per_sqm } = req.body
  if (!name || price_per_sqm == null) return res.status(400).json({ error: 'name and price_per_sqm required' })
  const stmt = db.prepare('INSERT INTO sheet_materials (name, price_per_sqm) VALUES (?, ?)')
  const info = stmt.run(name, price_per_sqm)
  res.status(201).json(db.prepare('SELECT * FROM sheet_materials WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/materials/:id', (req, res) => {
  const { name, price_per_sqm } = req.body
  db.prepare('UPDATE sheet_materials SET name=?, price_per_sqm=? WHERE id=?').run(name, price_per_sqm, req.params.id)
  res.json(db.prepare('SELECT * FROM sheet_materials WHERE id=?').get(req.params.id))
})

app.delete('/api/materials/:id', (req, res) => {
  db.prepare('DELETE FROM sheet_materials WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Sheet Tiers ───────────────────────────────────────────────────────────
app.get('/api/sheet-tiers', (req, res) => {
  res.json(db.prepare('SELECT * FROM sheet_tiers ORDER BY min_sqm ASC').all())
})

app.post('/api/sheet-tiers', (req, res) => {
  const { min_sqm, price_per_sqm } = req.body
  if (min_sqm == null || price_per_sqm == null) return res.status(400).json({ error: 'min_sqm and price_per_sqm required' })
  const info = db.prepare('INSERT INTO sheet_tiers (min_sqm, price_per_sqm) VALUES (?, ?)').run(min_sqm, price_per_sqm)
  res.status(201).json(db.prepare('SELECT * FROM sheet_tiers WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/sheet-tiers/:id', (req, res) => {
  const { min_sqm, price_per_sqm } = req.body
  db.prepare('UPDATE sheet_tiers SET min_sqm=?, price_per_sqm=? WHERE id=?').run(min_sqm, price_per_sqm, req.params.id)
  res.json(db.prepare('SELECT * FROM sheet_tiers WHERE id=?').get(req.params.id))
})

app.delete('/api/sheet-tiers/:id', (req, res) => {
  db.prepare('DELETE FROM sheet_tiers WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Souvenir Prices ───────────────────────────────────────────────────────
app.get('/api/souvenir-prices', (req, res) => {
  res.json(db.prepare('SELECT * FROM souvenir_prices ORDER BY product_type').all())
})

app.post('/api/souvenir-prices', (req, res) => {
  const { product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000 } = req.body
  const info = db.prepare(
    'INSERT INTO souvenir_prices (product_type,qty_up_to_29,qty_from_30,qty_from_100,qty_from_500,qty_from_1000) VALUES (?,?,?,?,?,?)'
  ).run(product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000)
  res.status(201).json(db.prepare('SELECT * FROM souvenir_prices WHERE id=?').get(info.lastInsertRowid))
})

app.put('/api/souvenir-prices/:id', (req, res) => {
  const { product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000 } = req.body
  db.prepare(
    'UPDATE souvenir_prices SET product_type=?,qty_up_to_29=?,qty_from_30=?,qty_from_100=?,qty_from_500=?,qty_from_1000=? WHERE id=?'
  ).run(product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, req.params.id)
  res.json(db.prepare('SELECT * FROM souvenir_prices WHERE id=?').get(req.params.id))
})

app.delete('/api/souvenir-prices/:id', (req, res) => {
  db.prepare('DELETE FROM souvenir_prices WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Catalog ───────────────────────────────────────────────────────────────
app.get('/api/catalog', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%'
  res.json(db.prepare(
    'SELECT c.*, s.product_type FROM catalog_items c LEFT JOIN souvenir_prices s ON c.souvenir_price_id=s.id WHERE c.name LIKE ? OR c.article LIKE ? ORDER BY c.name'
  ).all(q, q))
})

app.post('/api/catalog/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws)

  const upsert = db.prepare(`
    INSERT INTO catalog_items (article, name, description, colors, photo_url)
    VALUES (@article, @name, @description, @colors, @photo_url)
    ON CONFLICT(article) DO UPDATE SET
      name=excluded.name, description=excluded.description,
      colors=excluded.colors, photo_url=excluded.photo_url
  `)
  const importMany = db.transaction((rows) => {
    let count = 0
    for (const row of rows) {
      if (!row['Артикул']) continue
      upsert.run({
        article:     String(row['Артикул']),
        name:        row['Название'] || '',
        description: row['Описание'] || null,
        colors:      row['Цвета'] || null,
        photo_url:   row['Фото (URL)'] || null
      })
      count++
    }
    return count
  })
  const count = importMany(rows)
  res.json({ imported: count })
})

app.put('/api/catalog/:id/price-type', (req, res) => {
  const { souvenir_price_id } = req.body
  db.prepare('UPDATE catalog_items SET souvenir_price_id=? WHERE id=?').run(souvenir_price_id || null, req.params.id)
  res.json(db.prepare('SELECT * FROM catalog_items WHERE id=?').get(req.params.id))
})

// ── Calculations ──────────────────────────────────────────────────────────
app.post('/api/calc/sheet', (req, res) => {
  try {
    const materials = db.prepare('SELECT * FROM sheet_materials WHERE active=1').all()
    const tiers = db.prepare('SELECT * FROM sheet_tiers ORDER BY min_sqm').all()
    const result = calcSheet(req.body, materials, tiers)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/calc/souvenir', (req, res) => {
  try {
    const prices = db.prepare('SELECT * FROM souvenir_prices').all()
    const result = calcSouvenir(req.body, prices)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ── Quotes ────────────────────────────────────────────────────────────────
app.get('/api/quotes', (req, res) => {
  res.json(db.prepare('SELECT * FROM quotes ORDER BY created_at DESC').all())
})

app.post('/api/quotes', (req, res) => {
  const { type, params, result, kp_text } = req.body
  if (!type || !params || !result || !kp_text) return res.status(400).json({ error: 'type, params, result, kp_text required' })
  const info = db.prepare(
    'INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)'
  ).run(type, JSON.stringify(params), JSON.stringify(result), kp_text)
  res.status(201).json(db.prepare('SELECT * FROM quotes WHERE id=?').get(info.lastInsertRowid))
})

app.delete('/api/quotes/:id', (req, res) => {
  db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

const PORT = process.env.PORT || 3001
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
}

module.exports = { app, db }
```

- [ ] **Step 4: Run all API tests**

```bash
npx jest tests/api.test.js --no-coverage
```

Expected: PASS — all materials and sheet-tiers tests pass

- [ ] **Step 5: Commit**

```bash
git add server.js tests/api.test.js
git commit -m "feat: materials, sheet-tiers, souvenir-prices, catalog, calc and quotes API routes"
```

---

## Task 5: Souvenir Prices & Calc API Tests

**Files:**
- Modify: `prices/tests/api.test.js`

- [ ] **Step 1: Add souvenir prices and calculation tests**

Append to `tests/api.test.js`:

```js
describe('souvenir prices API', () => {
  test('POST /api/souvenir-prices creates a price entry', async () => {
    const res = await request(app).post('/api/souvenir-prices').send({
      product_type: 'Ручки (пластик)',
      qty_up_to_29: 1500,
      qty_from_30: 45,
      qty_from_100: 29,
      qty_from_500: 20,
      qty_from_1000: 14
    })
    expect(res.status).toBe(201)
    expect(res.body.product_type).toBe('Ручки (пластик)')
  })
})

describe('POST /api/calc/sheet', () => {
  beforeEach(async () => {
    await request(app).post('/api/materials').send({ name: 'Картон', price_per_sqm: 2000 })
    await request(app).post('/api/sheet-tiers').send({ min_sqm: 0, price_per_sqm: 800 })
    await request(app).post('/api/sheet-tiers').send({ min_sqm: 20, price_per_sqm: 500 })
  })

  test('returns calculation result', async () => {
    const matRes = await request(app).get('/api/materials')
    const res = await request(app).post('/api/calc/sheet').send({
      widthMm: 600, heightMm: 900, qty: 50,
      materialId: matRes.body[0].id,
      clientMaterial: false,
      uvVarnish: false, reliefLayers: 0, urgent: false
    })
    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThan(0)
    expect(res.body.pricePerUnit).toBeGreaterThan(0)
  })

  test('returns 400 for invalid params', async () => {
    const res = await request(app).post('/api/calc/sheet').send({
      widthMm: 100, heightMm: 100, qty: 1, clientMaterial: true,
      uvVarnish: false, reliefLayers: 0, urgent: false
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/calc/souvenir', () => {
  beforeEach(async () => {
    await request(app).post('/api/souvenir-prices').send({
      product_type: 'Ручки (пластик)',
      qty_up_to_29: 1500, qty_from_30: 45,
      qty_from_100: 29, qty_from_500: 20, qty_from_1000: 14
    })
  })

  test('returns calculation for qty >= 100', async () => {
    const prices = await request(app).get('/api/souvenir-prices')
    const res = await request(app).post('/api/calc/souvenir').send({
      productTypeId: prices.body[0].id,
      qty: 100, uvVarnish: false, reliefLayers: 0, urgent: false
    })
    expect(res.status).toBe(200)
    expect(res.body.total).toBeCloseTo(2900)
  })
})

describe('quotes API', () => {
  test('POST then GET /api/quotes', async () => {
    await request(app).post('/api/quotes').send({
      type: 'sheet',
      params: { widthMm: 600 },
      result: { total: 5000 },
      kp_text: 'КП тест'
    })
    const res = await request(app).get('/api/quotes')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].kp_text).toBe('КП тест')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
npx jest tests/ --no-coverage
```

Expected: PASS — all tests

- [ ] **Step 3: Commit**

```bash
git add tests/api.test.js
git commit -m "test: souvenir prices, calc API and quotes integration tests"
```

---

## Task 6: Admin UI

**Files:**
- Create: `prices/public/admin.html`
- Create: `prices/public/js/admin.js`

- [ ] **Step 1: Create admin.html**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Администратор — УФ-печать</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f1f5f9; color: #1e293b; display: flex; min-height: 100vh; }
    .sidebar { width: 220px; background: #1e293b; color: #cbd5e1; padding: 20px 0; flex-shrink: 0; }
    .sidebar h1 { font-size: 14px; font-weight: 700; padding: 0 20px 16px; color: #f8fafc; border-bottom: 1px solid #334155; }
    .nav-item { display: block; padding: 11px 20px; font-size: 13px; cursor: pointer; border-left: 3px solid transparent; }
    .nav-item:hover { background: #334155; color: #f8fafc; }
    .nav-item.active { background: #334155; color: #60a5fa; border-left-color: #60a5fa; }
    .main { flex: 1; padding: 24px; overflow-y: auto; }
    .section { display: none; }
    .section.active { display: block; }
    h2 { font-size: 18px; margin-bottom: 16px; }
    .hint { font-size: 12px; color: #94a3b8; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 16px; }
    th { background: #f8fafc; padding: 10px 12px; text-align: left; font-size: 12px; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
    td { padding: 9px 12px; font-size: 13px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    input[type=text], input[type=number], select { border: 1px solid #e2e8f0; border-radius: 5px; padding: 6px 10px; font-size: 13px; width: 100%; }
    input[type=number] { width: 90px; }
    .btn { padding: 7px 14px; border-radius: 5px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary { background: #3b82f6; color: white; }
    .btn-primary:hover { background: #2563eb; }
    .btn-success { background: #22c55e; color: white; }
    .btn-success:hover { background: #16a34a; }
    .btn-danger { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 16px; padding: 4px 8px; }
    .btn-danger:hover { color: #dc2626; }
    .add-row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .save-btn { width: 100%; padding: 10px; }
    .toast { position: fixed; bottom: 24px; right: 24px; background: #22c55e; color: white; padding: 10px 18px; border-radius: 8px; font-size: 13px; display: none; z-index: 100; }
    .import-box { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 16px; }
    .import-info { font-size: 13px; color: #64748b; margin-top: 8px; }
  </style>
</head>
<body>

<nav class="sidebar">
  <h1>⚙️ Администратор</h1>
  <div class="nav-item active" onclick="showSection('materials')">📄 Листовые материалы</div>
  <div class="nav-item" onclick="showSection('tiers')">📐 Ступени листовой</div>
  <div class="nav-item" onclick="showSection('souvenir')">🎁 Сувенирная печать</div>
  <div class="nav-item" onclick="showSection('catalog')">📦 Каталог товаров</div>
  <div class="nav-item" onclick="showSection('quotes')">📋 Сохранённые КП</div>
  <div style="position:absolute;bottom:16px;left:0;right:0;padding:0 20px;">
    <a href="/" style="color:#94a3b8;font-size:12px;text-decoration:none;">← Калькулятор</a>
  </div>
</nav>

<main class="main">

  <!-- Materials -->
  <div id="sec-materials" class="section active">
    <h2>Листовые материалы</h2>
    <p class="hint">Базовая стоимость материала ₽/м². Надпечатка рассчитывается отдельно по ступеням.</p>
    <div class="add-row">
      <input type="text" id="mat-name" placeholder="Название материала" style="width:200px;">
      <input type="number" id="mat-price" placeholder="₽/м²" style="width:100px;" min="0">
      <button class="btn btn-primary" onclick="addMaterial()">+ Добавить</button>
    </div>
    <table>
      <thead><tr><th>Материал</th><th>₽/м²</th><th></th></tr></thead>
      <tbody id="materials-body"></tbody>
    </table>
    <button class="btn btn-success save-btn" onclick="saveMaterials()">💾 Сохранить изменения</button>
  </div>

  <!-- Sheet Tiers -->
  <div id="sec-tiers" class="section">
    <h2>Ступени листовой печати</h2>
    <p class="hint">Цена надпечатки ₽/м² зависит от общей площади заказа. Применяется наибольшая подходящая ступень.</p>
    <div class="add-row">
      <input type="number" id="tier-min" placeholder="От, м²" style="width:100px;" min="0">
      <input type="number" id="tier-price" placeholder="₽/м²" style="width:100px;" min="0">
      <button class="btn btn-primary" onclick="addTier()">+ Добавить</button>
    </div>
    <table>
      <thead><tr><th>От, м²</th><th>₽/м² надпечатки</th><th></th></tr></thead>
      <tbody id="tiers-body"></tbody>
    </table>
    <button class="btn btn-success save-btn" onclick="saveTiers()">💾 Сохранить изменения</button>
  </div>

  <!-- Souvenir -->
  <div id="sec-souvenir" class="section">
    <h2>Сувенирная печать</h2>
    <p class="hint">Цена за 1 изделие по тиражным ступеням. Для тиража до 29 шт. — фиксированная сумма за весь тираж.</p>
    <div class="add-row">
      <input type="text" id="souv-type" placeholder="Тип товара" style="width:180px;">
      <input type="number" id="souv-29" placeholder="до 29" style="width:75px;" min="0">
      <input type="number" id="souv-30" placeholder="от 30" style="width:75px;" min="0">
      <input type="number" id="souv-100" placeholder="от 100" style="width:75px;" min="0">
      <input type="number" id="souv-500" placeholder="от 500" style="width:75px;" min="0">
      <input type="number" id="souv-1000" placeholder="от 1000" style="width:80px;" min="0">
      <button class="btn btn-primary" onclick="addSouvenirPrice()">+ Добавить</button>
    </div>
    <table style="font-size:12px;">
      <thead><tr><th>Тип товара</th><th>до 29</th><th>от 30</th><th>от 100</th><th>от 500</th><th>от 1000</th><th></th></tr></thead>
      <tbody id="souvenir-body"></tbody>
    </table>
    <button class="btn btn-success save-btn" onclick="saveSouvenir()">💾 Сохранить изменения</button>
  </div>

  <!-- Catalog -->
  <div id="sec-catalog" class="section">
    <h2>Каталог товаров</h2>
    <div class="import-box">
      <label class="btn btn-primary" style="cursor:pointer;">
        📂 Загрузить catalog.xlsx
        <input type="file" id="xlsx-input" accept=".xlsx" style="display:none;" onchange="importCatalog(this)">
      </label>
      <p class="import-info" id="import-info">Выберите файл для импорта</p>
    </div>
    <input type="text" id="catalog-search" placeholder="Поиск по названию или артикулу..." oninput="loadCatalog()" style="margin-bottom:12px; width:100%; max-width:400px;">
    <table>
      <thead><tr><th>Артикул</th><th>Название</th><th>Цвета</th><th>Тип печати (привязка)</th></tr></thead>
      <tbody id="catalog-body"></tbody>
    </table>
  </div>

  <!-- Quotes -->
  <div id="sec-quotes" class="section">
    <h2>Сохранённые КП</h2>
    <table>
      <thead><tr><th>Дата</th><th>Тип</th><th>Итого</th><th>Текст КП</th><th></th></tr></thead>
      <tbody id="quotes-body"></tbody>
    </table>
  </div>

</main>

<div class="toast" id="toast">Сохранено ✓</div>

<script src="/js/admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create admin.js**

```js
// public/js/admin.js

// ── Navigation ────────────────────────────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  document.getElementById('sec-' + name).classList.add('active')
  event.target.classList.add('active')
  if (name === 'materials') loadMaterials()
  if (name === 'tiers') loadTiers()
  if (name === 'souvenir') loadSouvenir()
  if (name === 'catalog') loadCatalog()
  if (name === 'quotes') loadQuotes()
}

function showToast(msg = 'Сохранено ✓') {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.style.display = 'block'
  setTimeout(() => { t.style.display = 'none' }, 2500)
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Materials ─────────────────────────────────────────────────────────────
let materials = []

async function loadMaterials() {
  materials = await api('GET', '/api/materials')
  renderMaterials()
}

function renderMaterials() {
  document.getElementById('materials-body').innerHTML = materials.map((m, i) => `
    <tr>
      <td><input type="text" value="${esc(m.name)}" onchange="materials[${i}].name=this.value"></td>
      <td><input type="number" value="${m.price_per_sqm}" onchange="materials[${i}].price_per_sqm=+this.value" style="width:90px;"></td>
      <td><button class="btn-danger" onclick="deleteMaterial(${m.id},${i})">✕</button></td>
    </tr>`).join('')
}

async function addMaterial() {
  const name = document.getElementById('mat-name').value.trim()
  const price = +document.getElementById('mat-price').value
  if (!name || !price) return alert('Заполните название и цену')
  const m = await api('POST', '/api/materials', { name, price_per_sqm: price })
  materials.push(m)
  document.getElementById('mat-name').value = ''
  document.getElementById('mat-price').value = ''
  renderMaterials()
}

async function deleteMaterial(id, i) {
  if (!confirm('Удалить материал?')) return
  await api('DELETE', '/api/materials/' + id)
  materials.splice(i, 1)
  renderMaterials()
}

async function saveMaterials() {
  for (const m of materials) {
    await api('PUT', '/api/materials/' + m.id, { name: m.name, price_per_sqm: m.price_per_sqm })
  }
  showToast()
}

// ── Sheet Tiers ───────────────────────────────────────────────────────────
let tiers = []

async function loadTiers() {
  tiers = await api('GET', '/api/sheet-tiers')
  renderTiers()
}

function renderTiers() {
  document.getElementById('tiers-body').innerHTML = tiers.map((t, i) => `
    <tr>
      <td><input type="number" value="${t.min_sqm}" onchange="tiers[${i}].min_sqm=+this.value" style="width:90px;"> м²</td>
      <td><input type="number" value="${t.price_per_sqm}" onchange="tiers[${i}].price_per_sqm=+this.value" style="width:90px;"></td>
      <td><button class="btn-danger" onclick="deleteTier(${t.id},${i})">✕</button></td>
    </tr>`).join('')
}

async function addTier() {
  const min_sqm = +document.getElementById('tier-min').value
  const price = +document.getElementById('tier-price').value
  if (price == null || isNaN(min_sqm)) return alert('Заполните ступень и цену')
  const t = await api('POST', '/api/sheet-tiers', { min_sqm, price_per_sqm: price })
  tiers.push(t)
  tiers.sort((a, b) => a.min_sqm - b.min_sqm)
  document.getElementById('tier-min').value = ''
  document.getElementById('tier-price').value = ''
  renderTiers()
}

async function deleteTier(id, i) {
  if (!confirm('Удалить ступень?')) return
  await api('DELETE', '/api/sheet-tiers/' + id)
  tiers.splice(i, 1)
  renderTiers()
}

async function saveTiers() {
  for (const t of tiers) {
    await api('PUT', '/api/sheet-tiers/' + t.id, { min_sqm: t.min_sqm, price_per_sqm: t.price_per_sqm })
  }
  showToast()
}

// ── Souvenir Prices ───────────────────────────────────────────────────────
let souvenirPrices = []

async function loadSouvenir() {
  souvenirPrices = await api('GET', '/api/souvenir-prices')
  renderSouvenir()
}

function renderSouvenir() {
  document.getElementById('souvenir-body').innerHTML = souvenirPrices.map((p, i) => `
    <tr>
      <td><input type="text" value="${esc(p.product_type)}" onchange="souvenirPrices[${i}].product_type=this.value" style="width:150px;"></td>
      <td><input type="number" value="${p.qty_up_to_29}"  onchange="souvenirPrices[${i}].qty_up_to_29=+this.value"  style="width:70px;"></td>
      <td><input type="number" value="${p.qty_from_30}"   onchange="souvenirPrices[${i}].qty_from_30=+this.value"   style="width:70px;"></td>
      <td><input type="number" value="${p.qty_from_100}"  onchange="souvenirPrices[${i}].qty_from_100=+this.value"  style="width:70px;"></td>
      <td><input type="number" value="${p.qty_from_500}"  onchange="souvenirPrices[${i}].qty_from_500=+this.value"  style="width:70px;"></td>
      <td><input type="number" value="${p.qty_from_1000}" onchange="souvenirPrices[${i}].qty_from_1000=+this.value" style="width:75px;"></td>
      <td><button class="btn-danger" onclick="deleteSouvenir(${p.id},${i})">✕</button></td>
    </tr>`).join('')
}

async function addSouvenirPrice() {
  const vals = {
    product_type:  document.getElementById('souv-type').value.trim(),
    qty_up_to_29:  +document.getElementById('souv-29').value,
    qty_from_30:   +document.getElementById('souv-30').value,
    qty_from_100:  +document.getElementById('souv-100').value,
    qty_from_500:  +document.getElementById('souv-500').value,
    qty_from_1000: +document.getElementById('souv-1000').value
  }
  if (!vals.product_type) return alert('Введите тип товара')
  const p = await api('POST', '/api/souvenir-prices', vals)
  souvenirPrices.push(p)
  ;['souv-type','souv-29','souv-30','souv-100','souv-500','souv-1000'].forEach(id => document.getElementById(id).value = '')
  renderSouvenir()
}

async function deleteSouvenir(id, i) {
  if (!confirm('Удалить тип товара?')) return
  await api('DELETE', '/api/souvenir-prices/' + id)
  souvenirPrices.splice(i, 1)
  renderSouvenir()
}

async function saveSouvenir() {
  for (const p of souvenirPrices) {
    await api('PUT', '/api/souvenir-prices/' + p.id, p)
  }
  showToast()
}

// ── Catalog ───────────────────────────────────────────────────────────────
async function loadCatalog() {
  const q = document.getElementById('catalog-search')?.value || ''
  const [items, prices] = await Promise.all([
    api('GET', '/api/catalog' + (q ? `?q=${encodeURIComponent(q)}` : '')),
    api('GET', '/api/souvenir-prices')
  ])
  const priceOptions = prices.map(p => `<option value="${p.id}">${esc(p.product_type)}</option>`).join('')
  document.getElementById('catalog-body').innerHTML = items.map(item => `
    <tr>
      <td style="font-size:11px;color:#64748b;">${esc(item.article)}</td>
      <td>${esc(item.name)}</td>
      <td style="font-size:11px;color:#94a3b8;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.colors || '')}</td>
      <td>
        <select style="font-size:12px;" onchange="linkCatalogItem(${item.id}, this.value)">
          <option value="">— не привязан —</option>
          ${priceOptions.replace(`value="${item.souvenir_price_id}"`, `value="${item.souvenir_price_id}" selected`)}
        </select>
      </td>
    </tr>`).join('')
}

async function linkCatalogItem(id, priceId) {
  await api('PUT', '/api/catalog/' + id + '/price-type', { souvenir_price_id: priceId || null })
  showToast('Привязка сохранена ✓')
}

async function importCatalog(input) {
  const file = input.files[0]
  if (!file) return
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/catalog/import', { method: 'POST', body: fd })
  const data = await res.json()
  document.getElementById('import-info').textContent = `Импортировано: ${data.imported} товаров · ${new Date().toLocaleDateString('ru-RU')}`
  loadCatalog()
}

// ── Quotes ────────────────────────────────────────────────────────────────
async function loadQuotes() {
  const quotes = await api('GET', '/api/quotes')
  document.getElementById('quotes-body').innerHTML = quotes.map(q => {
    const res = JSON.parse(q.result)
    return `<tr>
      <td style="font-size:12px;color:#64748b;">${q.created_at}</td>
      <td>${q.type === 'sheet' ? '📄 Листовая' : '🎁 Сувенирная'}</td>
      <td style="font-weight:600;">${res.total?.toLocaleString('ru-RU')} ₽</td>
      <td style="font-size:12px;max-width:200px;white-space:pre-wrap;">${esc(q.kp_text)}</td>
      <td><button class="btn-danger" onclick="deleteQuote(${q.id})">✕</button></td>
    </tr>`
  }).join('')
}

async function deleteQuote(id) {
  if (!confirm('Удалить КП?')) return
  await api('DELETE', '/api/quotes/' + id)
  loadQuotes()
}

// ── Utility ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// Init
loadMaterials()
```

- [ ] **Step 3: Manually verify admin UI**

```bash
cd "/Users/annakorotkih/Desktop/Claude Code Lab/prices"
node server.js
```

Open http://localhost:3001/admin.html

Checklist:
- [ ] Sidebar navigation switches sections
- [ ] Can add a material (e.g. Картон, 2000), it appears in table
- [ ] Can edit price inline, click «Сохранить» — page reload shows updated value
- [ ] Can add a sheet tier (0 м², 800 ₽/м²), (5 м², 650 ₽/м²)
- [ ] Can add a souvenir price row (Ручки пластик)
- [ ] Import button accepts xlsx file, shows count

- [ ] **Step 4: Commit**

```bash
git add public/admin.html public/js/admin.js
git commit -m "feat: admin panel UI — materials, tiers, souvenir prices, catalog import, quotes"
```

---

## Task 7: Calculator UI

**Files:**
- Create: `prices/public/index.html`
- Create: `prices/public/js/calc-ui.js`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Калькулятор УФ-печати — Сити Принт</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f1f5f9; color: #1e293b; min-height: 100vh; }
    header { background: #1e293b; color: white; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 16px; font-weight: 600; }
    header a { color: #94a3b8; font-size: 13px; text-decoration: none; }
    header a:hover { color: #f8fafc; }
    .container { max-width: 720px; margin: 32px auto; padding: 0 16px; }
    .tabs { display: flex; background: white; border-radius: 10px 10px 0 0; border: 1px solid #e2e8f0; border-bottom: none; overflow: hidden; }
    .tab { flex: 1; padding: 13px; text-align: center; font-size: 14px; font-weight: 600; cursor: pointer; color: #64748b; border-bottom: 3px solid transparent; transition: all .15s; }
    .tab.active { color: #3b82f6; border-bottom-color: #3b82f6; background: #f8fbff; }
    .card { background: white; border-radius: 0 0 10px 10px; border: 1px solid #e2e8f0; padding: 24px; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px; }
    input[type=number], select { width: 100%; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 14px; color: #1e293b; }
    input[type=number]:focus, select:focus { outline: none; border-color: #3b82f6; }
    .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .info-pill { background: #f1f5f9; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #64748b; margin-bottom: 16px; display: flex; justify-content: space-between; }
    .info-pill strong { color: #1e293b; }
    .options label { text-transform: none; font-size: 13px; font-weight: 400; display: flex; align-items: center; gap: 8px; margin-bottom: 8px; cursor: pointer; }
    .options input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; }
    .badge { font-size: 11px; color: #f59e0b; font-weight: 600; margin-left: 4px; }
    .urgency { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .urg-btn { padding: 10px; border: 2px solid #e2e8f0; border-radius: 7px; text-align: center; cursor: pointer; font-size: 13px; color: #64748b; }
    .urg-btn.active { border-color: #3b82f6; background: #eff6ff; color: #3b82f6; font-weight: 600; }
    .urg-btn small { display: block; font-size: 11px; color: #94a3b8; font-weight: 400; }
    .urg-btn.active.urgent small { color: #f59e0b; }
    .client-material-toggle { background: #fefce8; border: 1px solid #fde047; border-radius: 7px; padding: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .client-material-toggle input { width: 17px; height: 17px; }
    .client-material-toggle span { font-size: 13px; font-weight: 600; color: #854d0e; }
    .calc-btn { width: 100%; padding: 12px; background: #3b82f6; color: white; border: none; border-radius: 7px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; }
    .calc-btn:hover { background: #2563eb; }
    .result-box { display: none; margin-top: 20px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 18px; }
    .result-box.show { display: block; }
    .result-title { font-size: 11px; font-weight: 700; color: #15803d; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 12px; }
    .result-row { display: flex; justify-content: space-between; font-size: 13px; color: #475569; margin-bottom: 5px; }
    .result-total { display: flex; justify-content: space-between; font-size: 17px; font-weight: 700; color: #166534; margin-top: 10px; padding-top: 10px; border-top: 1px solid #bbf7d0; }
    .result-per-unit { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    .kp-btn { width: 100%; padding: 10px; background: #1e293b; color: white; border: none; border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer; margin-top: 14px; }
    .kp-btn:hover { background: #334155; }
    .error-box { display: none; margin-top: 12px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 7px; padding: 12px; font-size: 13px; color: #dc2626; }
    .error-box.show { display: block; }
    .search-input { margin-bottom: 8px; }
  </style>
</head>
<body>

<header>
  <h1>⚡ Калькулятор УФ-печати</h1>
  <a href="/admin.html">⚙️ Администратор</a>
</header>

<div class="container">
  <div class="tabs">
    <div class="tab active" onclick="switchTab('sheet', this)">📄 Листовая продукция</div>
    <div class="tab" onclick="switchTab('souvenir', this)">🎁 Сувенирная продукция</div>
  </div>

  <div class="card">

    <!-- ── SHEET TAB ── -->
    <div id="tab-sheet" class="tab-content active">
      <label class="client-material-toggle" for="client-material">
        <input type="checkbox" id="client-material" onchange="updateClientMaterial()">
        <span>Материал заказчика — только надпечатка</span>
      </label>

      <div class="field" id="field-material">
        <label>Материал</label>
        <select id="sheet-material">
          <option value="">Загрузка...</option>
        </select>
      </div>

      <div class="row3">
        <div class="field">
          <label>Ширина, мм</label>
          <input type="number" id="sheet-width" placeholder="600" min="1" oninput="updateSheetInfo()">
        </div>
        <div class="field">
          <label>Высота, мм</label>
          <input type="number" id="sheet-height" placeholder="900" min="1" oninput="updateSheetInfo()">
        </div>
        <div class="field">
          <label>Тираж, шт.</label>
          <input type="number" id="sheet-qty" placeholder="50" min="1" oninput="updateSheetInfo()">
        </div>
      </div>

      <div class="info-pill" id="sheet-info" style="display:none;">
        <span>Общая площадь: <strong id="sheet-sqm">—</strong></span>
        <span>Ступень: <strong id="sheet-tier">—</strong></span>
      </div>

      <div class="field options">
        <label style="text-transform:uppercase;font-size:12px;font-weight:600;color:#64748b;">Опции печати</label>
        <label><input type="checkbox" id="sheet-varnish"> УФ-лак <span class="badge">+30%</span></label>
        <label>
          <input type="checkbox" id="sheet-relief"> Рельефный белый
          <span class="badge">+30% за слой</span>
        </label>
        <div id="sheet-relief-layers" style="display:none;margin-left:26px;margin-top:4px;">
          <label style="text-transform:none;font-size:13px;font-weight:400;display:flex;align-items:center;gap:8px;">
            Количество доп. слоёв:
            <input type="number" id="sheet-layers" value="1" min="1" max="5" style="width:60px;">
          </label>
        </div>
      </div>

      <div class="field">
        <label>Срочность</label>
        <div class="urgency">
          <div class="urg-btn active" id="sheet-standard" onclick="setUrgency('sheet','standard')">
            Стандарт <small>3–5 рабочих дней</small>
          </div>
          <div class="urg-btn urgent" id="sheet-urgent" onclick="setUrgency('sheet','urgent')">
            Срочно <small>1–2 дня · +30%</small>
          </div>
        </div>
      </div>

      <button class="calc-btn" onclick="calcSheetOrder()">Рассчитать →</button>

      <div class="error-box" id="sheet-error"></div>

      <div class="result-box" id="sheet-result">
        <div class="result-title">Расчёт стоимости</div>
        <div id="sheet-breakdown"></div>
        <div class="result-total"><span>Итого</span><span id="sheet-total"></span></div>
        <div class="result-per-unit" id="sheet-per-unit"></div>
        <button class="kp-btn" onclick="generateKP('sheet')">📋 Сформировать КП</button>
      </div>
    </div>

    <!-- ── SOUVENIR TAB ── -->
    <div id="tab-souvenir" class="tab-content">
      <div class="field">
        <label>Поиск товара</label>
        <input type="text" class="search-input" id="souv-search" placeholder="Ручка, ежедневник, power bank..." oninput="filterCatalog()">
      </div>

      <div class="field">
        <label>Товар из каталога</label>
        <select id="souv-product" onchange="updateSouvInfo()">
          <option value="">Выберите товар...</option>
        </select>
      </div>

      <div class="field">
        <label>Количество, шт.</label>
        <input type="number" id="souv-qty" placeholder="100" min="1" oninput="updateSouvInfo()">
      </div>

      <div class="info-pill" id="souv-info" style="display:none;">
        <span>Тарифная ступень: <strong id="souv-tier">—</strong></span>
      </div>

      <div class="field options">
        <label style="text-transform:uppercase;font-size:12px;font-weight:600;color:#64748b;">Опции печати</label>
        <label><input type="checkbox" id="souv-varnish"> УФ-лак <span class="badge">+30%</span></label>
        <label>
          <input type="checkbox" id="souv-relief"> Рельефный белый
          <span class="badge">+30% за слой</span>
        </label>
        <div id="souv-relief-layers" style="display:none;margin-left:26px;margin-top:4px;">
          <label style="text-transform:none;font-size:13px;font-weight:400;display:flex;align-items:center;gap:8px;">
            Количество доп. слоёв:
            <input type="number" id="souv-layers" value="1" min="1" max="5" style="width:60px;">
          </label>
        </div>
      </div>

      <div class="field">
        <label>Срочность</label>
        <div class="urgency">
          <div class="urg-btn active" id="souv-standard" onclick="setUrgency('souv','standard')">
            Стандарт <small>3–5 рабочих дней</small>
          </div>
          <div class="urg-btn urgent" id="souv-urgent" onclick="setUrgency('souv','urgent')">
            Срочно <small>1–2 дня · +30%</small>
          </div>
        </div>
      </div>

      <button class="calc-btn" onclick="calcSouvenirOrder()">Рассчитать →</button>

      <div class="error-box" id="souv-error"></div>

      <div class="result-box" id="souv-result">
        <div class="result-title">Расчёт стоимости</div>
        <div id="souv-breakdown"></div>
        <div class="result-total"><span>Итого</span><span id="souv-total"></span></div>
        <div class="result-per-unit" id="souv-per-unit"></div>
        <button class="kp-btn" onclick="generateKP('souvenir')">📋 Сформировать КП</button>
      </div>
    </div>

  </div>
</div>

<script src="/js/calc-ui.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create calc-ui.js**

```js
// public/js/calc-ui.js

let sheetMaterials = []
let sheetTiers = []
let allCatalogItems = []
let lastSheetResult = null
let lastSouvResult = null

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error((await res.json()).error || res.statusText)
  return res.json()
}

function fmt(n) { return Number(n).toLocaleString('ru-RU') + ' ₽' }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  const [materials, tiers, catalog] = await Promise.all([
    api('GET', '/api/materials'),
    api('GET', '/api/sheet-tiers'),
    api('GET', '/api/catalog')
  ])
  sheetMaterials = materials
  sheetTiers = tiers
  allCatalogItems = catalog

  // Populate material select
  const matSel = document.getElementById('sheet-material')
  matSel.innerHTML = '<option value="">Выберите материал...</option>' +
    materials.map(m => `<option value="${m.id}">${esc(m.name)} (${fmt(m.price_per_sqm)}/м²)</option>`).join('')

  // Populate catalog select
  renderCatalogOptions(catalog)

  // Wire relief checkbox
  document.getElementById('sheet-relief').addEventListener('change', e => {
    document.getElementById('sheet-relief-layers').style.display = e.target.checked ? 'block' : 'none'
  })
  document.getElementById('souv-relief').addEventListener('change', e => {
    document.getElementById('souv-relief-layers').style.display = e.target.checked ? 'block' : 'none'
  })
}

function renderCatalogOptions(items) {
  const sel = document.getElementById('souv-product')
  sel.innerHTML = '<option value="">Выберите товар...</option>' +
    items.map(i => `<option value="${i.id}" data-price-id="${i.souvenir_price_id || ''}">${esc(i.article)} — ${esc(i.name)}</option>`).join('')
}

function filterCatalog() {
  const q = document.getElementById('souv-search').value.toLowerCase()
  renderCatalogOptions(q ? allCatalogItems.filter(i => i.name.toLowerCase().includes(q) || i.article.toLowerCase().includes(q)) : allCatalogItems)
}

// ── Tab switching ─────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
  document.getElementById('tab-' + name).classList.add('active')
  el.classList.add('active')
}

// ── Client material toggle ────────────────────────────────────────────────
function updateClientMaterial() {
  const checked = document.getElementById('client-material').checked
  document.getElementById('field-material').style.opacity = checked ? '0.4' : '1'
  document.getElementById('field-material').style.pointerEvents = checked ? 'none' : ''
  updateSheetInfo()
}

// ── Urgency ───────────────────────────────────────────────────────────────
function setUrgency(prefix, mode) {
  document.getElementById(prefix + '-standard').classList.toggle('active', mode === 'standard')
  document.getElementById(prefix + '-urgent').classList.toggle('active', mode === 'urgent')
}

function isUrgent(prefix) {
  return document.getElementById(prefix + '-urgent').classList.contains('active')
}

// ── Sheet info pill ───────────────────────────────────────────────────────
function updateSheetInfo() {
  const w = +document.getElementById('sheet-width').value
  const h = +document.getElementById('sheet-height').value
  const qty = +document.getElementById('sheet-qty').value
  if (!w || !h || !qty || !sheetTiers.length) { document.getElementById('sheet-info').style.display = 'none'; return }
  const sqm = (w / 1000) * (h / 1000) * qty
  const tier = sheetTiers.filter(t => t.min_sqm <= sqm).sort((a,b) => b.min_sqm - a.min_sqm)[0]
  document.getElementById('sheet-sqm').textContent = sqm.toFixed(2) + ' м²'
  document.getElementById('sheet-tier').textContent = tier ? `от ${tier.min_sqm} м² (${fmt(tier.price_per_sqm)}/м²)` : 'нет подходящей ступени'
  document.getElementById('sheet-info').style.display = 'flex'
}

function updateSouvInfo() {
  const qty = +document.getElementById('souv-qty').value
  if (!qty) { document.getElementById('souv-info').style.display = 'none'; return }
  const label = qty < 30 ? 'до 29 шт. (фикс. за тираж)'
    : qty < 100  ? 'от 30 шт.'
    : qty < 500  ? 'от 100 шт.'
    : qty < 1000 ? 'от 500 шт.'
    : 'от 1000 шт.'
  document.getElementById('souv-tier').textContent = label
  document.getElementById('souv-info').style.display = 'flex'
}

// ── Sheet calculation ─────────────────────────────────────────────────────
async function calcSheetOrder() {
  hideResult('sheet')
  const clientMaterial = document.getElementById('client-material').checked
  const materialId = +document.getElementById('sheet-material').value || null
  const widthMm = +document.getElementById('sheet-width').value
  const heightMm = +document.getElementById('sheet-height').value
  const qty = +document.getElementById('sheet-qty').value
  const uvVarnish = document.getElementById('sheet-varnish').checked
  const reliefLayers = document.getElementById('sheet-relief').checked ? +document.getElementById('sheet-layers').value : 0
  const urgent = isUrgent('sheet')

  if (!widthMm || !heightMm || !qty) return showError('sheet', 'Заполните ширину, высоту и тираж')
  if (!clientMaterial && !materialId) return showError('sheet', 'Выберите материал или отметьте «Материал заказчика»')

  try {
    const res = await api('POST', '/api/calc/sheet', { widthMm, heightMm, qty, materialId, clientMaterial, uvVarnish, reliefLayers, urgent })
    lastSheetResult = { params: { widthMm, heightMm, qty, materialId, clientMaterial, uvVarnish, reliefLayers, urgent }, result: res }
    showSheetResult(res, { widthMm, heightMm, qty, clientMaterial, uvVarnish, reliefLayers, urgent })
  } catch (e) {
    showError('sheet', e.message)
  }
}

function showSheetResult(r, p) {
  const matName = p.clientMaterial ? 'Материал заказчика' : (sheetMaterials.find(m => m.id === p.materialId)?.name || '')
  let rows = `<div class="result-row"><span>Надпечатка (${r.totalSqm} м², ступень от ${r.tierApplied} м²)</span><span>${fmt(r.basePrintCost)}</span></div>`
  if (!p.clientMaterial) rows += `<div class="result-row"><span>Материал: ${esc(matName)}</span><span>${fmt(r.materialCost)}</span></div>`
  if (p.uvVarnish) rows += `<div class="result-row"><span>УФ-лак (+30%)</span><span>${fmt(r.basePrintCost * 0.30)}</span></div>`
  if (p.reliefLayers > 0) rows += `<div class="result-row"><span>Рельефный белый (${p.reliefLayers} сл. × +30%)</span><span>${fmt(r.basePrintCost * 0.30 * p.reliefLayers)}</span></div>`
  if (p.urgent) rows += `<div class="result-row"><span>Срочность (+30%)</span><span>включено</span></div>`

  document.getElementById('sheet-breakdown').innerHTML = rows
  document.getElementById('sheet-total').textContent = fmt(r.total)
  document.getElementById('sheet-per-unit').textContent = `${p.qty} шт. × ${fmt(r.pricePerUnit)}/шт.`
  document.getElementById('sheet-result').classList.add('show')
}

// ── Souvenir calculation ──────────────────────────────────────────────────
async function calcSouvenirOrder() {
  hideResult('souv')
  const option = document.getElementById('souv-product').selectedOptions[0]
  const priceId = +option?.dataset.priceId
  const qty = +document.getElementById('souv-qty').value
  const uvVarnish = document.getElementById('souv-varnish').checked
  const reliefLayers = document.getElementById('souv-relief').checked ? +document.getElementById('souv-layers').value : 0
  const urgent = isUrgent('souv')

  if (!priceId) return showError('souv', 'Выберите товар из каталога. Если тип не привязан — настройте в панели администратора.')
  if (!qty) return showError('souv', 'Введите количество')

  try {
    const res = await api('POST', '/api/calc/souvenir', { productTypeId: priceId, qty, uvVarnish, reliefLayers, urgent })
    lastSouvResult = { params: { productTypeId: priceId, productName: option.textContent, qty, uvVarnish, reliefLayers, urgent }, result: res }
    showSouvResult(res, lastSouvResult.params)
  } catch (e) {
    showError('souv', e.message)
  }
}

function showSouvResult(r, p) {
  const tierLabel = { up_to_29: 'до 29 шт.', from_30: 'от 30 шт.', from_100: 'от 100 шт.', from_500: 'от 500 шт.', from_1000: 'от 1000 шт.' }
  let rows = `<div class="result-row"><span>Печать (${tierLabel[r.tierApplied] || r.tierApplied})</span><span>${fmt(r.base)}</span></div>`
  if (p.uvVarnish) rows += `<div class="result-row"><span>УФ-лак (+30%)</span><span>${fmt(r.base * 0.30)}</span></div>`
  if (p.reliefLayers > 0) rows += `<div class="result-row"><span>Рельефный белый (${p.reliefLayers} сл. × +30%)</span><span>${fmt(r.base * 0.30 * p.reliefLayers)}</span></div>`
  if (p.urgent) rows += `<div class="result-row"><span>Срочность (+30%)</span><span>включено</span></div>`

  document.getElementById('souv-breakdown').innerHTML = rows
  document.getElementById('souv-total').textContent = fmt(r.total)
  document.getElementById('souv-per-unit').textContent = `${p.qty} шт. × ${fmt(r.pricePerUnit)}/шт.`
  document.getElementById('souv-result').classList.add('show')
}

// ── KP generation ─────────────────────────────────────────────────────────
async function generateKP(type) {
  const data = type === 'sheet' ? lastSheetResult : lastSouvResult
  if (!data) return

  const d = new Date().toLocaleDateString('ru-RU')
  let text

  if (type === 'sheet') {
    const { params: p, result: r } = data
    const mat = p.clientMaterial ? 'Материал заказчика' : (sheetMaterials.find(m => m.id === p.materialId)?.name || '')
    text = `КП на УФ-печать (листовая продукция)
Дата: ${d}
Материал: ${mat}
Размер: ${p.widthMm}×${p.heightMm} мм
Тираж: ${p.qty} шт.
Площадь: ${r.totalSqm} м²
${p.uvVarnish ? 'Опция: УФ-лак (+30%)\n' : ''}${p.reliefLayers > 0 ? `Опция: рельефный белый (${p.reliefLayers} сл.)\n` : ''}${p.urgent ? 'Срочность: 1–2 дня (+30%)\n' : ''}
Стоимость надпечатки: ${fmt(r.printCost)}${!p.clientMaterial ? `\nСтоимость материала: ${fmt(r.materialCost)}` : ''}
Итого: ${fmt(r.total)} (${fmt(r.pricePerUnit)}/шт.)`
  } else {
    const { params: p, result: r } = data
    text = `КП на УФ-печать (сувенирная продукция)
Дата: ${d}
Товар: ${p.productName}
Количество: ${p.qty} шт.
${p.uvVarnish ? 'Опция: УФ-лак (+30%)\n' : ''}${p.reliefLayers > 0 ? `Опция: рельефный белый (${p.reliefLayers} сл.)\n` : ''}${p.urgent ? 'Срочность: 1–2 дня (+30%)\n' : ''}
Итого: ${fmt(r.total)} (${fmt(r.pricePerUnit)}/шт.)`
  }

  await api('POST', '/api/quotes', { type: type === 'sheet' ? 'sheet' : 'souvenir', params: data.params, result: data.result, kp_text: text })
  alert('КП сохранено!\n\n' + text)
}

// ── Helpers ───────────────────────────────────────────────────────────────
function showError(prefix, msg) {
  const el = document.getElementById(prefix + '-error')
  el.textContent = msg
  el.classList.add('show')
}

function hideResult(prefix) {
  document.getElementById(prefix + '-result').classList.remove('show')
  document.getElementById(prefix + '-error').classList.remove('show')
}

init()
```

- [ ] **Step 3: Manually verify calculator UI**

```bash
node server.js
```

Open http://localhost:3001

Checklist:
- [ ] Tab switching between «Листовая» and «Сувенирная» works
- [ ] «Материал заказчика» checkbox disables material dropdown
- [ ] Width/Height/Qty fields update the info pill with area and tier
- [ ] «Рассчитать» shows result breakdown with each component
- [ ] «Срочно» adds +30% to total
- [ ] «УФ-лак» adds 30% in breakdown
- [ ] «Сформировать КП» shows alert with text and saves to DB
- [ ] Ssouvenir tab: selecting product from catalog, entering qty shows tier pill
- [ ] Souvenir calculation works end-to-end

- [ ] **Step 4: Run full test suite**

```bash
npx jest tests/ --no-coverage
```

Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/js/calc-ui.js
git commit -m "feat: manager calculator UI — sheet and souvenir modules complete"
```

---

## Task 8: Seed Initial Data

**Files:**
- Create: `prices/seed.js`

- [ ] **Step 1: Create seed.js**

```js
// seed.js — run once to populate initial price data
const { createDb } = require('./db')
const db = createDb()

db.prepare('DELETE FROM sheet_materials').run()
db.prepare('DELETE FROM sheet_tiers').run()
db.prepare('DELETE FROM souvenir_prices').run()

// Sheet materials (adjust prices to your actual rates)
const insertMat = db.prepare('INSERT INTO sheet_materials (name, price_per_sqm) VALUES (?, ?)')
insertMat.run('Картон',         2000)
insertMat.run('Пенокартон',     3700)
insertMat.run('Пластик 5 мм',   5900)
insertMat.run('Алюмокомпозит', 11000)
insertMat.run('Оргстекло',     12000)

// Sheet print tiers (price per sqm for the UV print job, not the material)
const insertTier = db.prepare('INSERT INTO sheet_tiers (min_sqm, price_per_sqm) VALUES (?, ?)')
insertTier.run(0,   800)
insertTier.run(5,   650)
insertTier.run(20,  500)
insertTier.run(50,  380)
insertTier.run(100, 280)

// Souvenir print prices (from competitor research — adjust to your rates)
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

console.log('Seed complete.')
```

- [ ] **Step 2: Run seed**

```bash
node seed.js
```

Expected: `Seed complete.`

- [ ] **Step 3: Import catalog**

Open http://localhost:3001/admin.html → раздел «Каталог товаров» → кнопка «Загрузить catalog.xlsx» → выбрать файл `/Users/annakorotkih/Desktop/Claude Code Lab/kopi/catalog.xlsx`

Expected: «Импортировано: 133 товара»

- [ ] **Step 4: Link catalog items to price types**

In admin.html → «Каталог товаров» → use the «Тип печати (привязка)» dropdown to link ручки-type items to «Ручки (белый пластик)» etc.

- [ ] **Step 5: Commit**

```bash
git add seed.js
git commit -m "feat: seed script with initial price data"
```

---

## Final Checklist

- [ ] `npx jest tests/ --no-coverage` — все тесты проходят
- [ ] `node seed.js && node server.js` — сервер стартует без ошибок
- [ ] http://localhost:3001 — калькулятор открывается
- [ ] http://localhost:3001/admin.html — панель администратора открывается
- [ ] Расчёт листовой с материалом — верная сумма
- [ ] Расчёт листовой без материала (материал заказчика) — только надпечатка
- [ ] Расчёт сувенирки (qty < 30) — фиксированная цена
- [ ] Расчёт сувенирки (qty = 100) — цена × тираж
- [ ] «Сформировать КП» — сохраняет в БД, показывает текст
- [ ] Настройки администратора сохраняются и применяются в калькуляторе
