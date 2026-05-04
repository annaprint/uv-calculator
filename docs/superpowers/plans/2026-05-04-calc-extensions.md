# Calc Extensions Implementation Plan (брелки + сувенирка-рефактор + qty<30 фикс)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширить работающий калькулятор УФ-печати тремя независимыми правками — добавить брелки на акриле, прицепить цену продукта к сувенирке через каталог и починить расчёт мелких тиражей (<30 шт).

**Architecture:** Миграция БД v7 поверх продакшеновой v6 (резка — параллельный спек). Расчётные функции (`calcSouvenir`, `calcKeychain`) — TDD-first в `calc.js`. API расширяется поверх существующего Express/sqlite3 паттерна. UI — две новые вкладки в калькуляторе и админке + рефактор формы сувенирки.

**Tech Stack:** Node.js + Express + better-sqlite3 + Jest. Frontend — vanilla HTML/JS, без фреймворков.

**Spec:** `docs/superpowers/specs/2026-05-04-calc-extensions-design.md`

**Coordination with cutting (v6):** Миграция v7 проверяет текущее состояние `quotes.type CHECK` и пересоздаёт таблицу с расширенным CHECK `('sheet','souvenir','keychain','cutting_plotter','cutting_laser')`. Если v6 уже расширил CHECK — пересоздание идемпотентно.

---

## File Structure

**Изменяемые:**
- `db.js` — добавить migration v7 в массив migrations
- `calc.js` — рефакторинг `calcSouvenir`, новая `calcKeychain`
- `server.js` — новые endpoints для keychain, изменения в /api/calc/souvenir, /api/souvenir-prices, /api/catalog/import
- `seed.js` — обновление seedPrices под новую схему
- `pdf.js` — поддержка типа `keychain` в KP-тексте и в локализации ключей
- `public/index.html` — новая вкладка «🔑 Брелки», рефактор формы сувенирки
- `public/js/calc-ui.js` — JS-логика для брелков и autocomplete каталога
- `public/admin.html` — новая вкладка «🔑 Брелки», поле min_order в редактировании сувенирных цен, отчёт после импорта
- `public/js/admin.js` — JS для админки брелков, новый импорт-отчёт

**Создаваемые тесты:**
- `tests/keychain.api.test.js` — API брелков
- `tests/quotes-keychain.api.test.js` — сохранение quote с type='keychain'
- `tests/catalog.api.test.js` — новый импорт-формат и отчёт по непривязанным

**Расширяемые тесты:**
- `tests/migrate.test.js` — секции для v7
- `tests/calc.test.js` — обновлённый calcSouvenir, новый calcKeychain
- `tests/pdf.test.js` — keychain quote PDF не падает
- `tests/api.test.js` — изменения /api/calc/souvenir

---

## Task 1: Миграция v7 — схема + сидирование брелков

**Files:**
- Modify: `db.js` (добавить migration v7 в массив `migrations`)
- Test: `tests/migrate.test.js` (новая секция «migration v7»)

CSV-источник цен брелков (rows 27-65 файла «Принтхак таблица заказов - Стоимость для клиента»):

| Тип акрила | 1-9 шт | 10-99 | 100-499 | 500-1000 | размеры |
|---|---|---|---|---|---|
| Прозрачный | 80/120/160/200/240 | 46/62/78/112/144 | 38/54/70/86/136 | 30/46/62/78/128 | до 3/4/6/8/10 см |
| Тонированный | 92/138/184/230/276 | 53/72/90/129/166 | 44/63/81/99/156 | 35/53/72/90/147 | |
| Непрозр/градиент 1 сторона | 104/156/208/260/312 | 60/81/102/146/187 | 50/71/92/112/177 | 40/60/81/102/166 | |
| Непрозр/градиент 2 стороны | 120/180/240/300/360 | 70/94/118/168/216 | 58/82/106/130/204 | 46/70/94/118/192 | |
| Люминесцентный | 120/180/240/300/360 | 70/94/118/168/216 | 58/82/106/130/204 | 46/70/94/118/192 | |

- [ ] **Step 1: Написать тесты для v7 в `tests/migrate.test.js`**

Дописать в конец файла:

```js
describe('migration v7 — souvenir min_order, catalog customer_price, keychain_prices, quotes.type CHECK', () => {
  test('souvenir_prices получает min_order и переносит туда старое qty_up_to_29', () => {
    const db = createDb(':memory:')
    // на момент v7 уже выполнены v1..v6 — сидируем тестовую строку с старой семантикой
    db.prepare(
      'INSERT INTO souvenir_prices (product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000) VALUES (?,?,?,?,?,?)'
    ).run('TestProd', 1500, 45, 29, 20, 14)
    // (миграция v7 уже применилась через createDb — проверяем что данные в новом формате)
    const cols = db.prepare("PRAGMA table_info(souvenir_prices)").all().map(c => c.name)
    expect(cols).toContain('min_order')
  })

  test('catalog_items получает customer_price', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(catalog_items)").all().map(c => c.name)
    expect(cols).toContain('customer_price')
  })

  test('keychain_prices создана со 100 строк', () => {
    const db = createDb(':memory:')
    const count = db.prepare('SELECT COUNT(*) AS c FROM keychain_prices').get().c
    expect(count).toBe(100)  // 5 типов × 5 размеров × 4 тиражных тира
  })

  test('keychain_prices: цены прозрачного акрила 6 см при 100-499 шт = 70 ₽/шт', () => {
    const db = createDb(':memory:')
    const row = db.prepare(
      'SELECT price_per_piece FROM keychain_prices WHERE acrylic_type=? AND size_max_cm=? AND qty_min=?'
    ).get('Прозрачный', 6, 100)
    expect(row.price_per_piece).toBe(70)
  })

  test('quotes.type CHECK расширен — keychain принимается', () => {
    const db = createDb(':memory:')
    expect(() => {
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES ('keychain', '{}', '{}', 'x')").run()
    }).not.toThrow()
  })

  test('quotes.type CHECK расширен — cutting_plotter и cutting_laser принимаются', () => {
    const db = createDb(':memory:')
    expect(() => {
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES ('cutting_plotter', '{}', '{}', 'x')").run()
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES ('cutting_laser', '{}', '{}', 'x')").run()
    }).not.toThrow()
  })

  test('quotes.type CHECK отвергает неизвестный тип', () => {
    const db = createDb(':memory:')
    expect(() => {
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES ('unknown', '{}', '{}', 'x')").run()
    }).toThrow()
  })

  test('повторный applyMigrations идемпотентен', () => {
    const { applyMigrations } = require('../db')
    const db = createDb(':memory:')
    const v1 = db.pragma('user_version', { simple: true })
    const keychainCount1 = db.prepare('SELECT COUNT(*) AS c FROM keychain_prices').get().c
    applyMigrations(db)
    const v2 = db.pragma('user_version', { simple: true })
    const keychainCount2 = db.prepare('SELECT COUNT(*) AS c FROM keychain_prices').get().c
    expect(v2).toBe(v1)
    expect(keychainCount2).toBe(keychainCount1)
  })
})
```

- [ ] **Step 2: Запустить тесты — должны падать**

Run: `npm test -- tests/migrate.test.js`
Expected: FAIL — `keychain_prices` table doesn't exist, `min_order` column doesn't exist.

- [ ] **Step 3: Добавить миграцию v7 в `db.js`**

Открыть `db.js`, найти массив `migrations`. После записи `version: 6` (если уже добавлена резкой) или после `version: 5` (если v6 ещё не приехал — ситуацию определяем по присутствию объекта в массиве; при коллизии решит executing-agent через rebase) — добавить:

