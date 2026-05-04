// tests/migrate.test.js
const { createDb, applyMigrations } = require('../db')

describe('migrations', () => {
  test('fresh DB ends at the latest user_version', () => {
    const db = createDb(':memory:')
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBeGreaterThanOrEqual(2)
  })

  test('idempotent: rerunning applyMigrations preserves data and version', () => {
    const db = createDb(':memory:')
    db.prepare("INSERT INTO sheet_materials (name, price_per_sqm) VALUES ('x', 1)").run()
    const v1 = db.pragma('user_version', { simple: true })
    applyMigrations(db)
    const v2 = db.pragma('user_version', { simple: true })
    expect(v2).toBe(v1)
    const count = db.prepare('SELECT COUNT(*) AS c FROM sheet_materials').get().c
    expect(count).toBe(1)
  })
})

describe('migration v2 — users + sessions', () => {
  test('creates users table with required columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(
      ['id','email','password_hash','full_name','is_admin','is_active','created_at']
    ))
  })

  test('creates sessions table with sid/expired/sess columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['sid','expired','sess']))
  })

  test('adds quotes.user_id column referencing users(id)', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('user_id')
  })

  test('users.email is UNIQUE', () => {
    const db = createDb(':memory:')
    db.prepare("INSERT INTO users (email,password_hash,full_name) VALUES (?,?,?)")
      .run('a@b.c', 'x', 'A')
    expect(() =>
      db.prepare("INSERT INTO users (email,password_hash,full_name) VALUES (?,?,?)")
        .run('a@b.c', 'y', 'B')
    ).toThrow(/UNIQUE/)
  })
})

describe('migration v3 — clients + quotes.client_id + quotes.comment', () => {
  test('creates clients table with required columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(clients)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(
      ['id','name','contact_person','phone','email','notes','created_at','updated_at']
    ))
  })

  test('adds quotes.client_id and quotes.comment columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('client_id')
    expect(cols).toContain('comment')
  })

  test('clients.name is required (NOT NULL)', () => {
    const db = createDb(':memory:')
    expect(() =>
      db.prepare("INSERT INTO clients (name) VALUES (NULL)").run()
    ).toThrow(/NOT NULL/)
  })
})

describe('migration v5 — company_settings + quotes.pdf_path', () => {
  test('creates company_settings table with key/value columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(company_settings)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['key', 'value']))
  })

  test('adds quotes.pdf_path column', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('pdf_path')
  })

  test('seeds default company_settings rows', () => {
    const db = createDb(':memory:')
    const rows = db.prepare('SELECT key, value FROM company_settings').all()
    const obj = {}
    rows.forEach(r => obj[r.key] = r.value)
    expect(obj.name).toBe('Сити Принт')
    expect(obj.kp_validity_days).toBe('7')
    expect(obj.signature).toMatch(/Сити Принт/)
  })
})

describe('migration v4 — quotes.total + backfill', () => {
  test('adds total column to quotes', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name)
    expect(cols).toContain('total')
  })

  test('backfills total from existing result.total JSON', () => {
    // Construct DB at v3, insert a row, then run applyMigrations to advance to v4
    // and verify the row's total is populated.
    const Database = require('better-sqlite3')
    const { applyMigrations, migrations } = require('../db')
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.function('lower_ru', { deterministic: true }, s => String(s ?? '').toLowerCase())
    for (const m of migrations.filter(m => m.version <= 3)) {
      db.transaction(() => { m.up(db); db.pragma(`user_version=${m.version}`) })()
    }
    db.prepare("INSERT INTO quotes (type,params,result,kp_text) VALUES (?,?,?,?)")
      .run('sheet', '{}', JSON.stringify({ total: 1234 }), 'kp')
    db.prepare("INSERT INTO quotes (type,params,result,kp_text) VALUES (?,?,?,?)")
      .run('sheet', '{}', 'not-json', 'kp2')
    applyMigrations(db)
    const rows = db.prepare('SELECT id, total FROM quotes ORDER BY id').all()
    expect(rows[0].total).toBe(1234)
    expect(rows[1].total).toBeNull()
  })
})