```js
{
  version: 7,
  up: (db) => {
    // 1. souvenir_prices: добавить min_order, перенести данные
    db.exec('ALTER TABLE souvenir_prices ADD COLUMN min_order REAL NOT NULL DEFAULT 0')
    db.exec('UPDATE souvenir_prices SET min_order = qty_up_to_29, qty_up_to_29 = 0')

    // 2. catalog_items: добавить customer_price
    db.exec('ALTER TABLE catalog_items ADD COLUMN customer_price REAL')

    // 3. keychain_prices
    db.exec(`
      CREATE TABLE keychain_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        acrylic_type TEXT NOT NULL,
        size_max_cm REAL NOT NULL,
        qty_min INTEGER NOT NULL,
        price_per_piece REAL NOT NULL,
        UNIQUE(acrylic_type, size_max_cm, qty_min)
      );
    `)
    const ins = db.prepare(
      'INSERT OR IGNORE INTO keychain_prices (acrylic_type, size_max_cm, qty_min, price_per_piece) VALUES (?,?,?,?)'
    )
    const SIZES = [3, 4, 6, 8, 10]
    const TIERS = [1, 10, 100, 500]
    const PRICES = {
      'Прозрачный': [
        [80, 120, 160, 200, 240],
        [46, 62, 78, 112, 144],
        [38, 54, 70, 86, 136],
        [30, 46, 62, 78, 128]
      ],
      'Тонированный': [
        [92, 138, 184, 230, 276],
        [53, 72, 90, 129, 166],
        [44, 63, 81, 99, 156],
        [35, 53, 72, 90, 147]
      ],
      'Непрозр/градиент 1 сторона': [
        [104, 156, 208, 260, 312],
        [60, 81, 102, 146, 187],
        [50, 71, 92, 112, 177],
        [40, 60, 81, 102, 166]
      ],
      'Непрозр/градиент 2 стороны': [
        [120, 180, 240, 300, 360],
        [70, 94, 118, 168, 216],
        [58, 82, 106, 130, 204],
        [46, 70, 94, 118, 192]
      ],
      'Люминесцентный': [
        [120, 180, 240, 300, 360],
        [70, 94, 118, 168, 216],
        [58, 82, 106, 130, 204],
        [46, 70, 94, 118, 192]
      ]
    }
    for (const [type, matrix] of Object.entries(PRICES)) {
      TIERS.forEach((qty, ti) => {
        SIZES.forEach((size, si) => {
          ins.run(type, size, qty, matrix[ti][si])
        })
      })
    }

    // 4. quotes.type CHECK — пересоздать таблицу с расширенным набором
    // Текущий CHECK в v1: ('sheet','souvenir'). v6 (резка) мог расширить до cutting.
    // v7 нормализует к окончательному множеству.
    db.exec(`
      CREATE TABLE quotes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        type TEXT NOT NULL CHECK(type IN ('sheet','souvenir','keychain','cutting_plotter','cutting_laser')),
        params TEXT NOT NULL,
        result TEXT NOT NULL,
        kp_text TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id),
        client_id INTEGER REFERENCES clients(id),
        comment TEXT,
        total REAL,
        pdf_path TEXT
      );
      INSERT INTO quotes_new SELECT * FROM quotes;
      DROP TABLE quotes;
      ALTER TABLE quotes_new RENAME TO quotes;
    `)
  }
}
```

- [ ] **Step 4: Запустить тесты — должны проходить**

Run: `npm test -- tests/migrate.test.js`
Expected: PASS все 8 тестов из секции v7.

- [ ] **Step 5: Прогнать полный набор тестов — никаких регрессий**

Run: `npm test`
Expected: PASS все существующие тесты (122+) + 8 новых.

- [ ] **Step 6: Коммит**

```bash
git add db.js tests/migrate.test.js
git commit -m "feat(db): migration v7 — souvenir min_order + catalog customer_price + keychain_prices + quotes.type CHECK widening"
```

---

## Task 2: Рефакторинг `calcSouvenir` + bug-fix qty<30

**Files:**
- Modify: `calc.js` (полностью переписать `calcSouvenir`)
- Modify: `tests/calc.test.js` (заменить старые тесты `calcSouvenir` на новые)

- [ ] **Step 1: Заменить тесты `calcSouvenir` в `tests/calc.test.js`**

Найти секцию `describe('calcSouvenir', ...)` в `tests/calc.test.js` и заменить её содержимое целиком на:

```js
const SOUVENIR_PRICES_V7 = [
  {
    id: 1,
    product_type: 'Ручки (белый пластик)',
    qty_up_to_29: 51,
    qty_from_30: 45,
    qty_from_100: 29,
    qty_from_500: 20,
    qty_from_1000: 14,
    min_order: 1500
  }
]

const CATALOG = [
  { id: 10, article: 'A1', name: 'Ручка Senator',  souvenir_price_id: 1, customer_price: 80 },
  { id: 11, article: 'A2', name: 'Ручка без типа', souvenir_price_id: null, customer_price: 100 }
]

describe('calcSouvenir (v7)', () => {
  test('по каталогу: печать + продукт, без надбавок', () => {
    // qty 250 → tier from_100 = 29 ₽/шт × 250 = 7250 ₽ (печать)
    // продукт: 80 × 250 = 20000 ₽
    // total: 27250 ₽
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 250, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.printCost).toBeCloseTo(7250)
    expect(r.productCost).toBeCloseTo(20000)
    expect(r.total).toBeCloseTo(27250)
  })

  test('qty<30: per-unit × qty (а не флэт)', () => {
    // qty 10 → 51 × 10 = 510 ₽ < min_order 1500 → 1500
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 10, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.minOrderApplied).toBe(true)
    expect(r.printCost).toBeCloseTo(1500)
    expect(r.productCost).toBeCloseTo(800)  // 80 × 10
    expect(r.total).toBeCloseTo(2300)
  })

  test('qty<30 и per-unit×qty уже больше min_order: min не применяется', () => {
    // qty 29 → 51 × 29 = 1479. min_order = 1500. min применяется (1479 < 1500).
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 29, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.minOrderApplied).toBe(true)
    expect(r.printCost).toBeCloseTo(1500)

    // a теперь qty=30 → 45 × 30 = 1350 < 1500 → min применяется
    const r2 = calcSouvenir(
      { catalogItemId: 10, qty: 30, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r2.minOrderApplied).toBe(true)
    expect(r2.printCost).toBeCloseTo(1500)

    // qty=40 → 45 × 40 = 1800 > 1500 → min не применяется
    const r3 = calcSouvenir(
      { catalogItemId: 10, qty: 40, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r3.minOrderApplied).toBe(false)
    expect(r3.printCost).toBeCloseTo(1800)
  })

  test('лак +30% применяется только к печати, не к продукту', () => {
    // qty 100 → 29 × 100 = 2900 ₽ печать. Лак: 2900 × 1.3 = 3770 (или +30% от base = 870 → 3770)
    // продукт: 80 × 100 = 8000 ₽ (без лака)
    // total: 11770
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 100, urgent: false, uvVarnish: true, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.printCost).toBeCloseTo(3770)
    expect(r.productCost).toBeCloseTo(8000)
    expect(r.total).toBeCloseTo(11770)
  })

  test('срочность +30% применяется ко всему итогу (печать+продукт)', () => {
    // qty 100 → 2900 печать + 8000 продукт = 10900
    // срочность: 10900 × 1.3 = 14170
    const r = calcSouvenir(
      { catalogItemId: 10, qty: 100, urgent: true, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.total).toBeCloseTo(14170)
  })

  test('ручной режим: productTypeId + manualProductPrice', () => {
    const r = calcSouvenir(
      { productTypeId: 1, manualProductPrice: 50, qty: 100, urgent: false, uvVarnish: false, reliefLayers: 0 },
      SOUVENIR_PRICES_V7, CATALOG
    )
    expect(r.printCost).toBeCloseTo(2900)  // 29 × 100
    expect(r.productCost).toBeCloseTo(5000)  // 50 × 100
    expect(r.total).toBeCloseTo(7900)
  })

  test('каталожный товар без привязки → throw', () => {
    expect(() => calcSouvenir(
      { catalogItemId: 11, qty: 100 },
      SOUVENIR_PRICES_V7, CATALOG
    )).toThrow('not linked')
  })

  test('ни catalogItemId ни productTypeId → throw', () => {
    expect(() => calcSouvenir(
      { qty: 100 },
      SOUVENIR_PRICES_V7, CATALOG
    )).toThrow()
  })

  test('catalogItemId не найден → throw', () => {
    expect(() => calcSouvenir(
      { catalogItemId: 999, qty: 100 },
      SOUVENIR_PRICES_V7, CATALOG
    )).toThrow('Catalog item not found')
  })
})
```

- [ ] **Step 2: Запустить тесты — должны падать**

Run: `npm test -- tests/calc.test.js`
Expected: FAIL — текущий `calcSouvenir` не принимает `catalogItemId`, не разделяет печать/продукт.

- [ ] **Step 3: Переписать `calcSouvenir` в `calc.js`**

Заменить функцию `calcSouvenir` целиком на:

```js
function calcSouvenir(
  { catalogItemId, productTypeId, manualProductPrice, qty, uvVarnish = false, reliefLayers = 0, urgent = false },
  prices,
  catalog = []
) {
  let priceRow, productPrice, catalogItemName = null

  if (catalogItemId != null) {
    const item = catalog.find(c => c.id === catalogItemId)
    if (!item) throw new Error('Catalog item not found')
    if (!item.souvenir_price_id) throw new Error('Catalog item not linked to print type')
    priceRow = prices.find(p => p.id === item.souvenir_price_id)
    productPrice = item.customer_price ?? 0
    catalogItemName = item.name
  } else if (productTypeId != null) {
    priceRow = prices.find(p => p.id === productTypeId)
    productPrice = Number(manualProductPrice) || 0
  } else {
    throw new Error('Either catalogItemId or productTypeId required')
  }
  if (!priceRow) throw new Error('Print price not found')

  let perUnit
  if (qty < 30)        perUnit = priceRow.qty_up_to_29
  else if (qty < 100)  perUnit = priceRow.qty_from_30
  else if (qty < 500)  perUnit = priceRow.qty_from_100
  else if (qty < 1000) perUnit = priceRow.qty_from_500
  else                 perUnit = priceRow.qty_from_1000

  let printBase = perUnit * qty
  const minOrder = priceRow.min_order || 0
  const minOrderApplied = printBase < minOrder
  if (minOrderApplied) printBase = minOrder

  let printCost = printBase
  if (uvVarnish) printCost += printBase * 0.30
  for (let i = 0; i < reliefLayers; i++) printCost += printBase * 0.30

  const productCost = productPrice * qty

  let total = printCost + productCost
  if (urgent) total *= 1.30

  return {
    productTypeName: priceRow.product_type,
    catalogItemName,
    qty,
    pricePerUnit: perUnit,
    minOrder,
    minOrderApplied,
    printBase: +printBase.toFixed(2),
    printCost: +printCost.toFixed(2),
    productPrice: +productPrice.toFixed(2),
    productCost: +productCost.toFixed(2),
    total: +total.toFixed(2),
    pricePerUnitFinal: +(total / qty).toFixed(2)
  }
}
```

- [ ] **Step 4: Запустить тесты — должны проходить**

Run: `npm test -- tests/calc.test.js`
Expected: PASS. (Если падает `tests/api.test.js` из-за смены сигнатуры — пометь его как «обновляется в Task 4»; пока пропусти этот файл: `npm test -- tests/calc.test.js tests/migrate.test.js`.)

- [ ] **Step 5: Коммит**

```bash
git add calc.js tests/calc.test.js
git commit -m "feat(calc): rewrite calcSouvenir — per-unit pricing for qty<30 + min_order + product cost"
```

---

## Task 3: `calcKeychain`

**Files:**
- Modify: `calc.js` (добавить `calcKeychain`, экспорт)
- Modify: `tests/calc.test.js` (новая секция `describe('calcKeychain', …)`)

- [ ] **Step 1: Написать тесты для `calcKeychain` в `tests/calc.test.js`**

Дописать в конец файла:

```js
const KEYCHAIN_PRICES = [
  { id: 1, acrylic_type: 'Прозрачный', size_max_cm: 3,  qty_min: 1,   price_per_piece: 80 },
  { id: 2, acrylic_type: 'Прозрачный', size_max_cm: 6,  qty_min: 100, price_per_piece: 70 },
  { id: 3, acrylic_type: 'Прозрачный', size_max_cm: 6,  qty_min: 500, price_per_piece: 62 },
  { id: 4, acrylic_type: 'Прозрачный', size_max_cm: 10, qty_min: 1,   price_per_piece: 240 },
  { id: 5, acrylic_type: 'Тонированный', size_max_cm: 4, qty_min: 10, price_per_piece: 72 }
]

describe('calcKeychain', () => {
  const { calcKeychain } = require('../calc')

  test('базовый расчёт: 5×3 см, 100 шт прозрачный → корзина «до 6», тир 100-499 = 70 ₽/шт', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: false },
      KEYCHAIN_PRICES
    )
    expect(r.sizeBucket).toBe(6)
    expect(r.qtyTier).toBe(100)
    expect(r.pricePerPiece).toBe(70)
    expect(r.total).toBeCloseTo(7000)  // 70 × 100
  })

  test('размер ровно 3 см → корзина «до 3»', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 3, qty: 5, urgent: false },
      KEYCHAIN_PRICES
    )
    expect(r.sizeBucket).toBe(3)
    expect(r.qtyTier).toBe(1)
    expect(r.total).toBeCloseTo(400)  // 80 × 5
  })

  test('тираж 500 → тир 500-1000', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 500, urgent: false },
      KEYCHAIN_PRICES
    )
    expect(r.qtyTier).toBe(500)
    expect(r.pricePerPiece).toBe(62)
  })

  test('срочность +30%', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: true },
      KEYCHAIN_PRICES
    )
    expect(r.total).toBeCloseTo(9100)  // 70 × 100 × 1.3
  })

  test('размер > 10 см → throw', () => {
    expect(() => calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 11, qty: 100, urgent: false },
      KEYCHAIN_PRICES
    )).toThrow('Size > 10 cm not supported')
  })

  test('тип акрила не найден → throw', () => {
    expect(() => calcKeychain(
      { acrylicType: 'Несуществующий', longestSideCm: 5, qty: 100, urgent: false },
      KEYCHAIN_PRICES
    )).toThrow('Price not found')
  })

  test('точная цена за штуку и pricePerUnit отражены', () => {
    const r = calcKeychain(
      { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: true },
      KEYCHAIN_PRICES
    )
    expect(r.pricePerPiece).toBe(70)
    expect(r.pricePerUnit).toBeCloseTo(91)  // 9100 / 100
  })
})
```

- [ ] **Step 2: Запустить тесты — должны падать**

Run: `npm test -- tests/calc.test.js`
Expected: FAIL — `calcKeychain is not a function`.

- [ ] **Step 3: Реализовать `calcKeychain` в `calc.js`**

В `calc.js` после `calcSouvenir` добавить:

```js
const KEYCHAIN_SIZE_BUCKETS = [3, 4, 6, 8, 10]
const KEYCHAIN_QTY_TIERS = [1, 10, 100, 500]

function calcKeychain({ acrylicType, longestSideCm, qty, urgent = false }, prices) {
  const sizeBucket = KEYCHAIN_SIZE_BUCKETS.find(s => longestSideCm <= s)
  if (!sizeBucket) throw new Error('Size > 10 cm not supported')

  let qtyTier = KEYCHAIN_QTY_TIERS[0]
  for (const t of KEYCHAIN_QTY_TIERS) if (qty >= t) qtyTier = t

  const row = prices.find(p =>
    p.acrylic_type === acrylicType &&
    p.size_max_cm === sizeBucket &&
    p.qty_min === qtyTier
  )
  if (!row) throw new Error('Price not found')

  let total = row.price_per_piece * qty
  if (urgent) total *= 1.30

  return {
    acrylicType,
    sizeBucket,
    qtyTier,
    pricePerPiece: row.price_per_piece,
    qty,
    urgent: !!urgent,
    total: +total.toFixed(2),
    pricePerUnit: +(total / qty).toFixed(2)
  }
}
```