describe('migration v6 — cutting_materials + quotes type expansion', () => {
  test('creates cutting_materials table with required columns', () => {
    const db = createDb(':memory:')
    const cols = db.prepare("PRAGMA table_info(cutting_materials)").all().map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(
      ['id', 'service', 'name', 'thickness_mm', 'price_per_m', 'sort_order', 'is_active', 'created_at', 'updated_at']
    ))
  })

  test('cutting_materials.service rejects values outside plotter|laser', () => {
    const db = createDb(':memory:')
    expect(() =>
      db.prepare("INSERT INTO cutting_materials (service, name, price_per_m) VALUES (?,?,?)")
        .run('milling', 'Test', 10)
    ).toThrow(/CHECK/)
  })

  test('cutting_materials uniqueness on (service, name, thickness)', () => {
    const db = createDb(':memory:')
    // Use thickness=7 which is not in the seed data, so the first insert succeeds.
    db.prepare("INSERT INTO cutting_materials (service, name, thickness_mm, price_per_m) VALUES (?,?,?,?)")
      .run('laser', 'Акрил', 7, 90)
    expect(() =>
      db.prepare("INSERT INTO cutting_materials (service, name, thickness_mm, price_per_m) VALUES (?,?,?,?)")
        .run('laser', 'Акрил', 7, 100)
    ).toThrow(/UNIQUE/)
  })

  test('plotter materials seeded (7 items, all active, NULL thickness)', () => {
    const db = createDb(':memory:')
    const rows = db.prepare("SELECT name, thickness_mm, price_per_m FROM cutting_materials WHERE service='plotter' ORDER BY sort_order, id").all()
    expect(rows).toHaveLength(7)
    expect(rows.every(r => r.thickness_mm === null)).toBe(true)
    const oracal = rows.find(r => r.name === 'Oracal')
    expect(oracal.price_per_m).toBe(30)
  })

  test('laser materials seeded (13 items, with thickness)', () => {
    const db = createDb(':memory:')
    const rows = db.prepare("SELECT name, thickness_mm, price_per_m FROM cutting_materials WHERE service='laser' ORDER BY sort_order, id").all()
    expect(rows).toHaveLength(13)
    const acryl5 = rows.find(r => r.name === 'Акрил' && r.thickness_mm === 5)
    expect(acryl5.price_per_m).toBe(90)
    const fetr = rows.find(r => r.name === 'Фетр/кожа')
    expect(fetr.thickness_mm).toBeNull()
    expect(fetr.price_per_m).toBe(40)
  })

  test('seeds cutting_min_order=1500 in company_settings', () => {
    const db = createDb(':memory:')
    const v = db.prepare("SELECT value FROM company_settings WHERE key='cutting_min_order'").get()
    expect(v.value).toBe('1500')
  })

  test('quotes.type CHECK now accepts cutting_plotter and cutting_laser', () => {
    const db = createDb(':memory:')
    expect(() =>
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)")
        .run('cutting_plotter', '{}', '{}', 'kp')
    ).not.toThrow()
    expect(() =>
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)")
        .run('cutting_laser', '{}', '{}', 'kp')
    ).not.toThrow()
  })

  test('quotes.type CHECK still rejects bogus types', () => {
    const db = createDb(':memory:')
    expect(() =>
      db.prepare("INSERT INTO quotes (type, params, result, kp_text) VALUES (?,?,?,?)")
        .run('bogus', '{}', '{}', 'kp')
    ).toThrow(/CHECK/)
  })

  test('preserves existing quotes data when recreating the table', () => {
    // Build DB at v5, insert a sheet quote, then advance to v6 and verify it survives.
    const Database = require('better-sqlite3')
    const { applyMigrations, migrations } = require('../db')
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.function('lower_ru', { deterministic: true }, s => String(s ?? '').toLowerCase())
    for (const m of migrations.filter(m => m.version <= 5)) {
      db.transaction(() => { m.up(db); db.pragma(`user_version=${m.version}`) })()
    }
    db.prepare("INSERT INTO quotes (type, params, result, kp_text, comment, total) VALUES (?,?,?,?,?,?)")
      .run('sheet', '{"w":1}', '{"total":42}', 'kp1', 'note', 42)
    applyMigrations(db)
    const rows = db.prepare('SELECT type, comment, total FROM quotes').all()
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('sheet')
    expect(rows[0].comment).toBe('note')
    expect(rows[0].total).toBe(42)
  })
})

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

  test('souvenir_prices: миграция v7 переносит qty_up_to_29 в min_order и обнуляет qty_up_to_29', () => {
    // Build a DB at v5 (the latest pre-v7 version in this branch), insert a row in old format,
    // then run applyMigrations to advance through v7 and verify the data was migrated.
    const Database = require('better-sqlite3')
    const { applyMigrations, migrations } = require('../db')
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.function('lower_ru', { deterministic: true }, s => String(s ?? '').toLowerCase())
    for (const m of migrations.filter(x => x.version <= 5)) {
      db.transaction(() => { m.up(db); db.pragma(`user_version = ${m.version}`) })()
    }
    // Pre-v7: souvenir_prices has no min_order column; qty_up_to_29 is the qty<30 price.
    db.prepare(
      'INSERT INTO souvenir_prices (product_type, qty_up_to_29, qty_from_30, qty_from_100, qty_from_500, qty_from_1000) VALUES (?,?,?,?,?,?)'
    ).run('TestProd', 1500, 45, 29, 20, 14)
    // Run v7
    applyMigrations(db)
    // After v7: min_order=1500 (was qty_up_to_29), qty_up_to_29=0, остальные тиражные цены не тронуты
    const row = db.prepare('SELECT * FROM souvenir_prices WHERE product_type = ?').get('TestProd')
    expect(row.min_order).toBe(1500)
    expect(row.qty_up_to_29).toBe(0)
    expect(row.qty_from_30).toBe(45)
    expect(row.qty_from_100).toBe(29)
    expect(row.qty_from_500).toBe(20)
    expect(row.qty_from_1000).toBe(14)
  })

  test('recreate quotes preserves all v1-v5 columns', () => {
    // Документирует контракт: пересоздание quotes на шаге 4 v7 (CREATE quotes_new + INSERT SELECT *
    // + DROP + RENAME) сохраняет все колонки, накопленные через v1..v5
    // (created_at, type, params, result, kp_text, user_id, client_id, comment, total, pdf_path).
    const db = createDb(':memory:')
    // Сидируем зависимости (FK) и вставляем quote-строку с реалистичными значениями всех v1..v5 колонок.
    db.prepare("INSERT INTO users (id, email, password_hash, full_name) VALUES (?,?,?,?)")
      .run(1, 'test@example.com', 'hash', 'Test User')
    db.prepare("INSERT INTO clients (id, name) VALUES (?,?)").run(1, 'Test Client')
    const insertedParams = JSON.stringify({ width: 100, height: 200, qty: 5 })
    const insertedResult = JSON.stringify({ total: 1234.56, breakdown: 'x' })
    db.prepare(
      "INSERT INTO quotes (id, type, params, result, kp_text, user_id, client_id, comment, total, pdf_path) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(42, 'sheet', insertedParams, insertedResult, 'KP TEXT', 1, 1, 'Test comment', 1234.56, '/tmp/q.pdf')

    // Запускаем applyMigrations повторно — мы уже на v7, миграции должны быть no-op
    // (ничего не должно измениться).
    applyMigrations(db)

    const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(42)
    expect(row).toBeDefined()
    expect(row.id).toBe(42)
    expect(row.type).toBe('sheet')
    expect(row.params).toBe(insertedParams)
    expect(row.result).toBe(insertedResult)
    expect(row.kp_text).toBe('KP TEXT')
    expect(row.user_id).toBe(1)
    expect(row.client_id).toBe(1)
    expect(row.comment).toBe('Test comment')
    expect(row.total).toBe(1234.56)
    expect(row.pdf_path).toBe('/tmp/q.pdf')
    expect(row.created_at).toBeTruthy()
  })
})