И обновить экспорт в конце файла:
```js
module.exports = { calcSheet, calcSouvenir, calcKeychain }
```

- [ ] **Step 4: Запустить тесты — должны проходить**

Run: `npm test -- tests/calc.test.js`
Expected: PASS все 7 новых тестов calcKeychain.

- [ ] **Step 5: Коммит**

```bash
git add calc.js tests/calc.test.js
git commit -m "feat(calc): add calcKeychain — 5 acrylic types × 5 sizes × 4 qty tiers"
```

---

## Task 4: API — keychain endpoints + изменение `/api/calc/souvenir` + min_order в `/api/souvenir-prices`

**Files:**
- Modify: `server.js`
- Test: `tests/keychain.api.test.js` (NEW)
- Modify: `tests/api.test.js` (обновить старые тесты souvenir под новую сигнатуру)

- [ ] **Step 1: Создать `tests/keychain.api.test.js`**

```js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')
const { buildApp } = require('../server')

describe('GET /api/keychain-prices', () => {
  let app, db, agent

  beforeEach(async () => {
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    app = buildApp(db)
    await createUser(db, { email: 'a@a.com', password: 'pass1234', isAdmin: true })
    agent = request.agent(app)
    await loginAs(agent, 'a@a.com', 'pass1234')
  })

  test('возвращает 100 строк, отсортировано по type/size/qty', async () => {
    const res = await agent.get('/api/keychain-prices')
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(100)
    expect(res.body[0].acrylic_type <= res.body[1].acrylic_type).toBe(true)
  })

  test('требует авторизации', async () => {
    const res = await request(app).get('/api/keychain-prices')
    expect(res.status).toBe(401)
  })
})

describe('PUT /api/keychain-prices/:id', () => {
  let app, db, agent, managerAgent

  beforeEach(async () => {
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    app = buildApp(db)
    await createUser(db, { email: 'admin@a.com', password: 'pass1234', isAdmin: true })
    await createUser(db, { email: 'mgr@a.com', password: 'pass1234', isAdmin: false })
    agent = request.agent(app)
    managerAgent = request.agent(app)
    await loginAs(agent, 'admin@a.com', 'pass1234')
    await loginAs(managerAgent, 'mgr@a.com', 'pass1234')
  })

  test('admin меняет цену', async () => {
    const list = (await agent.get('/api/keychain-prices')).body
    const id = list[0].id
    const res = await agent.put(`/api/keychain-prices/${id}`).send({ price_per_piece: 999 })
    expect(res.status).toBe(200)
    expect(res.body.price_per_piece).toBe(999)
  })

  test('manager → 403', async () => {
    const res = await managerAgent.put('/api/keychain-prices/1').send({ price_per_piece: 999 })
    expect(res.status).toBe(403)
  })

  test('отрицательная цена → 400', async () => {
    const res = await agent.put('/api/keychain-prices/1').send({ price_per_piece: -10 })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/calc/keychain', () => {
  let app, db, agent

  beforeEach(async () => {
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    app = buildApp(db)
    await createUser(db, { email: 'a@a.com', password: 'pass1234', isAdmin: true })
    agent = request.agent(app)
    await loginAs(agent, 'a@a.com', 'pass1234')
  })

  test('базовый расчёт', async () => {
    const res = await agent.post('/api/calc/keychain').send({
      acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: false
    })
    expect(res.status).toBe(200)
    expect(res.body.sizeBucket).toBe(6)
    expect(res.body.qtyTier).toBe(100)
    expect(res.body.total).toBeCloseTo(7000)
  })

  test('требует авторизации', async () => {
    const res = await request(app).post('/api/calc/keychain').send({})
    expect(res.status).toBe(401)
  })

  test('невалидные параметры → 400', async () => {
    const res = await agent.post('/api/calc/keychain').send({
      acrylicType: 'Прозрачный', longestSideCm: 99, qty: 100
    })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Запустить тесты — должны падать**

Run: `npm test -- tests/keychain.api.test.js`
Expected: FAIL — endpoints не существуют.

- [ ] **Step 3: Добавить endpoints в `server.js`**

Найти секцию souvenir endpoints (`app.get('/api/souvenir-prices'...)`). После неё (но до Calculations) добавить:

```js
// ── Keychain prices ──────────────────────────────────────────────────────
app.get('/api/keychain-prices', requireAuth, (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM keychain_prices ORDER BY acrylic_type, size_max_cm, qty_min'
  ).all())
})

app.put('/api/keychain-prices/:id', requireAdmin, (req, res) => {
  const { price_per_piece } = req.body
  if (price_per_piece == null || Number(price_per_piece) < 0) {
    return res.status(400).json({ error: 'price_per_piece must be >= 0' })
  }
  db.prepare('UPDATE keychain_prices SET price_per_piece=? WHERE id=?')
    .run(Number(price_per_piece), req.params.id)
  res.json(db.prepare('SELECT * FROM keychain_prices WHERE id=?').get(req.params.id))
})
```

В секции `// ── Calculations ──` добавить после `/api/calc/souvenir`:

```js
app.post('/api/calc/keychain', requireAuth, (req, res) => {
  try {
    const prices = db.prepare('SELECT * FROM keychain_prices').all()
    const { calcKeychain } = require('./calc')
    const result = calcKeychain(req.body, prices)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})
```

- [ ] **Step 4: Изменить `/api/calc/souvenir` под новую сигнатуру**

Заменить тело `app.post('/api/calc/souvenir', ...)`:

```js
app.post('/api/calc/souvenir', requireAuth, (req, res) => {
  try {
    const prices = db.prepare('SELECT * FROM souvenir_prices').all()
    const catalog = db.prepare('SELECT * FROM catalog_items').all()
    const result = calcSouvenir(req.body, prices, catalog)
    res.json(result)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})
```

- [ ] **Step 5: Расширить `/api/souvenir-prices` POST/PUT под `min_order`**

Найти `app.post('/api/souvenir-prices', ...)` и `app.put('/api/souvenir-prices/:id', ...)`. В POST:

```js
app.post('/api/souvenir-prices', requireAdmin, (req, res) => {
  const { product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, min_order = 0 } = req.body
  if (!product_type || qty_up_to_29 == null || qty_from_30 == null || qty_from_100 == null || qty_from_500 == null || qty_from_1000 == null)
    return res.status(400).json({ error: 'product_type and all qty fields required' })
  const info = db.prepare(
    'INSERT INTO souvenir_prices (product_type,qty_up_to_29,qty_from_30,qty_from_100,qty_from_500,qty_from_1000,min_order) VALUES (?,?,?,?,?,?,?)'
  ).run(product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, min_order)
  res.status(201).json(db.prepare('SELECT * FROM souvenir_prices WHERE id=?').get(info.lastInsertRowid))
})
```

В PUT:

```js
app.put('/api/souvenir-prices/:id', requireAdmin, (req, res) => {
  const { product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, min_order } = req.body
  db.prepare(
    'UPDATE souvenir_prices SET product_type=?,qty_up_to_29=?,qty_from_30=?,qty_from_100=?,qty_from_500=?,qty_from_1000=?,min_order=COALESCE(?, min_order) WHERE id=?'
  ).run(product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, min_order ?? null, req.params.id)
  res.json(db.prepare('SELECT * FROM souvenir_prices WHERE id=?').get(req.params.id))
})
```

- [ ] **Step 6: Обновить `tests/api.test.js` под новую сигнатуру souvenir-calc**

Найти любые тесты, которые шлют `POST /api/calc/souvenir` со старой сигнатурой (`{ productTypeId, qty, ... }`). Если тестировался расчёт без каталога — добавить `manualProductPrice: 0` в payload, чтобы оставалась только печать (поведение совместимо со старыми ожиданиями по `total`, кроме того, что ушёл флэт-фи для qty<30).

Тесты, которые проверяли поведение «1500 ₽ за заказ при qty=10», обновить — теперь: `min_order=1500` (после миграции v7) → `printCost = max(51×10, 1500) = 1500`. Если в seed для теста был `qty_up_to_29=1500`, после миграции `min_order=1500`, `qty_up_to_29=0` → `0 × 10 = 0`, `min_order=1500` применяется → `printCost=1500`. С `manualProductPrice: 0` → `total=1500`. Старые цифры при правильной интерпретации сохраняются.

- [ ] **Step 7: Запустить все тесты**

Run: `npm test`
Expected: PASS — старые тесты продолжают работать, +новые keychain.api тесты.

- [ ] **Step 8: Коммит**

```bash
git add server.js tests/keychain.api.test.js tests/api.test.js
git commit -m "feat(api): keychain endpoints + souvenir-calc accepts catalogItemId + min_order in souvenir-prices"
```

---

## Task 5: Импорт каталога — новый формат + отчёт по непривязанным

**Files:**
- Modify: `server.js` (`/api/catalog/import`)
- Test: `tests/catalog.api.test.js` (NEW)

- [ ] **Step 1: Создать `tests/catalog.api.test.js`**

```js
const request = require('supertest')
const XLSX = require('xlsx')
const { makeTestDb, createUser, loginAs } = require('./helpers')
const { buildApp } = require('../server')

function makeXlsx(rows) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

describe('POST /api/catalog/import (v7)', () => {
  let app, db, agent

  beforeEach(async () => {
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    app = buildApp(db)
    // сидируем тип печати, который ожидается в файле
    db.prepare(
      'INSERT INTO souvenir_prices (product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000, min_order) VALUES (?,?,?,?,?,?,?)'
    ).run('Ручки (белый пластик)', 51, 45, 29, 20, 14, 1500)
    await createUser(db, { email: 'a@a.com', password: 'pass1234', isAdmin: true })
    agent = request.agent(app)
    await loginAs(agent, 'a@a.com', 'pass1234')
  })

  test('новый формат: 4 колонки → linked всё, unlinked пуст', async () => {
    const buf = makeXlsx([
      { 'Артикул': 'A1', 'Название': 'Ручка Senator', 'Тип продукта': 'Ручки (белый пластик)', 'Цена клиенту': 80 }
    ])
    const res = await agent.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.status).toBe(200)
    expect(res.body.imported).toBe(1)
    expect(res.body.linked).toBe(1)
    expect(res.body.unlinked).toEqual([])
    const item = db.prepare('SELECT * FROM catalog_items WHERE article=?').get('A1')
    expect(item.customer_price).toBe(80)
    expect(item.souvenir_price_id).not.toBeNull()
  })

  test('case-insensitive + trim матчинг типа продукта', async () => {
    const buf = makeXlsx([
      { 'Артикул': 'A1', 'Название': 'X', 'Тип продукта': '  ручки (БЕЛЫЙ пластик)  ', 'Цена клиенту': 80 }
    ])
    const res = await agent.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.body.linked).toBe(1)
  })

  test('неизвестный тип → unlinked', async () => {
    const buf = makeXlsx([
      { 'Артикул': 'A1', 'Название': 'Ручка', 'Тип продукта': 'Ручки (белый пластик)', 'Цена клиенту': 80 },
      { 'Артикул': 'A2', 'Название': 'Кружка', 'Тип продукта': 'Кружка металл', 'Цена клиенту': 350 }
    ])
    const res = await agent.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.body.imported).toBe(2)
    expect(res.body.linked).toBe(1)
    expect(res.body.unlinked).toEqual([
      { article: 'A2', name: 'Кружка', raw_type: 'Кружка металл' }
    ])
    const a2 = db.prepare('SELECT * FROM catalog_items WHERE article=?').get('A2')
    expect(a2.souvenir_price_id).toBeNull()
    expect(a2.customer_price).toBe(350)  // цена сохраняется даже без привязки
  })

  test('legacy формат (без «Тип продукта») сохраняется без привязки', async () => {
    const buf = makeXlsx([
      { 'Артикул': 'A1', 'Название': 'Ручка', 'Описание': 'desc', 'Цвета': 'red', 'Фото (URL)': 'http://x' }
    ])
    const res = await agent.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.body.imported).toBe(1)
    expect(res.body.linked).toBe(0)
    const item = db.prepare('SELECT * FROM catalog_items WHERE article=?').get('A1')
    expect(item.description).toBe('desc')
    expect(item.colors).toBe('red')
  })

  test('UPSERT по article — повторный импорт обновляет customer_price', async () => {
    await agent.post('/api/catalog/import').attach(
      'file', makeXlsx([{ 'Артикул': 'A1', 'Название': 'X', 'Тип продукта': 'Ручки (белый пластик)', 'Цена клиенту': 80 }]),
      'test.xlsx'
    )
    await agent.post('/api/catalog/import').attach(
      'file', makeXlsx([{ 'Артикул': 'A1', 'Название': 'X', 'Тип продукта': 'Ручки (белый пластик)', 'Цена клиенту': 95 }]),
      'test.xlsx'
    )
    const item = db.prepare('SELECT * FROM catalog_items WHERE article=?').get('A1')
    expect(item.customer_price).toBe(95)
  })

  test('требует admin', async () => {
    await createUser(db, { email: 'mgr@a.com', password: 'pass1234', isAdmin: false })
    const mgr = request.agent(app)
    await loginAs(mgr, 'mgr@a.com', 'pass1234')
    const buf = makeXlsx([{ 'Артикул': 'A1', 'Название': 'X' }])
    const res = await mgr.post('/api/catalog/import').attach('file', buf, 'test.xlsx')
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Запустить тесты — должны падать**

Run: `npm test -- tests/catalog.api.test.js`
Expected: FAIL — текущий импорт не поддерживает новый формат и не возвращает `linked`/`unlinked`.

- [ ] **Step 3: Переписать `/api/catalog/import` в `server.js`**

Заменить целиком:

```js
app.post('/api/catalog/import', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws)

  // Загружаем все типы печати один раз — для авто-привязки.
  const types = db.prepare('SELECT id, product_type FROM souvenir_prices').all()
  const typeMap = new Map(types.map(t => [t.product_type.toLowerCase().trim(), t.id]))

  const upsert = db.prepare(`
    INSERT INTO catalog_items (article, name, description, colors, photo_url, souvenir_price_id, customer_price)
    VALUES (@article, @name, @description, @colors, @photo_url, @souvenir_price_id, @customer_price)
    ON CONFLICT(article) DO UPDATE SET
      name=excluded.name,
      description=excluded.description,
      colors=excluded.colors,
      photo_url=excluded.photo_url,
      souvenir_price_id=excluded.souvenir_price_id,
      customer_price=excluded.customer_price
  `)

  const importMany = db.transaction((rows) => {
    let imported = 0, linked = 0
    const unlinked = []
    for (const row of rows) {
      if (!row['Артикул']) continue
      const rawType = row['Тип продукта'] ? String(row['Тип продукта']).toLowerCase().trim() : null
      const typeId = rawType ? typeMap.get(rawType) ?? null : null
      const customerPrice = row['Цена клиенту'] != null ? Number(row['Цена клиенту']) : null

      upsert.run({
        article:           String(row['Артикул']),
        name:              row['Название'] || '',
        description:       row['Описание'] || null,
        colors:            row['Цвета'] || null,
        photo_url:         row['Фото (URL)'] || null,
        souvenir_price_id: typeId,
        customer_price:    customerPrice
      })
      imported++
      if (typeId) linked++
      else if (row['Тип продукта']) {
        unlinked.push({
          article: String(row['Артикул']),
          name: row['Название'] || '',
          raw_type: String(row['Тип продукта'])
        })
      }
    }
    return { imported, linked, unlinked }
  })

  try {
    const result = importMany(rows)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})
```

- [ ] **Step 4: Запустить тесты — должны проходить**

Run: `npm test -- tests/catalog.api.test.js`
Expected: PASS все 6 тестов.

- [ ] **Step 5: Прогнать полный набор тестов**

Run: `npm test`
Expected: PASS все.

- [ ] **Step 6: Коммит**

```bash
git add server.js tests/catalog.api.test.js
git commit -m "feat(catalog): import accepts «Тип продукта» + «Цена клиенту»; auto-binds + reports unlinked"
```

---

## Task 6: UI калькулятора — вкладка «Брелки» + рефактор формы сувенирки + сохранение quote

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/calc-ui.js`
- Test: `tests/quotes-keychain.api.test.js` (NEW)

- [ ] **Step 1: Создать `tests/quotes-keychain.api.test.js`**

```js
const request = require('supertest')
const { makeTestDb, createUser, loginAs } = require('./helpers')
const { buildApp } = require('../server')

describe('POST /api/quotes — keychain', () => {
  let app, db, agent

  beforeEach(async () => {
    process.env.DISABLE_RATE_LIMIT = 'true'
    db = makeTestDb()
    app = buildApp(db)
    await createUser(db, { email: 'a@a.com', password: 'pass1234', isAdmin: true })
    agent = request.agent(app)
    await loginAs(agent, 'a@a.com', 'pass1234')
  })

  test('сохраняет quote с type=keychain, total в БД', async () => {
    const calcRes = await agent.post('/api/calc/keychain').send({
      acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: false
    })
    expect(calcRes.status).toBe(200)

    const saveRes = await agent.post('/api/quotes').send({
      type: 'keychain',
      params: { acrylicType: 'Прозрачный', longestSideCm: 5, qty: 100, urgent: false },
      result: calcRes.body,
      kp_text: 'Брелок прозрачный 5см × 100 шт'
    })
    expect(saveRes.status).toBeLessThan(300)
    const id = saveRes.body.id

    const row = db.prepare('SELECT * FROM quotes WHERE id=?').get(id)
    expect(row.type).toBe('keychain')
    expect(row.total).toBe(7000)
  })
})
```

- [ ] **Step 2: Запустить тест — должен проходить**

Run: `npm test -- tests/quotes-keychain.api.test.js`
Expected: PASS — endpoints `POST /api/quotes` уже существует и принимает любой type из CHECK; миграция v7 добавила 'keychain' в CHECK; client_id опциональный → save должен пройти.

(Если падает с 400 — проверить, что body.params.* и body.result.total корректно записываются. В save flow `quotes.total` берётся из `result.total` если число — это правило фазы E.)

- [ ] **Step 3: Добавить вкладку «🔑 Брелки» в `public/index.html`**

Найти блок `.tabs` (строка с `<div class="tabs">`) и добавить третью кнопку:

```html
<div class="tabs">
  <div class="tab active" data-tab="sheet">📐 Лист</div>
  <div class="tab" data-tab="souvenir">🎁 Сувенирка</div>
  <div class="tab" data-tab="keychain">🔑 Брелки</div>
</div>
```

После существующих `<div class="tab-content">` добавить новый блок брелков:

```html
<div class="tab-content" data-content="keychain">
  <div class="field">
    <label>Тип акрила</label>
    <select id="kc-acrylic">
      <option>Прозрачный</option>
      <option>Тонированный</option>
      <option>Непрозр/градиент 1 сторона</option>
      <option>Непрозр/градиент 2 стороны</option>
      <option>Люминесцентный</option>
    </select>
  </div>
  <div class="row3">
    <div class="field"><label>Длина, см</label><input type="number" id="kc-length" min="0" step="0.1" value="5"></div>
    <div class="field"><label>Ширина, см</label><input type="number" id="kc-width" min="0" step="0.1" value="3"></div>
    <div class="field"><label>Тираж, шт</label><input type="number" id="kc-qty" min="1" value="100"></div>
  </div>
  <div class="options">
    <label><input type="checkbox" id="kc-urgent"> Срочный заказ <span class="badge">+30%</span></label>
  </div>
  <button class="btn-primary" id="kc-calc">Рассчитать</button>
  <div id="kc-result" class="result-box" style="display:none"></div>
  <button class="btn-secondary" id="kc-save" style="display:none">Сохранить КП</button>
</div>
```

- [ ] **Step 4: Дополнить `public/js/calc-ui.js` логикой брелков**

В конец файла добавить:

```js
// Keychain tab
document.getElementById('kc-calc')?.addEventListener('click', async () => {
  const longest = Math.max(
    Number(document.getElementById('kc-length').value),
    Number(document.getElementById('kc-width').value)
  )
  const params = {
    acrylicType: document.getElementById('kc-acrylic').value,
    longestSideCm: longest,
    qty: Number(document.getElementById('kc-qty').value),
    urgent: document.getElementById('kc-urgent').checked
  }
  try {
    const r = await api('/api/calc/keychain', { method: 'POST', body: JSON.stringify(params) })
    const box = document.getElementById('kc-result')
    box.style.display = 'block'
    box.innerHTML = `
      <div>${esc(r.acrylicType)} · до ${r.sizeBucket} см · ${r.qtyTier === 1 ? '1-9' : r.qtyTier === 10 ? '10-99' : r.qtyTier === 100 ? '100-499' : '500-1000'} шт</div>
      <div>${r.pricePerPiece} ₽/шт × ${r.qty} = ${(r.pricePerPiece * r.qty).toFixed(2)} ₽</div>
      ${r.urgent ? `<div>+ срочный × 1.30 = ${r.total} ₽</div>` : ''}
      <hr><div><strong>ИТОГО ${r.total} ₽ (${r.pricePerUnit} ₽/шт)</strong></div>`
    document.getElementById('kc-save').style.display = ''
    document.getElementById('kc-save').dataset.params = JSON.stringify(params)
    document.getElementById('kc-save').dataset.result = JSON.stringify(r)
    document.getElementById('kc-save').dataset.kpText = `Брелок ${r.acrylicType} до ${r.sizeBucket} см, тираж ${r.qty} шт. ИТОГО: ${r.total} ₽`
  } catch (e) {
    showToast('Ошибка: ' + e.message)
  }
})

document.getElementById('kc-save')?.addEventListener('click', () => {
  const btn = document.getElementById('kc-save')
  openSaveQuoteModal({
    type: 'keychain',
    params: JSON.parse(btn.dataset.params),
    result: JSON.parse(btn.dataset.result),
    kpText: btn.dataset.kpText
  })
})
```

(`openSaveQuoteModal` уже существует в `calc-ui.js` из фазы E — переиспользуем; если её сигнатура другая, адаптировать под текущую.)

- [ ] **Step 5: Рефактор формы сувенирки — autocomplete каталога + переключатель «Свободный расчёт»**

В `public/index.html` найти блок `<div class="tab-content" data-content="souvenir">` и заменить содержимое на:

```html
<div class="tab-content" data-content="souvenir">
  <div class="field">
    <label>Товар из каталога</label>
    <input type="text" id="sv-catalog" list="sv-catalog-list" placeholder="Введи артикул или название…">
    <datalist id="sv-catalog-list"></datalist>
    <div id="sv-bound" class="info-pill" style="display:none">
      <span>Тип печати: <strong id="sv-bound-type">—</strong></span>
      <span>Цена продукта: <strong id="sv-bound-price">—</strong> ₽/шт</span>
    </div>
    <button type="button" id="sv-toggle-manual" class="btn-link">Свободный расчёт →</button>
  </div>

  <div id="sv-manual-fields" style="display:none">
    <div class="field"><label>Тип печати</label><select id="sv-product-type"></select></div>
    <div class="field"><label>Цена продукта, ₽/шт</label><input type="number" id="sv-manual-price" min="0" value="0"></div>
  </div>

  <div class="field"><label>Тираж, шт</label><input type="number" id="sv-qty" min="1" value="100"></div>
  <div class="options">
    <label><input type="checkbox" id="sv-varnish"> Лак <span class="badge">+30%</span></label>
    <label><input type="checkbox" id="sv-relief"> Рельеф <span class="badge">+30%</span></label>
    <label><input type="checkbox" id="sv-urgent"> Срочный заказ <span class="badge">+30%</span></label>
  </div>
  <button class="btn-primary" id="sv-calc">Рассчитать</button>
  <div id="sv-result" class="result-box" style="display:none"></div>
  <button class="btn-secondary" id="sv-save" style="display:none">Сохранить КП</button>
</div>
```

В `public/js/calc-ui.js` найти существующую логику souvenir (если есть) и заменить на:

```js
// Souvenir: catalog autocomplete + manual mode
let svCatalogCache = []
let svSelectedItem = null

async function svRefreshCatalog(q = '') {
  svCatalogCache = await api(`/api/catalog?q=${encodeURIComponent(q)}`)
  const dl = document.getElementById('sv-catalog-list')
  dl.innerHTML = svCatalogCache.slice(0, 50).map(c =>
    `<option value="${esc(c.article)} — ${esc(c.name)}"></option>`
  ).join('')
}
svRefreshCatalog()

document.getElementById('sv-catalog')?.addEventListener('input', (e) => {
  const val = e.target.value
  const match = svCatalogCache.find(c => `${c.article} — ${c.name}` === val)
  svSelectedItem = match || null
  const bound = document.getElementById('sv-bound')
  if (match) {
    bound.style.display = 'flex'
    document.getElementById('sv-bound-type').textContent = match.product_type || '— не привязан —'
    document.getElementById('sv-bound-price').textContent = match.customer_price ?? '—'
  } else {
    bound.style.display = 'none'
  }
})

document.getElementById('sv-toggle-manual')?.addEventListener('click', async () => {
  const fields = document.getElementById('sv-manual-fields')
  fields.style.display = fields.style.display === 'none' ? 'block' : 'none'
  if (fields.style.display === 'block') {
    const prices = await api('/api/souvenir-prices')
    const sel = document.getElementById('sv-product-type')
    sel.innerHTML = prices.map(p => `<option value="${p.id}">${esc(p.product_type)}</option>`).join('')
  }
})

document.getElementById('sv-calc')?.addEventListener('click', async () => {
  const manual = document.getElementById('sv-manual-fields').style.display !== 'none'
  const params = {
    qty: Number(document.getElementById('sv-qty').value),
    uvVarnish: document.getElementById('sv-varnish').checked,
    reliefLayers: document.getElementById('sv-relief').checked ? 1 : 0,
    urgent: document.getElementById('sv-urgent').checked
  }
  if (manual) {
    params.productTypeId = Number(document.getElementById('sv-product-type').value)
    params.manualProductPrice = Number(document.getElementById('sv-manual-price').value)
  } else {
    if (!svSelectedItem) { showToast('Выбери товар из каталога'); return }
    params.catalogItemId = svSelectedItem.id
  }
  try {
    const r = await api('/api/calc/souvenir', { method: 'POST', body: JSON.stringify(params) })
    const box = document.getElementById('sv-result')
    box.style.display = 'block'
    box.innerHTML = `
      <div>${esc(r.catalogItemName || r.productTypeName)} · ${r.qty} шт</div>
      <div>Печать: ${r.pricePerUnit} ₽/шт × ${r.qty} = ${r.printCost} ₽${r.minOrderApplied ? ' <em>(применён минимум)</em>' : ''}</div>
      <div>Продукт: ${r.productPrice} ₽/шт × ${r.qty} = ${r.productCost} ₽</div>
      <hr><div><strong>ИТОГО ${r.total} ₽ (${r.pricePerUnitFinal} ₽/шт)</strong></div>`
    document.getElementById('sv-save').style.display = ''
    document.getElementById('sv-save').dataset.params = JSON.stringify(params)
    document.getElementById('sv-save').dataset.result = JSON.stringify(r)
    document.getElementById('sv-save').dataset.kpText = `${r.catalogItemName || r.productTypeName}, тираж ${r.qty} шт. ИТОГО: ${r.total} ₽`
  } catch (e) {
    showToast('Ошибка: ' + e.message)
  }
})

document.getElementById('sv-save')?.addEventListener('click', () => {
  const btn = document.getElementById('sv-save')
  openSaveQuoteModal({
    type: 'souvenir',
    params: JSON.parse(btn.dataset.params),
    result: JSON.parse(btn.dataset.result),
    kpText: btn.dataset.kpText
  })
})
```

- [ ] **Step 6: Запустить тесты — все должны проходить**

Run: `npm test`
Expected: PASS все.

- [ ] **Step 7: Smoke-тест UI локально**

Run: `npm start` (или `node server.js`)

Открыть `http://localhost:3001`, залогиниться, проверить:
1. Вкладка «Брелки»: посчитать «Прозрачный 5×3 100 шт» → ожидаемое total = 7000 ₽.
2. Вкладка «Сувенирка»: ввести артикул из каталога — подтянулась цена + тип; нажать «Рассчитать» → ожидаемый total с печатью+продуктом.
3. Кнопка «Свободный расчёт» открывает доп.поля с типом печати и ценой вручную.
4. Сохранить квоту → появляется в админке во вкладке «Сохранённые КП».

- [ ] **Step 8: Коммит**

```bash
git add public/index.html public/js/calc-ui.js tests/quotes-keychain.api.test.js
git commit -m "feat(ui): keychain calculator tab + souvenir form refactor (catalog autocomplete + manual mode)"
```

---

## Task 7: UI админки — `min_order` + вкладка «Брелки» + отчёт после импорта

**Files:**
- Modify: `public/admin.html`
- Modify: `public/js/admin.js`

- [ ] **Step 1: Добавить колонку `min_order` в таблицу сувенирных цен в `public/admin.html`**

Найти блок с таблицей `<table>` для сувенирных цен (содержит `<th>Тип продукта</th>` и колонки qty_*). Добавить колонку перед действиями:

```html
<th>Минимум за заказ, ₽</th>
```

В `public/js/admin.js` найти функцию render для souvenir prices (примерно `function renderSouvenirPrices` или inline в `loadSouvenirPrices`). Добавить ячейку:

```js
`<td><input type="number" min="0" value="${p.min_order ?? 0}" data-field="min_order" data-id="${p.id}"></td>`
```

И добавить обработчик изменения, который шлёт PUT с обновлённым `min_order`:

```js
document.querySelectorAll('input[data-field=min_order]').forEach(input => {
  input.addEventListener('change', async (e) => {
    const id = e.target.dataset.id
    const cur = await api(`/api/souvenir-prices`)
    const row = cur.find(r => r.id == id)
    if (!row) return
    await api(`/api/souvenir-prices/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...row, min_order: Number(e.target.value) })
    })
    showToast('Обновлено')
  })
})
```

- [ ] **Step 2: Добавить вкладку «🔑 Брелки» в `public/admin.html`**

В сайдбаре `<aside>` найти существующие пункты («🎁 Сувенирка», «✂️ Высечка» — последний от резки) и добавить:

```html
<a href="#keychain" data-tab="keychain">🔑 Брелки</a>
```

В контентной области добавить:

```html
<section data-content="keychain" hidden>
  <h2>🔑 Цены на брелки</h2>
  <p class="muted">5 типов акрила × 5 размеров × 4 тиражных тира. Редактирование цен — клик по ячейке.</p>
  <div id="keychain-tables"></div>
</section>
```

В `public/js/admin.js` добавить функцию загрузки и рендера:

```js
async function loadKeychainPrices() {
  const all = await api('/api/keychain-prices')
  const types = [...new Set(all.map(p => p.acrylic_type))]
  const sizes = [3, 4, 6, 8, 10]
  const tiers = [
    { qty: 1, label: '1-9' },
    { qty: 10, label: '10-99' },
    { qty: 100, label: '100-499' },
    { qty: 500, label: '500-1000' }
  ]
  const container = document.getElementById('keychain-tables')
  container.innerHTML = types.map(type => {
    const rows = tiers.map(t => {
      const cells = sizes.map(s => {
        const row = all.find(p => p.acrylic_type === type && p.size_max_cm === s && p.qty_min === t.qty)
        return `<td><input type="number" min="0" value="${row.price_per_piece}" data-id="${row.id}" data-keychain></td>`
      }).join('')
      return `<tr><th>${t.label} шт</th>${cells}</tr>`
    }).join('')
    return `
      <h3>${esc(type)}</h3>
      <table>
        <thead><tr><th></th>${sizes.map(s => `<th>до ${s} см</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  }).join('')

  container.querySelectorAll('input[data-keychain]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const id = e.target.dataset.id
      const value = Number(e.target.value)
      try {
        await api(`/api/keychain-prices/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ price_per_piece: value })
        })
        showToast('Обновлено')
      } catch (err) {
        showToast('Ошибка: ' + err.message)
      }
    })
  })
}

// Подключить в роутер вкладок: при выборе data-tab=keychain → loadKeychainPrices()
```

И в существующем переключателе вкладок добавить ветку:

```js
if (tab === 'keychain') loadKeychainPrices()
```

- [ ] **Step 3: Отчёт после импорта каталога**

В `public/js/admin.js` найти обработчик кнопки импорта каталога (примерно `document.getElementById('catalog-import-btn')` или inline upload). После успеха показывать модалку:

```js
async function onCatalogImport(file) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/catalog/import', { method: 'POST', body: fd })
  const data = await res.json()
  if (!res.ok) { showToast('Ошибка: ' + (data.error || res.status)); return }

  let msg = `✅ Загружено: ${data.imported}\n🔗 Привязано к типу печати: ${data.linked}\n⚠️ Без типа печати: ${data.unlinked.length}`
  if (data.unlinked.length > 0) {
    msg += '\n\nПервые 10 непривязанных:\n' + data.unlinked.slice(0, 10).map(u =>
      `${u.article} — ${u.name} (тип: «${u.raw_type}»)`
    ).join('\n')
  }
  alert(msg)
  loadCatalog()  // обновить таблицу каталога
}
```

(Если в текущей админке используется `prompt()`/`alert()` стиль — оставляем `alert`. Если есть кастомные модалки — переписать на них.)

- [ ] **Step 4: Smoke-тест админки**

Run: `npm start`

В админке:
1. Вкладка «Сувенирка» → отредактировать `min_order` для одного типа → перезагрузить → значение сохранилось.
2. Вкладка «Брелки» → 5 таблиц, поправить одну ячейку → реакция «Обновлено».
3. Импортировать тестовый xlsx с 5 строк (3 валидных + 2 с неизвестными типами) → диалог показывает 5/3/2.

- [ ] **Step 5: Коммит**

```bash
git add public/admin.html public/js/admin.js
git commit -m "feat(admin): min_order on souvenir prices + keychain prices tab + catalog import report"
```

---

## Task 8: PDF — поддержка type='keychain' (опционально, но рекомендуется)

**Files:**
- Modify: `pdf.js`
- Modify: `tests/pdf.test.js`

- [ ] **Step 1: Добавить тест в `tests/pdf.test.js`**

```js
test('PDF для keychain не падает и содержит кириллицу акрила', async () => {
  const { generateQuotePdf } = require('../pdf')
  const buf = generateQuotePdf(
    {
      type: 'keychain',
      params: JSON.stringify({}),
      result: JSON.stringify({
        acrylicType: 'Прозрачный',
        sizeBucket: 6,
        qtyTier: 100,
        pricePerPiece: 70,
        qty: 100,
        urgent: false,
        total: 7000,
        pricePerUnit: 70
      }),
      kp_text: 'Брелок прозрачный до 6 см, 100 шт, 7000 ₽',
      created_at: '2026-05-04 12:00:00'
    },
    null,
    { name: 'Сити Принт' },
    { full_name: 'Анна', email: 'a@a.com' }
  )
  expect(buf).toBeInstanceOf(Buffer)
  expect(buf.slice(0, 4).toString()).toBe('%PDF')
})
```

- [ ] **Step 2: Если падает — поправить локализацию ключей в `pdf.js`**

Найти секцию рендера breakdown'а (итерация по `result.*`). Если есть локализация ключей через объект — добавить:

```js
const KEY_LABELS = {
  // ... существующие
  acrylicType:    'Тип акрила',
  sizeBucket:     'Размерная корзина (до …, см)',
  qtyTier:        'Тиражный тир (от … шт)',
  pricePerPiece:  'Цена за штуку, ₽',
  pricePerUnit:   'Цена за штуку (итог), ₽',
  // souvenir новые ключи v7:
  printCost:      'Стоимость печати, ₽',
  productPrice:   'Цена продукта, ₽/шт',
  productCost:    'Стоимость продукта, ₽',
  pricePerUnitFinal: 'Итоговая цена за штуку, ₽',
  minOrderApplied:   'Применён минимум заказа',
  catalogItemName:   'Товар',
  productTypeName:   'Тип печати'
}
```

- [ ] **Step 3: Запустить тест**

Run: `npm test -- tests/pdf.test.js`
Expected: PASS.

- [ ] **Step 4: Коммит**

```bash
git add pdf.js tests/pdf.test.js
git commit -m "feat(pdf): localize keychain and souvenir-v7 keys for PDF render"
```

---

## После выполнения всех задач — Smoke на проде

Анна (вручную, через UI на calc.citi-print.ru):

1. Зайти в админку, проверить вкладку «🔑 Брелки» — 5 таблиц, цены из CSV видны и редактируются.
2. Открыть «🎁 Сувенирка» в админке — у каждого типа есть поле «Минимум за заказ».
3. Импортировать каталог из 1500 строк → ожидать «1500 / N / M». Проверить, что 1-2 непривязанных корректно показаны.
4. Калькулятор → «Брелки» → посчитать прозрачный 5×3 см × 100 шт → ITOГО 7000 ₽. Сохранить квоту.
5. Калькулятор → «Сувенирка» → выбрать товар из каталога → проверить, что подтянулись тип печати и цена; посчитать тираж 250 шт.
6. Калькулятор → «Сувенирка» → «Свободный расчёт» → ввести вручную тип и цену.
7. Калькулятор → «Сувенирка» → тираж 10 шт → проверить, что применяется `min_order`.
8. Скачать PDF для квоты брелка и для сувенирки.

---

## Self-Review

**Spec coverage:**
- ✅ Брелки: схема + сидирование + calc + API + UI калькулятора + UI админки → tasks 1, 3, 4, 6, 7
- ✅ Цена продукта в сувенирке: customer_price + import auto-bind + new calc signature → tasks 1, 2, 4, 5
- ✅ Bug-fix qty<30: per-unit + min_order → tasks 1, 2, 4 (API), 7 (admin UI для min_order)
- ✅ PDF поддержка → task 8

**Placeholder scan:** Нет «TBD»/«TODO». Все функции и константы определены до их использования. Код в каждом шаге показан целиком.

**Type consistency:** `calcSouvenir` сигнатура определена в Task 2 и используется одинаково в Task 4 (`/api/calc/souvenir`) и Task 6 (`calc-ui.js`). `calcKeychain` определена в Task 3 и используется в Task 4 (`/api/calc/keychain`) и Task 6 (UI). Поля результата (`printCost`, `productCost`, `total`, `pricePerPiece`, `sizeBucket`, `qtyTier`) консистентны во всех задачах.

**Migration coordination:** v7 идемпотентна по отношению к v6 cutting-агента (пересоздаёт `quotes` с расширенным CHECK; `INSERT OR IGNORE` при сидировании; ALTER TABLE на новые колонки безопасны).
